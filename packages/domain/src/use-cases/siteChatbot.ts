import type {
  LeadBotRepo,
  Logger,
  MonchaInstallValues,
  MonchaWidgetApi,
  SiteBrand,
  SiteManifest,
  SiteManifestAsset,
  SiteSnapshotListItem,
  SiteSnapshotRepo,
  SiteStore,
  WidgetConfig,
} from '../ports';
import { imageSize, type ImageSize } from '../site/image-size';
import { MONCHA_ACCOUNT_CODES } from './leadBots';
import { retryAfterError } from './siteGithub';

/**
 * Adds the lead's MonCha chatbot to its website copy before the GitHub push: the widget's primaryColor is set from the
 * website's brand colours (GET widget, then PUT widget with only primaryColor changed), the install values are read
 * (GET install) and the embed goes into index.html in R2, so the push and the Worker deploy publish it.
 */
export const SITE_CHATBOT_MAX_ATTEMPTS = 3;
export const SITE_CHATBOT_BACKOFF_MS = [60_000, 5 * 60_000];
/** A chatbot step still `installing` after this long belongs to a worker that died; it is taken over. */
export const SITE_CHATBOT_STALE_MS = 10 * 60_000;
/** MonCha account problems pause the step this long without using up a try. */
export const SITE_CHATBOT_ACCOUNT_PAUSE_MS = 15 * 60_000;
/** The lead's bot is still being created or trained: check again after this long, without using up a try. */
export const SITE_CHATBOT_BOT_WAIT_MS = 5 * 60_000;
/** MonCha's default widget colour, used when the website has no usable brand colour. */
export const WIDGET_DEFAULT_COLOR = '#1677FF';
/** Least contrast of the widget colour against its white icon and header text (WCAG for UI components). */
export const WIDGET_MIN_CONTRAST = 3;
export const CHATBOT_EMBED_START = '<!-- moncha-chatbot:start -->';
export const CHATBOT_EMBED_END = '<!-- moncha-chatbot:end -->';

/** Fields PUT widget accepts (internal-lead-agent.md 5.2); the endpoint rejects any other top-level field. */
const WIDGET_FIELDS = new Set([
  'botName',
  'tooltip',
  'disabledMessage',
  'welcomeMessage',
  'disclaimerText',
  'inputPlaceholder',
  'primaryColor',
  'textColor',
  'linkColor',
  'iconBgColor',
  'botAvatarBgColor',
  'voiceOrbColor',
  'launcherIconUrl',
  'botIconUrl',
  'userIconUrl',
  'agentIconUrl',
  'transparentIconBg',
  'showExpand',
  'darkMode',
  'fontSize',
  'chatHeightPct',
  'autoOpenDesktopSec',
  'autoOpenMobileSec',
  'requireTerms',
  'rtl',
  'chatDisabled',
  'showDownload',
  'termsUrl',
  'externalLinkUrl',
  'maxMessagesPerConversation',
  'iconSize',
  'iconShape',
  'position',
  'offsetBottom',
  'offsetSide',
  'offsetBottomMobile',
  'offsetSideMobile',
  'launcherShade',
  'hideBranding',
  'hideSources',
  'hideFeedback',
  'hideRefresh',
  'hideTooltip',
  'voiceMode',
  'ticketDepartments',
  'watermarkLink',
  'watermarkIconUrl',
  'quickPrompts',
  'followUpChips',
  'followUpPrompts',
  'translations',
  'strings',
  'bookingEnabled',
  'bookingConfig',
  'homeChannels',
]);
/** The only widget fields that accept null. */
const NULLABLE_WIDGET_FIELDS = new Set(['autoOpenDesktopSec', 'autoOpenMobileSec']);

/** `retryable` is false when trying again cannot help without someone changing something. */
export class SiteChatbotError extends Error {
  constructor(
    readonly code: string,
    message?: string,
    readonly retryable = true,
  ) {
    super(message ?? code);
    this.name = 'SiteChatbotError';
  }
}

type Rgb = [number, number, number];

