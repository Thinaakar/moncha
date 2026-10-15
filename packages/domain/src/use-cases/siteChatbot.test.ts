import { describe, expect, it } from 'vitest';
import type { LeadBotItem, LeadBotPatch, LeadBotRepo, Logger, MonchaWidgetApi, SiteSnapshotPatch, SiteSnapshotRepo, SiteStore } from '../ports';
import { FIXTURE_NOW, siteSnapshotFixture } from './__fixtures__/site-snapshot';
import {
  CHATBOT_EMBED_END,
  CHATBOT_EMBED_START,
  chatbotEmbed,
  contrastWithWhite,
  embedValues,
  injectChatbotEmbed,
  installSiteChatbot,
  SITE_CHATBOT_BOT_WAIT_MS,
  WIDGET_DEFAULT_COLOR,
  WIDGET_MIN_CONTRAST,
  widgetConfigWithColor,
  widgetPrimaryColor,
} from './siteChatbot';

const NOW = FIXTURE_NOW;
const logger: Logger = { info: () => undefined, error: () => undefined };
const enc = new TextEncoder();
const dec = new TextDecoder();
const INSTALL = {
  tenantId: 'mt-1',
  chatbotId: 'mb-1',
  apiUrl: 'https://api.dev-moncha.com',
  widgetUrl: 'https://cdn.dev-moncha.com/moncha-widget.iife.js',
};
const brand = (primary: string | null, accent: string | null = null, secondary: string | null = null) => ({
  colors: { primary, secondary, accent, background: '#ffffff', text: '#111111' },
});

describe('widgetPrimaryColor', () => {
  it("uses the website's primary colour as six-digit uppercase hex", () => {
    expect(widgetPrimaryColor(brand('#b91c1c'))).toBe('#B91C1C');
    expect(widgetPrimaryColor(brand('#036'))).toBe('#003366');
  });

  it('falls back to accent, then secondary, skipping white and light greys, then the MonCha default', () => {
    expect(widgetPrimaryColor(brand('#ffffff', '#0f766e'))).toBe('#0F766E');
    expect(widgetPrimaryColor(brand(null, 'not-a-colour', '#1d4ed8'))).toBe('#1D4ED8');
    expect(widgetPrimaryColor(brand('#f5f5f5', '#eeeeee'))).toBe(WIDGET_DEFAULT_COLOR);
    expect(widgetPrimaryColor(null)).toBe(WIDGET_DEFAULT_COLOR);
  });

  it('darkens a colour too light for white text, keeping its hue', () => {
    const color = widgetPrimaryColor(brand('#ffcc00'));
    expect(color).not.toBe('#FFCC00');
    expect(contrastWithWhite(color)).toBeGreaterThanOrEqual(WIDGET_MIN_CONTRAST);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(color.slice(i, i + 2), 16));
    expect(r! > g! && g! > b!).toBe(true);
  });
});

describe('widgetConfigWithColor', () => {
  it('keeps every documented field as it is and changes only primaryColor', () => {
    const config = {
      botName: 'Tumble Laundromat',
      welcomeMessage: 'Hi!',
      primaryColor: '#1877F2',
      position: 'bottom-right',
      hideBranding: false,
      ticketDepartments: { billing: true },
      autoOpenDesktopSec: null,
    };
    expect(widgetConfigWithColor(config, '#B91C1C')).toEqual({ ...config, primaryColor: '#B91C1C' });
  });

  it('drops fields the PUT rejects and nulls where not allowed, and never sends hideBranding true', () => {
    expect(widgetConfigWithColor({ botName: 'A', id: 'x', updatedAt: 'y', tooltip: null, hideBranding: true }, '#000000')).toEqual({
      botName: 'A',
      primaryColor: '#000000',
      hideBranding: false,
    });
  });
});

