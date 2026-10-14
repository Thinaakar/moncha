import {
  SiteGithubError,
  type Logger,
  type SiteGithubFile,
  type SiteGithubPublisher,
  type SiteGithubRepoSpec,
  type SiteManifest,
  type SiteSnapshotListItem,
  type SiteSnapshotRepo,
  type SiteStore,
} from '../ports';

/** Total tries before the push is marked failed; the waits between them are SITE_GITHUB_BACKOFF_MS. */
export const SITE_GITHUB_MAX_ATTEMPTS = 3;
export const SITE_GITHUB_BACKOFF_MS = [60_000, 5 * 60_000];
/** A push still `pushing` after this long belongs to a worker that died; it is taken over. */
export const SITE_GITHUB_STALE_MS = 10 * 60_000;
/** compatibility_date of site Workers, both in the repo's wrangler.jsonc and in API deploys. */
export const SITE_WORKER_COMPATIBILITY_DATE = '2025-09-01';
/** Topic every site repo carries; a repo without it is never overwritten. */
export const SITE_REPO_TOPIC = 'moncha-site';

/** Where the website itself lives in a site repo (served by the Worker); copy metadata goes to `moncha/`. */
const PUBLIC_DIR = 'public';
const META_DIR = 'moncha';
const NAME_MAX = 63;