/** `#abc`, `abc`, `#aabbcc` → `#AABBCC`; null for anything else. */
export function hexColor(value: string | null | undefined): string | null {
  const v = value?.trim().replace(/^#/, '') ?? '';
  if (/^[0-9a-f]{3}$/i.test(v)) return `#${[...v].map((c) => c + c).join('')}`.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(v)) return `#${v}`.toUpperCase();
  return null;
}

function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

function luminance([r, g, b]: Rgb): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Contrast ratio of a colour against white. */
export function contrastWithWhite(hex: string): number {
  return 1.05 / (luminance(rgb(hex)) + 0.05);
}

/** White, near-white and light greys: a widget in that colour would vanish on the page. */
function isPale(hex: string): boolean {
  const c = rgb(hex);
  return Math.max(...c) - Math.min(...c) < 24 && luminance(c) > 0.6;
}

/** Darkens the colour, keeping its hue, until white on it reaches WIDGET_MIN_CONTRAST. */
function readable(hex: string): string {
  let c = rgb(hex);
  for (let i = 0; i < 40 && contrastWithWhite(toHex(c)) < WIDGET_MIN_CONTRAST; i++) {
    c = c.map((v) => v * 0.92) as Rgb;
  }
  return toHex(c);
}

/**
 * The widget colour for a website: its brand's primary colour, else accent, else secondary (white and light greys
 * skipped), darkened when too light for white text, as six-digit uppercase hex. MonCha's default when none fits.
 */
export function widgetPrimaryColor(brand: Pick<SiteBrand, 'colors'> | null): string {
  const colors = brand?.colors;
  for (const value of [colors?.primary, colors?.accent, colors?.secondary]) {
    const hex = hexColor(value);
    if (hex && !isPale(hex)) return readable(hex);
  }
  return WIDGET_DEFAULT_COLOR;
}

/**
 * The PUT widget body: the current configuration (GET widget) with only `changes` applied. Fields the endpoint does
 * not accept are left out, nulls only where allowed, and hideBranding is always false (true is rejected).
 */
export function widgetConfigWith(config: WidgetConfig, changes: WidgetConfig): WidgetConfig {
  const next: WidgetConfig = {};
  for (const [key, value] of Object.entries(config)) {
    if (!WIDGET_FIELDS.has(key) || value === undefined) continue;
    if (value === null && !NULLABLE_WIDGET_FIELDS.has(key)) continue;
    next[key] = value;
  }
  Object.assign(next, changes);
  if ('hideBranding' in next) next.hideBranding = false;
  return next;
}

export function widgetConfigWithColor(config: WidgetConfig, primaryColor: string): WidgetConfig {
  return widgetConfigWith(config, { primaryColor });
}

/** Checks GET install values: widgetUrl must be set (never guessed) and https; apiUrl becomes its origin. */
export function embedValues(install: MonchaInstallValues): MonchaInstallValues & { widgetUrl: string } {
  if (!install.widgetUrl) {
    throw new SiteChatbotError(
      'widget_url_missing',
      'MonCha returned no widgetUrl for this bot (GET install); the widget script URL has to come from the MonCha team',
      false,
    );
  }
  let widget: URL;
  let api: URL;
  try {
    widget = new URL(install.widgetUrl);
    api = new URL(install.apiUrl);
  } catch {
    throw new SiteChatbotError('install_invalid', `GET install returned an invalid URL (${install.widgetUrl}, ${install.apiUrl})`, false);
  }
  if (widget.protocol !== 'https:') throw new SiteChatbotError('install_invalid', `widgetUrl is not https: ${install.widgetUrl}`, false);
  if (api.protocol !== 'https:' && api.protocol !== 'http:') {
    throw new SiteChatbotError('install_invalid', `apiUrl is not http(s): ${install.apiUrl}`, false);
  }
  return { tenantId: install.tenantId, chatbotId: install.chatbotId, apiUrl: api.origin, widgetUrl: widget.href };
}