describe('chatbot embed', () => {
  it('needs a real https widgetUrl and reduces apiUrl to its origin', () => {
    expect(embedValues({ ...INSTALL, apiUrl: 'https://api.dev-moncha.com/vendor/internal/v1' }).apiUrl).toBe('https://api.dev-moncha.com');
    expect(() => embedValues({ ...INSTALL, widgetUrl: null })).toThrow(/widgetUrl/);
    expect(() => embedValues({ ...INSTALL, widgetUrl: 'http://cdn.example.com/w.js' })).toThrow(/https/);
  });

  it('is the documented script plus MonCha.init with only the public install values', () => {
    const embed = chatbotEmbed(embedValues(INSTALL));
    expect(embed).toContain(`<script src="${INSTALL.widgetUrl}"></script>`);
    expect(embed).toContain('window.MonCha.init({"tenantId":"mt-1","chatbotId":"mb-1","apiUrl":"https://api.dev-moncha.com"})');
    expect(chatbotEmbed({ ...INSTALL, tenantId: '</script><b>' })).not.toContain('</script><b>');
  });

  it('goes before the last </body>, replaces an earlier embed and removes CSP meta tags', () => {
    const html = enc.encode(
      '<html><head><meta http-equiv="Content-Security-Policy" content="script-src \'self\'"></head><body><p>Hi</p></BODY></html>',
    );
    const once = injectChatbotEmbed(html, chatbotEmbed(embedValues(INSTALL)));
    const text = dec.decode(once.bytes);
    expect(once.removedCsp).toBe(1);
    expect(text).not.toMatch(/content-security-policy/i);
    expect(text.indexOf(CHATBOT_EMBED_END)).toBeLessThan(text.indexOf('</BODY>'));

    const twice = dec.decode(injectChatbotEmbed(once.bytes, chatbotEmbed(embedValues({ ...INSTALL, chatbotId: 'mb-2' }))).bytes);
    expect(twice.split(CHATBOT_EMBED_START)).toHaveLength(2);
    expect(twice).toContain('"chatbotId":"mb-2"');
  });

  it('leaves every other byte unchanged, whatever the charset', () => {
    const latin = new Uint8Array([...enc.encode('<body>caf'), 0xe9, 0x80, ...enc.encode('</body>')]);
    const out = injectChatbotEmbed(latin, 'X', 'windows-1252').bytes;
    expect([...out.slice(0, 11)]).toEqual([...latin.slice(0, 11)]);
    expect(() => injectChatbotEmbed(new Uint8Array([0xff, 0xfe, 0x3c, 0]), 'X')).toThrow(/UTF-16/);
  });
});

function setup(options: { bot?: Partial<LeadBotItem> | null; html?: string | null; savedColor?: string; install?: Partial<typeof INSTALL> & { widgetUrl?: string | null } } = {}) {
  const snapshot = siteSnapshotFixture({
    githubStatus: 'pending',
    chatbotStatus: 'installing',
    chatbotAttempts: 1,
    brand: { ...brand('#b91c1c'), businessName: null } as never,
  });
  const snapPatches: SiteSnapshotPatch[] = [];
  const botPatches: LeadBotPatch[] = [];
  const bot =
    options.bot === null
      ? null
      : ({ id: 'bot1', status: 'created', knowledgeStatus: 'trained', chatbotId: 'mb-1', error: 'success', ...options.bot } as LeadBotItem);
  const objects = new Map<string, Uint8Array>();
  if (options.html !== null) objects.set('sites/t1/snap1/index.html', enc.encode(options.html ?? '<html><body>Hi</body></html>'));
  const calls: Array<{ method: string; config?: unknown }> = [];
  const current = { botName: 'Jurong Academy', primaryColor: '#1877F2', hideBranding: false };

  const api: MonchaWidgetApi = {
    widget: async () => {
      calls.push({ method: 'GET widget' });
      return { config: current, response: { config: current } };
    },
    updateWidget: async ({ config }) => {
      calls.push({ method: 'PUT widget', config });
      const saved = { ...config, primaryColor: options.savedColor ?? config.primaryColor };
      return { config: saved, response: { config: saved } };
    },
    install: async () => {
      calls.push({ method: 'GET install' });
      const values = { ...INSTALL, ...options.install };
      return { ...values, response: values };
    },
  };
  const deps = {
    snapshots: {
      update: async (_t: string, _id: string, patch: SiteSnapshotPatch) => {
        snapPatches.push(patch);
        return null;
      },
    } as unknown as SiteSnapshotRepo,
    bots: {
      getForLead: async () => bot,
      update: async (_t: string, _id: string, patch: LeadBotPatch) => {
        botPatches.push(patch);
        return null;
      },
    } as unknown as LeadBotRepo,
    api,
    store: {
      getBytes: async (key: string) => objects.get(key) ?? null,
      put: async (key: string, bytes: Uint8Array) => {
        objects.set(key, bytes);
      },
      get: async () => null,
    } as SiteStore,
    logger,
    now: () => NOW,
  };
  return { deps, snapshot, snapPatches, botPatches, objects, calls };
}

