import {
  SiteGithubError,
  type Logger,
  type SiteGithubFile,
  type SiteGithubPublisher,
  type SiteManifest,
  type SiteSnapshotListItem,
  type SiteSnapshotRepo,
  type SiteStore,
} from '../ports';
import { WIDGET_FILE } from '../site/demo-injection';

/** Total tries before the push is marked failed; the waits between them are SITE_GITHUB_BACKOFF_MS. */
export const SITE_GITHUB_MAX_ATTEMPTS = 6;
export const SITE_GITHUB_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 3 * 60 * 60_000];
/** A push still `pushing` after this long belongs to a worker that died; it is taken over. */
export const SITE_GITHUB_STALE_MS = 10 * 60_000;

/** Root files of a copy that are pushed; screenshots stay in R2. */
const ROOT_FILES = ['index.html', 'demo.html', 'source.html', 'rendered.html', WIDGET_FILE, 'brand.json', 'manifest.json'];
const CODE_ASSET = /\.(css|js|mjs)$/i;

/** Folder name for a copy's domain: lowercase host without `www.`, safe for a git path. */
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

/** `sites/{domain}/{snapshotId}` in the sites repo. */
export function siteGithubFolder(snapshot: SiteSnapshotListItem): string {
  return `sites/${siteGithubDomain(snapshot)}/${snapshot.id}`;
}

/** Root files plus CSS and JS assets from the manifest; images, fonts and other media are left out. */
export function siteGithubPaths(manifest: Pick<SiteManifest, 'assets'>): string[] {
  const assets = manifest.assets
    .filter((a) => a.kind === 'css' || a.kind === 'js' || CODE_ASSET.test(a.storedPath))
    .filter((a) => a.kind !== 'image' && a.kind !== 'font' && a.kind !== 'media')
    .map((a) => a.storedPath);
  return [...new Set([...ROOT_FILES, ...assets])];
}

export type SiteGithubPushDeps = {
  snapshots: SiteSnapshotRepo;
  store: SiteStore;
  publisher: SiteGithubPublisher;
  logger: Logger;
  now?: () => Date;
};

export type SiteGithubPushOutcome =
  | { status: 'pushed'; snapshotId: string; commitUrl: string; files: number }
  | { status: 'retry' | 'failed'; snapshotId: string; error: string };

const FILE_READ_CONCURRENCY = 6;

async function readFiles(store: SiteStore, prefix: string, paths: string[]): Promise<SiteGithubFile[]> {
  const files: SiteGithubFile[] = [];
  let next = 0;
  const worker = async () => {
    while (next < paths.length) {
      const path = paths[next++]!;
      const bytes = await store.getBytes(`${prefix}${path}`);
      // Copies made before a file existed (e.g. the widget) simply push without it.
      if (bytes) files.push({ path, bytes });
    }
  };
  await Promise.all(Array.from({ length: Math.min(FILE_READ_CONCURRENCY, paths.length) }, worker));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function commitMessage(snapshot: SiteSnapshotListItem): string {
  const domain = siteGithubDomain(snapshot);
  return [
    `Website copy: ${domain} (${snapshot.id})`,
    '',
    `Company: ${snapshot.company.name}`,
    `Source: ${snapshot.finalUrl || snapshot.sourceUrl}`,
    `Captured: ${(snapshot.finishedAt ?? snapshot.createdAt).toISOString()}`,
    `Started by: ${snapshot.origin === 'auto' ? 'copy automation' : 'console'}`,
  ].join('\n');
}

function errorText(error: unknown): { code: string; text: string; retryable: boolean } {
  if (error instanceof SiteGithubError) {
    return { code: error.code, text: `${error.code}: ${error.message}`.slice(0, 300), retryable: error.retryable };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'error', text: `error: ${message}`.slice(0, 300), retryable: true };
}

/**
 * Pushes one claimed copy (status `pushing`, attempts already counted) to the sites repo as one commit.
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
    const manifestBytes = await deps.store.getBytes(`${snapshot.storagePrefix}manifest.json`);
    if (!manifestBytes) throw new SiteGithubError('copy_files_missing', 'manifest.json is not in R2', false);
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as SiteManifest;
    const files = await readFiles(deps.store, snapshot.storagePrefix, siteGithubPaths(manifest));
    if (signal?.aborted) throw new SiteGithubError('worker_shutdown', 'worker is stopping');

    const result = await deps.publisher.publish({
      folder: siteGithubFolder(snapshot),
      files,
      message: commitMessage(snapshot),
      signal,
    });
    await deps.snapshots.update(tenantId, snapshotId, {
      githubStatus: 'pushed',
      githubCommitSha: result.commitSha,
      githubCommitUrl: result.commitUrl,
      githubFolderUrl: result.folderUrl,
      githubError: null,
      githubNextAt: null,
      githubLockedAt: null,
      githubPushedAt: now(),
    });
    deps.logger.info('site_github_pushed', { snapshotId, tenantId, files: files.length, commit: result.commitSha });
    return { status: 'pushed', snapshotId, commitUrl: result.commitUrl, files: files.length };
  } catch (error) {
    const { code, text, retryable } = errorText(error);
    const shutdown = code === 'worker_shutdown' || Boolean(signal?.aborted);
    const attempts = shutdown ? Math.max(0, snapshot.githubAttempts - 1) : snapshot.githubAttempts;
    const giveUp = !shutdown && (!retryable || attempts >= SITE_GITHUB_MAX_ATTEMPTS);
    const waitMs = shutdown ? 0 : SITE_GITHUB_BACKOFF_MS[Math.min(attempts, SITE_GITHUB_BACKOFF_MS.length) - 1] ?? 60_000;
    await deps.snapshots.update(tenantId, snapshotId, {
      githubStatus: giveUp ? 'failed' : 'pending',
      githubAttempts: attempts,
      githubError: shutdown ? snapshot.githubError : text,
      githubNextAt: giveUp ? null : new Date(now().getTime() + waitMs),
      githubLockedAt: null,
    });
    deps.logger.error(giveUp ? 'site_github_failed' : 'site_github_retry', { snapshotId, tenantId, attempts, error: text });
    return { status: giveUp ? 'failed' : 'retry', snapshotId, error: text };
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