/** JSON safe inside a <script> and ASCII only, so it can go into a page of any charset. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u007f-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** The documented embed: the widget script, then MonCha.init with the public install values (never the internal key). */
export function chatbotEmbed(values: MonchaInstallValues & { widgetUrl: string }): string {
  const src = values.widgetUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const init = scriptJson({ tenantId: values.tenantId, chatbotId: values.chatbotId, apiUrl: values.apiUrl });
  return [
    CHATBOT_EMBED_START,
    `<script src="${src}"></script>`,
    `<script>if (window.MonCha) window.MonCha.init(${init});</script>`,
    CHATBOT_EMBED_END,
  ].join('\n');
}

function isUtf16(bytes: Uint8Array, charset: string | null | undefined): boolean {
  if (/^utf-?(16|32)/i.test(charset?.trim() ?? '')) return true;
  return bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff));
}

/** One character per byte, so every byte of a page in any ASCII-compatible charset comes back unchanged. */
function bytesToLatin1(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return text;
}

function latin1ToBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

const EMBED_BLOCK = new RegExp(`\\n?${CHATBOT_EMBED_START}[\\s\\S]*?${CHATBOT_EMBED_END}\\n?`, 'g');
const META_CSP = /<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi;

/**
 * index.html with the embed just before its last `</body>` (else `</html>`, else at the end). An embed added earlier
 * is replaced, and Content-Security-Policy meta tags are removed so they cannot block the widget.
 */
export function injectChatbotEmbed(
  html: Uint8Array,
  embed: string,
  charset?: string | null,
): { bytes: Uint8Array; removedCsp: number } {
  if (isUtf16(html, charset)) {
    throw new SiteChatbotError('unsupported_charset', `index.html is ${charset || 'UTF-16'}; the chatbot embed cannot be added`, false);
  }
  let removedCsp = 0;
  let text = bytesToLatin1(html)
    .replace(EMBED_BLOCK, '')
    .replace(META_CSP, () => {
      removedCsp++;
      return '';
    });
  const lower = text.toLowerCase();
  let at = lower.lastIndexOf('</body');
  if (at < 0) at = lower.lastIndexOf('</html');
  if (at < 0) at = text.length;
  text = `${text.slice(0, at)}\n${embed}\n${text.slice(at)}`;
  return { bytes: latin1ToBytes(text), removedCsp };
}

export type SiteChatbotDeps = {
  snapshots: SiteSnapshotRepo;
  bots: LeadBotRepo;
  api: MonchaWidgetApi;
  store: SiteStore;
  logger: Logger;
  now?: () => Date;
};

export type SiteChatbotOutcome =
  | { status: 'installed'; snapshotId: string; leadId: string; primaryColor: string; widgetUrl: string; removedCsp: number }
  | { status: 'retry' | 'failed'; snapshotId: string; error: string }
  /** Not this website's fault (bot still training, MonCha account problem, rate limit): the try is given back. */
  | { status: 'paused'; snapshotId: string; error: string; until: Date };

type StepError = { code: string; text: string; retryable: boolean; status: number | null; retryAt?: Date };

function stepError(error: unknown): StepError {
  if (error instanceof SiteChatbotError) {
    return { code: error.code, text: `${error.code}: ${error.message}`.slice(0, 300), retryable: error.retryable, status: null };
  }
  const e = error as { code?: unknown; message?: unknown; status?: unknown; retryAt?: unknown };
  const code = typeof e?.code === 'string' ? e.code : 'error';
  const status = typeof e?.status === 'number' ? e.status : null;
  const message = typeof e?.message === 'string' ? e.message : String(error);
  // MonCha client errors carry `status` (null = no response); anything else (R2, bugs) is worth another try.
  const fromApi = typeof e?.code === 'string' && 'status' in (e ?? {});
  const retryable = !fromApi || status === null || status === 429 || status >= 500 || code === 'unexpected_response';
  return { code, text: `${code}: ${message}`.slice(0, 300), retryable, status, retryAt: e?.retryAt instanceof Date ? e.retryAt : undefined };
}