describe('installSiteChatbot', () => {
  it('sets the widget colour (GET then PUT), reads the install values and adds the embed to index.html', async () => {
    const t = setup();
    const outcome = await installSiteChatbot(t.deps, t.snapshot);

    expect(outcome).toMatchObject({ status: 'installed', primaryColor: '#B91C1C', widgetUrl: INSTALL.widgetUrl });
    expect(t.calls.map((c) => c.method)).toEqual(['GET widget', 'PUT widget', 'GET install']);
    expect(t.calls[1]!.config).toEqual({ botName: 'Jurong Academy', primaryColor: '#B91C1C', hideBranding: false });
    expect(t.botPatches).toEqual([
      {
        widgetPrimaryColor: '#B91C1C',
        widgetConfigBefore: { config: { botName: 'Jurong Academy', primaryColor: '#1877F2', hideBranding: false } },
        widgetConfig: { config: { botName: 'Jurong Academy', primaryColor: '#B91C1C', hideBranding: false } },
        widgetConfiguredAt: NOW,
      },
      { installValues: INSTALL },
    ]);
    expect(dec.decode(t.objects.get('sites/t1/snap1/index.html'))).toContain(`<script src="${INSTALL.widgetUrl}"></script>`);
    expect(t.snapPatches.at(-1)).toEqual({
      chatbotStatus: 'installed',
      chatbotError: null,
      chatbotNextAt: null,
      chatbotLockedAt: null,
      chatbotInstalledAt: NOW,
    });
  });

  it('waits without using a try while the bot is still training', async () => {
    const t = setup({ bot: { knowledgeStatus: 'training' } });
    const outcome = await installSiteChatbot(t.deps, t.snapshot);
    expect(outcome).toMatchObject({ status: 'paused', until: new Date(NOW.getTime() + SITE_CHATBOT_BOT_WAIT_MS) });
    expect(t.snapPatches[0]).toMatchObject({ chatbotStatus: 'pending', chatbotAttempts: 0, chatbotError: "waiting_for_bot: the lead's MonCha bot is training" });
    expect(t.calls).toEqual([]);
  });

  it('fails at once when the bot failed or MonCha has no widgetUrl, leaving index.html as it was', async () => {
    const failedBot = setup({ bot: { knowledgeStatus: 'failed', error: 'training_failed: 16 pages failed' } });
    expect(await installSiteChatbot(failedBot.deps, failedBot.snapshot)).toMatchObject({ status: 'failed' });
    expect(failedBot.snapPatches[0]).toMatchObject({ chatbotStatus: 'failed', chatbotError: expect.stringMatching(/^bot_failed: /) });

    const noUrl = setup({ install: { widgetUrl: null } });
    expect(await installSiteChatbot(noUrl.deps, noUrl.snapshot)).toMatchObject({ status: 'failed', error: expect.stringMatching(/^widget_url_missing/) });
    expect(dec.decode(noUrl.objects.get('sites/t1/snap1/index.html'))).toBe('<html><body>Hi</body></html>');
  });

  it('retries when MonCha did not save the colour, and gives up after 3 tries', async () => {
    const first = setup({ savedColor: '#1877F2' });
    expect(await installSiteChatbot(first.deps, first.snapshot)).toMatchObject({ status: 'retry', error: expect.stringMatching(/^widget_color_not_saved/) });

    const last = setup({ savedColor: '#1877F2' });
    expect(await installSiteChatbot(last.deps, { ...last.snapshot, chatbotAttempts: 3 })).toMatchObject({ status: 'failed' });
  });

  it('pauses on MonCha account errors and gives the try back', async () => {
    const t = setup();
    t.deps.api.widget = async () => {
      throw Object.assign(new Error('MonCha rejected MONCHA_INTERNAL_KEY'), { code: 'invalid_internal_credentials', status: 401 });
    };
    expect(await installSiteChatbot(t.deps, t.snapshot)).toMatchObject({ status: 'paused' });
    expect(t.snapPatches[0]).toMatchObject({ chatbotStatus: 'pending', chatbotAttempts: 0 });
  });
});