/** Lowercase host without `www.`, safe for a path. */
export function siteGithubDomain(snapshot: { company: { domain: string | null }; finalUrl: string | null; sourceUrl: string }): string {
  let host = snapshot.company.domain?.trim() || '';
  if (!host) {
    try {
      host = new URL(snapshot.finalUrl || snapshot.sourceUrl).hostname;
    } catch {
      host = '';
    }
  }
  host = host.replace(/^[a-z]+:\/\//i, '').split('/')[0]!.toLowerCase().replace(/^www\./, '');
  const safe = host.replace(/[^a-z0-9.-]/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return safe || 'unknown-domain';
}

/**
 * The website's name: its domain with dots as dashes (`ja.edu.sg` → `ja-edu-sg`). Used for the GitHub repo,
 * the Cloudflare Worker and its `{name}.{subdomain}.workers.dev` URL, so it fits one DNS label.
 */
export function siteName(snapshot: { id: string; company: { domain: string | null }; finalUrl: string | null; sourceUrl: string }): string {
  const domain = siteGithubDomain(snapshot);
  if (domain === 'unknown-domain') return `copy-${snapshot.id.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, NAME_MAX);
  const name = domain
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, NAME_MAX)
    .replace(/^-+|-+$/g, '');
  return name || `copy-${snapshot.id.toLowerCase()}`.slice(0, NAME_MAX);
}

/** R2 key (relative to the copy) → path in the site repo. Screenshots and rendered.html stay in R2. */
export function siteRepoPaths(manifest: Pick<SiteManifest, 'assets'>): Array<{ key: string; path: string }> {
  const assets = [...new Set(manifest.assets.map((a) => a.storedPath))];
  return [
    { key: 'index.html', path: `${PUBLIC_DIR}/index.html` },
    ...assets.map((key) => ({ key, path: `${PUBLIC_DIR}/${key}` })),
    { key: 'brand.json', path: `${META_DIR}/brand.json` },
    { key: 'manifest.json', path: `${META_DIR}/manifest.json` },
    { key: 'source.html', path: `${META_DIR}/source.html` },
  ];
}

function originLabel(snapshot: Pick<SiteSnapshotListItem, 'origin'>): string {
  return snapshot.origin === 'auto' ? 'Automatic' : 'Manual';
}

export function siteRepoSpec(snapshot: SiteSnapshotListItem, liveUrl: string | null): SiteGithubRepoSpec {
  const domain = siteGithubDomain(snapshot);
  return {
    name: siteName(snapshot),
    description: `${snapshot.company.name} (${domain}) · ${originLabel(snapshot)} website copy by MonCha`.slice(0, 340),
    homepage: liveUrl,
    topics: [SITE_REPO_TOPIC, snapshot.origin === 'auto' ? 'auto-copy' : 'manual-copy'],
  };
}

export function siteRepoReadme(snapshot: SiteSnapshotListItem, liveUrl: string | null): string {
  const source = snapshot.finalUrl || snapshot.sourceUrl;
  const captured = (snapshot.finishedAt ?? snapshot.createdAt).toISOString();
  const origin =
    snapshot.origin === 'auto' ? 'Automatic (copied by the copy automation after a country crawl)' : 'Manual (started from the MonCha console)';
  return [
    `# ${snapshot.company.name}`,
    '',
    `Website copy of [${siteGithubDomain(snapshot)}](${source}).`,
    '',
    '| | |',
    '| --- | --- |',
    `| Live website | ${liveUrl ? `[${liveUrl.replace(/^https:\/\//, '')}](${liveUrl})` : 'Not deployed yet'} |`,
    `| Original website | ${source} |`,
    `| Copy type | ${origin} |`,
    `| Captured | ${captured} |`,
    `| Copy ID | \`${snapshot.id}\` |`,
    '',
    '## Files',
    '',
    `- \`${PUBLIC_DIR}/\` is the website: \`index.html\` plus every copied asset. The Cloudflare Worker serves this folder.`,
    `- \`${META_DIR}/brand.json\` holds the extracted brand, \`${META_DIR}/manifest.json\` lists every asset and skipped file, and \`${META_DIR}/source.html\` is the HTML exactly as the site served it.`,
    '- `wrangler.jsonc` deploys the same Worker by hand: `npx wrangler deploy`.',
    '',
    'MonCha updates this repository every time the website is copied again.',
    '',
  ].join('\n');
}

export function siteRepoWranglerConfig(name: string): string {
  return `${JSON.stringify(
    {
      name,
      compatibility_date: SITE_WORKER_COMPATIBILITY_DATE,
      assets: { directory: `./${PUBLIC_DIR}`, html_handling: 'auto-trailing-slash', not_found_handling: 'none' },
    },
    null,
    2,
  )}\n`;
}

export type SiteGithubPushDeps = {
  snapshots: SiteSnapshotRepo;
  store: SiteStore;
  publisher: SiteGithubPublisher;
  logger: Logger;
  /** Worker URL of a site name, for the README and the repo homepage before the copy is deployed. */
  liveUrlFor?: (name: string) => Promise<string | null>;
  now?: () => Date;
};

export type SiteGithubPushOutcome =
  | { status: 'pushed'; snapshotId: string; repo: string; commitUrl: string; files: number }
  | { status: 'retry' | 'failed'; snapshotId: string; error: string }
  | { status: 'rate_limited'; snapshotId: string; error: string; retryAt: Date };

/** Wait after a GitHub rate limit that did not say how long (its secondary limits often don't). */
export const SITE_GITHUB_RATE_LIMIT_WAIT_MS = 15 * 60_000;

const FILE_READ_CONCURRENCY = 6;

/** Reads `key`s from the copy's R2 folder; files a copy never had (older copies) are skipped. */
export async function readSiteFiles<T extends { key: string }>(
  store: SiteStore,
  prefix: string,
  entries: T[],
): Promise<Array<T & { bytes: Uint8Array }>> {
  const files: Array<T & { bytes: Uint8Array }> = [];
  let next = 0;
  const worker = async () => {
    while (next < entries.length) {
      const entry = entries[next++]!;
      const bytes = await store.getBytes(`${prefix}${entry.key}`);
      if (bytes) files.push({ ...entry, bytes });
    }
  };
  await Promise.all(Array.from({ length: Math.min(FILE_READ_CONCURRENCY, entries.length) }, worker));
  return files;
}

export async function readSiteManifest(store: SiteStore, prefix: string, missing: () => Error): Promise<SiteManifest> {
  const bytes = await store.getBytes(`${prefix}manifest.json`);
  if (!bytes) throw missing();
  return JSON.parse(new TextDecoder().decode(bytes)) as SiteManifest;
}

function commitMessage(snapshot: SiteSnapshotListItem): string {
  return [
    `Website copy of ${siteGithubDomain(snapshot)}`,
    '',
    `Company: ${snapshot.company.name}`,
    `Source: ${snapshot.finalUrl || snapshot.sourceUrl}`,
    `Captured: ${(snapshot.finishedAt ?? snapshot.createdAt).toISOString()}`,
    `Copy type: ${originLabel(snapshot)}`,
    `Copy ID: ${snapshot.id}`,
  ].join('\n');
}

function errorText(error: unknown): { code: string; text: string; retryable: boolean } {
  if (error instanceof SiteGithubError) {
    return { code: error.code, text: `${error.code}: ${error.message}`.slice(0, 300), retryable: error.retryable };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'error', text: `error: ${message}`.slice(0, 300), retryable: true };
}

/** Next state after a failed try: back to `pending` with a wait, or given up. A shutdown does not use up a try. */
export function retryAfterError(input: {
  attempts: number;
  maxAttempts: number;
  backoffMs: number[];
  retryable: boolean;
  shutdown: boolean;
  now: Date;
}): { giveUp: boolean; attempts: number; nextAt: Date | null } {
  const attempts = input.shutdown ? Math.max(0, input.attempts - 1) : input.attempts;
  const giveUp = !input.shutdown && (!input.retryable || attempts >= input.maxAttempts);
  const waitMs = input.shutdown ? 0 : (input.backoffMs[Math.min(attempts, input.backoffMs.length) - 1] ?? 60_000);
  return { giveUp, attempts, nextAt: giveUp ? null : new Date(input.now.getTime() + waitMs) };
}

/**
 * Pushes one claimed copy (status `pushing`, attempts already counted) to its own repo as one commit.
 * Never touches the copy's own status: a GitHub problem only changes the github* fields.
 */
export async function pushSiteSnapshotToGithub(
  deps: SiteGithubPushDeps,
  snapshot: SiteSnapshotListItem,
  signal?: AbortSignal,
): Promise<SiteGithubPushOutcome> {
  const now = deps.now ?? (() => new Date());
  const { tenantId, id: snapshotId } = snapshot;
  try {
    const manifest = await readSiteManifest(
      deps.store,
      snapshot.storagePrefix,
      () => new SiteGithubError('copy_files_missing', 'manifest.json is not in R2', false),
    );
    const name = siteName(snapshot);
    const liveUrl = snapshot.workerUrl ?? (deps.liveUrlFor ? await deps.liveUrlFor(name).catch(() => null) : null);
    const stored = await readSiteFiles(deps.store, snapshot.storagePrefix, siteRepoPaths(manifest));
    if (signal?.aborted) throw new SiteGithubError('worker_shutdown', 'worker is stopping');
    if (!stored.some((f) => f.key === 'index.html')) throw new SiteGithubError('copy_files_missing', 'index.html is not in R2', false);

    const encoder = new TextEncoder();
    const files: SiteGithubFile[] = [
      { path: 'README.md', bytes: encoder.encode(siteRepoReadme(snapshot, liveUrl)) },
      { path: 'wrangler.jsonc', bytes: encoder.encode(siteRepoWranglerConfig(name)) },
      ...stored.map((f) => ({ path: f.path, bytes: f.bytes })),
    ].sort((a, b) => a.path.localeCompare(b.path));

    const result = await deps.publisher.publish({
      repo: siteRepoSpec(snapshot, liveUrl),
      files,
      message: commitMessage(snapshot),
      signal,
    });
    await deps.snapshots.update(tenantId, snapshotId, {
      githubStatus: 'pushed',
      githubRepo: result.repo,
      githubCommitSha: result.commitSha,
      githubCommitUrl: result.commitUrl,
      githubFolderUrl: result.repoUrl,
      githubError: null,
      githubNextAt: null,
      githubLockedAt: null,
      githubPushedAt: now(),
    });
    deps.logger.info('site_github_pushed', {
      snapshotId,
      tenantId,
      repo: result.repo,
      created: result.created,
      files: files.length,
      commit: result.commitSha,
    });
    return { status: 'pushed', snapshotId, repo: result.repo, commitUrl: result.commitUrl, files: files.length };
  } catch (error) {
    const { code, text, retryable } = errorText(error);
    if (code === 'github_rate_limited') {
      // The account is limited, not this copy: the claim's try is given back and the copy waits for the limit.
      const retryAt =
        (error as SiteGithubError).retryAt ?? new Date(now().getTime() + SITE_GITHUB_RATE_LIMIT_WAIT_MS);
      await deps.snapshots.update(tenantId, snapshotId, {
        githubStatus: 'pending',
        githubAttempts: Math.max(0, snapshot.githubAttempts - 1),
        githubError: text,
        githubNextAt: retryAt,
        githubLockedAt: null,
      });
      deps.logger.error('site_github_rate_limited', { snapshotId, tenantId, retryAt: retryAt.toISOString(), error: text });
      return { status: 'rate_limited', snapshotId, error: text, retryAt };
    }
    const shutdown = code === 'worker_shutdown' || Boolean(signal?.aborted);
    const next = retryAfterError({
      attempts: snapshot.githubAttempts,
      maxAttempts: SITE_GITHUB_MAX_ATTEMPTS,
      backoffMs: SITE_GITHUB_BACKOFF_MS,
      retryable,
      shutdown,
      now: now(),
    });
    await deps.snapshots.update(tenantId, snapshotId, {
      githubStatus: next.giveUp ? 'failed' : 'pending',
      githubAttempts: next.attempts,
      githubError: shutdown ? snapshot.githubError : text,
      githubNextAt: next.nextAt,
      githubLockedAt: null,
    });
    deps.logger.error(next.giveUp ? 'site_github_failed' : 'site_github_retry', {
      snapshotId,
      tenantId,
      attempts: next.attempts,
      error: text,
    });
    return { status: next.giveUp ? 'failed' : 'retry', snapshotId, error: text };
  }
}

export class SiteGithubRequestError extends Error {
  constructor(readonly code: 'not_found' | 'not_done' | 'busy') {
    super(code);
    this.name = 'SiteGithubRequestError';
  }
}

/** Console "Push to GitHub" / "Retry push": queues the copy for the worker's next GitHub pass. */
export async function requestSiteGithubPush(
  deps: { snapshots: SiteSnapshotRepo; now?: () => Date },
  input: { tenantId: string; id: string },
): Promise<{ queued: true }> {
  const result = await deps.snapshots.requestGithubPush(input.tenantId, input.id, (deps.now ?? (() => new Date()))());
  if (result !== 'queued') throw new SiteGithubRequestError(result);
  return { queued: true };
}