/** Adds the chatbot to one claimed copy (status `installing`, attempts already counted). Only touches chatbot* fields. */
export async function installSiteChatbot(
  deps: SiteChatbotDeps,
  snapshot: SiteSnapshotListItem,
  signal?: AbortSignal,
): Promise<SiteChatbotOutcome> {
  const now = deps.now ?? (() => new Date());
  const { tenantId, id: snapshotId, leadId } = snapshot;

  const giveBack = async (error: string | null, until: Date): Promise<SiteChatbotOutcome> => {
    await deps.snapshots.update(tenantId, snapshotId, {
      chatbotStatus: 'pending',
      chatbotAttempts: Math.max(0, snapshot.chatbotAttempts - 1),
      chatbotError: error ?? snapshot.chatbotError,
      chatbotNextAt: until,
      chatbotLockedAt: null,
    });
    if (error) deps.logger.error('site_chatbot_paused', { snapshotId, tenantId, error, until: until.toISOString() });
    return { status: 'paused', snapshotId, error: error ?? 'worker_shutdown', until };
  };

  try {
    const bot = await deps.bots.getForLead(tenantId, leadId);
    if (!bot) throw new SiteChatbotError('bot_missing', 'This lead has no MonCha bot', false);
    if (bot.status === 'failed' || bot.knowledgeStatus === 'failed') {
      const what = bot.status === 'failed' ? 'could not be created' : 'could not be trained';
      throw new SiteChatbotError('bot_failed', `The lead's MonCha bot ${what}: ${bot.error ?? 'unknown error'}`, false);
    }
    if (bot.status !== 'created' || bot.knowledgeStatus !== 'trained' || !bot.chatbotId) {
      const state = bot.status !== 'created' ? bot.status : bot.knowledgeStatus;
      return giveBack(`waiting_for_bot: the lead's MonCha bot is ${state}`, new Date(now().getTime() + SITE_CHATBOT_BOT_WAIT_MS));
    }
    const botId = bot.chatbotId;

    const primaryColor = widgetPrimaryColor(snapshot.brand);
    const before = await deps.api.widget({ botId, signal });
    const after = await deps.api.updateWidget({ botId, config: widgetConfigWithColor(before.config, primaryColor), signal });
    const saved = typeof after.config.primaryColor === 'string' ? after.config.primaryColor.toUpperCase() : null;
    await deps.bots.update(tenantId, bot.id, {
      widgetPrimaryColor: primaryColor,
      widgetConfigBefore: before.response,
      widgetConfig: after.response,
      widgetConfiguredAt: now(),
    });
    if (saved !== primaryColor) {
      throw new SiteChatbotError('widget_color_not_saved', `PUT widget answered primaryColor ${saved ?? 'missing'} instead of ${primaryColor}`);
    }

    const install = await deps.api.install({ botId, signal });
    await deps.bots.update(tenantId, bot.id, { installValues: install.response });
    const values = embedValues(install);

    const key = `${snapshot.storagePrefix}index.html`;
    const html = await deps.store.getBytes(key);
    if (!html) throw new SiteChatbotError('copy_files_missing', 'index.html is not in R2', false);
    if (signal?.aborted) throw new SiteChatbotError('worker_shutdown', 'worker is stopping');
    const injected = injectChatbotEmbed(html, chatbotEmbed(values), snapshot.sourceCharset);
    await deps.store.put(key, injected.bytes, `text/html; charset=${snapshot.sourceCharset || 'utf-8'}`);

    await deps.snapshots.update(tenantId, snapshotId, {
      chatbotStatus: 'installed',
      chatbotError: null,
      chatbotNextAt: null,
      chatbotLockedAt: null,
      chatbotInstalledAt: now(),
    });
    deps.logger.info('site_chatbot_installed', {
      snapshotId,
      tenantId,
      leadId,
      chatbotId: values.chatbotId,
      primaryColor,
      removedCsp: injected.removedCsp,
    });
    return { status: 'installed', snapshotId, leadId, primaryColor, widgetUrl: values.widgetUrl, removedCsp: injected.removedCsp };
  } catch (error) {
    const e = stepError(error);
    if (e.code === 'aborted' || e.code === 'worker_shutdown' || signal?.aborted) return giveBack(null, now());
    if (e.code !== 'branding_locked' && (MONCHA_ACCOUNT_CODES.has(e.code) || e.status === 401 || e.status === 402 || e.status === 403)) {
      return giveBack(e.text, new Date(now().getTime() + SITE_CHATBOT_ACCOUNT_PAUSE_MS));
    }
    if (e.status === 429) return giveBack(e.text, e.retryAt ?? new Date(now().getTime() + SITE_CHATBOT_BACKOFF_MS[0]!));

    const next = retryAfterError({
      attempts: snapshot.chatbotAttempts,
      maxAttempts: SITE_CHATBOT_MAX_ATTEMPTS,
      backoffMs: SITE_CHATBOT_BACKOFF_MS,
      retryable: e.retryable,
      shutdown: false,
      now: now(),
    });
    await deps.snapshots.update(tenantId, snapshotId, {
      chatbotStatus: next.giveUp ? 'failed' : 'pending',
      chatbotAttempts: next.attempts,
      chatbotError: e.text,
      chatbotNextAt: next.nextAt,
      chatbotLockedAt: null,
    });
    deps.logger.error(next.giveUp ? 'site_chatbot_failed' : 'site_chatbot_retry', { snapshotId, tenantId, attempts: next.attempts, error: e.text });
    return { status: next.giveUp ? 'failed' : 'retry', snapshotId, error: e.text };
  }
}

export class SiteChatbotRequestError extends Error {
  constructor(readonly code: 'not_found' | 'not_done' | 'busy') {
    super(code);
    this.name = 'SiteChatbotRequestError';
  }
}

/** "Add chatbot" / "Retry chatbot": queues the copy; the pipeline adds the chatbot, then pushes and redeploys it. */
export async function requestSiteChatbotInstall(
  deps: { snapshots: SiteSnapshotRepo; now?: () => Date },
  input: { tenantId: string; id: string },
): Promise<{ queued: true }> {
  const result = await deps.snapshots.requestChatbotInstall(input.tenantId, input.id, (deps.now ?? (() => new Date()))());
  if (result !== 'queued') throw new SiteChatbotRequestError(result);
  return { queued: true };
}

/** Bare hostname from a live Worker URL for PUT /bots/:botId/domains (6.2). */
export function hostnameFromWorkerUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname.trim().toLowerCase();
    return host || null;
  } catch {
    return null;
  }
}

export type ChatbotDomainsDeps = {
  bots: LeadBotRepo;
  api: Pick<MonchaWidgetApi, 'updateDomains'>;
  logger: Logger;
  now?: () => Date;
};

/**
 * After a Worker deploy: PUT /bots/:botId/domains with the live hostname so the widget only runs on that URL.
 * Returns null when the lead has no created bot or the URL has no hostname; throws MonCha API errors for the caller.
 */
export async function setChatbotDomainsForLiveUrl(
  deps: ChatbotDomainsDeps,
  input: { tenantId: string; leadId: string; workerUrl: string; signal?: AbortSignal },
): Promise<{ domains: string[] } | null> {
  const host = hostnameFromWorkerUrl(input.workerUrl);
  if (!host) return null;
  const bot = await deps.bots.getForLead(input.tenantId, input.leadId);
  if (!bot?.chatbotId || bot.status !== 'created') return null;

  const result = await deps.api.updateDomains({ botId: bot.chatbotId, domains: [host], signal: input.signal });
  await deps.bots.update(input.tenantId, bot.id, {
    domains: result.domains,
    domainsConfiguredAt: (deps.now ?? (() => new Date()))(),
  });
  deps.logger.info('site_chatbot_domains_set', {
    tenantId: input.tenantId,
    leadId: input.leadId,
    chatbotId: bot.chatbotId,
    domains: result.domains,
  });
  return { domains: result.domains };
}

/** Background behind the bot's profile picture, so dark and transparent logos stay visible. */
export const CHATBOT_AVATAR_BG = '#FFFFFF';
/** Site icons smaller than this (16/32 px favicons) turn blurry in the avatar. */
export const AVATAR_MIN_ICON_PX = 48;
/** Size stand-in for icons whose pixel size could not be read (AVIF, or no bytes given). */
const AVATAR_MIN_ICON_BYTES = 1_500;
/** At most this many site icons are opened to read their pixel size. */
const AVATAR_MAX_ICONS_READ = 10;
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/avif', 'image/gif', 'image/svg+xml']);
const ICO_TYPES = new Set(['image/x-icon', 'image/vnd.microsoft.icon']);
/** Default favicons of site builders and CMSs: they show the builder's mark, not the business. */
const GENERIC_ICON =
  /wix\.com\/favicon|parastorage\.com\/client\/pfavico|s\.w\.org\/|wordpress\.com\/i\/(webclip|favicon)|squarespace\.com\/universal\/default-favicon/i;
/** Marks of other companies that sites embed (review widgets, social links, payment badges). */
const THIRD_PARTY_MARK =
  /google[-_]?(logo|review)|google-reviews|facebook|whatsapp|instagram|linkedin|twitter|tiktok|youtube|trustpilot|tripadvisor|yelp|paypal|visa|mastercard|stripe|apple-pay|badge/i;

const baseType = (asset: SiteManifestAsset) => asset.contentType.split(';')[0]!.trim().toLowerCase();

/** Pixel sizes of the copy's site icons (`kind: icon`), read from their file headers. */
export async function chatbotIconSizes(
  manifest: Pick<SiteManifest, 'assets'>,
  readAsset: (asset: SiteManifestAsset) => Promise<Uint8Array | null>,
): Promise<Map<string, ImageSize>> {
  const sizes = new Map<string, ImageSize>();
  const icons = manifest.assets.filter((a) => a.kind === 'icon' && a.bytes > 0 && a.bytes <= AVATAR_MAX_BYTES);
  for (const asset of icons.slice(0, AVATAR_MAX_ICONS_READ)) {
    const bytes = await readAsset(asset).catch(() => null);
    const size = bytes ? imageSize(bytes) : null;
    if (size) sizes.set(asset.id, size);
  }
  return sizes;
}

/**
 * The image for the bot's profile picture: the website's favicon (`<link rel="icon">` / apple-touch-icon) when it is at
 * least AVATAR_MIN_ICON_PX square-ish, largest first; else the header logo; else any `.ico`. `sizes` are the icons'
 * pixel sizes (chatbotIconSizes); without one, a raster icon is judged by file size and a `.ico` waits for the last step.
 * Null when the copy has no usable image.
 */
export function chatbotAvatarAsset(
  manifest: Pick<SiteManifest, 'assets'>,
  brand: Pick<SiteBrand, 'logo'> | null,
  sizes?: ReadonlyMap<string, ImageSize>,
): SiteManifestAsset | null {
  const usable = manifest.assets.filter(
    (a) => a.bytes > 0 && a.bytes <= AVATAR_MAX_BYTES && !GENERIC_ICON.test(a.url) && !THIRD_PARTY_MARK.test(a.url),
  );
  const bigEnough = (a: SiteManifestAsset) => {
    if (baseType(a) === 'image/svg+xml') return true;
    const size = sizes?.get(a.id);
    if (size) return Math.min(size.width, size.height) >= AVATAR_MIN_ICON_PX;
    return !ICO_TYPES.has(baseType(a)) && a.bytes >= AVATAR_MIN_ICON_BYTES;
  };
  const rank = (a: SiteManifestAsset) => {
    if (baseType(a) === 'image/svg+xml') return Number.MAX_SAFE_INTEGER;
    const size = sizes?.get(a.id);
    return size ? size.width * size.height : 0;
  };
  const icon = usable
    .filter((a) => a.kind === 'icon' && (AVATAR_TYPES.has(baseType(a)) || ICO_TYPES.has(baseType(a))) && bigEnough(a))
    .sort((a, b) => rank(b) - rank(a) || b.bytes - a.bytes)[0];
  if (icon) return icon;
  const logoId = brand?.logo?.assetId;
  const logo = logoId ? usable.find((a) => a.id === logoId && AVATAR_TYPES.has(baseType(a))) : undefined;
  if (logo) return logo;
  return usable.find((a) => a.kind === 'icon' && ICO_TYPES.has(baseType(a))) ?? null;
}

/** https URL of a copied file on the live Worker, which serves every asset at `/<storedPath>`. */
export function liveAssetUrl(workerUrl: string, storedPath: string): string | null {
  try {
    const base = new URL(workerUrl);
    if (base.protocol !== 'https:') return null;
    const path = storedPath.replace(/^\/+/, '').split('/').map(encodeURIComponent).join('/');
    return path ? new URL(`/${path}`, base.origin).href : null;
  } catch {
    return null;
  }
}

function urlOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export type ChatbotAvatarDeps = {
  bots: LeadBotRepo;
  api: Pick<MonchaWidgetApi, 'widget' | 'updateWidget'>;
  logger: Logger;
  now?: () => Date;
};

/**
 * After a Worker deploy: the bot's profile picture (botIconUrl) and launcher button (launcherIconUrl) become the website's
 * icon or logo as the live copy serves it, on a white background for the avatar. When the copy has no usable image,
 * a picture taken earlier from this same Worker is removed (initials again); one set by someone else is left alone.
 * Null when the lead has no created bot; `changed: false` when the widget already matches. Throws MonCha API errors.
 */
export async function setChatbotAvatarForLiveUrl(
  deps: ChatbotAvatarDeps,
  input: {
    tenantId: string;
    leadId: string;
    workerUrl: string;
    manifest: Pick<SiteManifest, 'assets'>;
    brand: Pick<SiteBrand, 'logo'> | null;
    /** The copy's file bytes, used to read the site icons' pixel sizes. */
    readAsset?: (asset: SiteManifestAsset) => Promise<Uint8Array | null>;
    signal?: AbortSignal;
  },
): Promise<{ botIconUrl: string | null; changed: boolean } | null> {
  const bot = await deps.bots.getForLead(input.tenantId, input.leadId);
  if (!bot?.chatbotId || bot.status !== 'created') return null;
  const sizes = input.readAsset ? await chatbotIconSizes(input.manifest, input.readAsset) : undefined;
  const asset = chatbotAvatarAsset(input.manifest, input.brand, sizes);
  const botIconUrl = asset ? liveAssetUrl(input.workerUrl, asset.storedPath) : null;

  const before = await deps.api.widget({ botId: bot.chatbotId, signal: input.signal });
  const current = typeof before.config.botIconUrl === 'string' ? before.config.botIconUrl : null;
  const currentLauncher = typeof before.config.launcherIconUrl === 'string' ? before.config.launcherIconUrl : null;
  const bg = typeof before.config.botAvatarBgColor === 'string' ? before.config.botAvatarBgColor.toUpperCase() : null;
  let config: WidgetConfig;
  if (botIconUrl) {
    if (current === botIconUrl && currentLauncher === botIconUrl && bg === CHATBOT_AVATAR_BG) {
      return { botIconUrl, changed: false };
    }
    config = widgetConfigWith(before.config, {
      botIconUrl,
      botAvatarBgColor: CHATBOT_AVATAR_BG,
      launcherIconUrl: botIconUrl,
    });
  } else {
    const origin = urlOrigin(input.workerUrl);
    if (!origin || !current?.startsWith(`${origin}/`)) return { botIconUrl: null, changed: false };
    config = widgetConfigWith(before.config, {});
    delete config.botIconUrl;
    delete config.botAvatarBgColor;
    delete config.launcherIconUrl;
  }

  const after = await deps.api.updateWidget({ botId: bot.chatbotId, config, signal: input.signal });
  await deps.bots.update(input.tenantId, bot.id, {
    widgetConfig: after.response,
    widgetConfiguredAt: (deps.now ?? (() => new Date()))(),
  });
  const saved = typeof after.config.botIconUrl === 'string' && after.config.botIconUrl ? after.config.botIconUrl : null;
  if (saved !== botIconUrl) {
    throw new SiteChatbotError('widget_icon_not_saved', `PUT widget answered botIconUrl ${saved ?? 'missing'} instead of ${botIconUrl ?? 'none'}`);
  }
  deps.logger.info(botIconUrl ? 'site_chatbot_avatar_set' : 'site_chatbot_avatar_cleared', {
    tenantId: input.tenantId,
    leadId: input.leadId,
    chatbotId: bot.chatbotId,
    botIconUrl,
    ...(asset ? { source: asset.kind === 'icon' ? 'site_icon' : 'logo' } : { removed: current }),
  });
  return { botIconUrl, changed: true };
}
