import {
  SiteDeployError,
  type Logger,
  type SiteManifest,
  type SiteSnapshotListItem,
  type SiteSnapshotRepo,
  type SiteStore,
  type SiteWorkerDeployer,
  type SiteWorkerFile,
} from '../ports';
import { readSiteFiles, readSiteManifest, retryAfterError, siteName } from './siteGithub';

export const SITE_WORKER_MAX_ATTEMPTS = 3;
export const SITE_WORKER_BACKOFF_MS = [60_000, 5 * 60_000];
/** A deploy still `deploying` after this long belongs to a worker that died; it is taken over. */
export const SITE_WORKER_STALE_MS = 10 * 60_000;
/** Cloudflare's per-file limit for Worker static assets. */
export const SITE_WORKER_MAX_FILE_BYTES = 25 * 1024 * 1024;

/** R2 key → asset path on the Worker: the copy's index.html at `/` plus every asset at its stored path. */
export function siteWorkerPaths(manifest: Pick<SiteManifest, 'assets'>): Array<{ key: string; path: string; contentType: string }> {
  const seen = new Set<string>();
  const assets = manifest.assets.filter((a) => !seen.has(a.storedPath) && seen.add(a.storedPath));
  return [
    { key: 'index.html', path: '/index.html', contentType: 'text/html' },
    ...assets.map((a) => ({ key: a.storedPath, path: `/${a.storedPath}`, contentType: a.contentType || 'application/octet-stream' })),
  ];
}

export type SiteWorkerDeployDeps = {
  snapshots: SiteSnapshotRepo;
  store: SiteStore;
  deployer: SiteWorkerDeployer;
  logger: Logger;
  now?: () => Date;
};

/** How long a deploy waits before checking again whether the Cloudflare account has room for another Worker. */
export const SITE_WORKER_LIMIT_WAIT_MS = 15 * 60_000;

export type SiteWorkerDeployOutcome =
  | { status: 'deployed'; snapshotId: string; name: string; url: string; files: number }
  | { status: 'retry' | 'failed'; snapshotId: string; error: string }
  | { status: 'limit_reached'; snapshotId: string; error: string; retryAt: Date };

function errorText(error: unknown): { code: string; text: string; retryable: boolean } {
  if (error instanceof SiteDeployError) {
    return { code: error.code, text: `${error.code}: ${error.message}`.slice(0, 300), retryable: error.retryable };
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: 'error', text: `error: ${message}`.slice(0, 300), retryable: true };
}

/**
 * Deploys one claimed copy (status `deploying`, attempts already counted) as its own Cloudflare Worker.
 * A newer copy of the same website redeploys the same Worker, so its URL never changes.
 */
export async function deploySiteSnapshotToWorker(
  deps: SiteWorkerDeployDeps,
  snapshot: SiteSnapshotListItem,
  signal?: AbortSignal,
): Promise<SiteWorkerDeployOutcome> {
  const now = deps.now ?? (() => new Date());
  const { tenantId, id: snapshotId } = snapshot;
  try {
    const name = siteName(snapshot);
    await deps.deployer.preflight?.({ name, signal });
    const manifest = await readSiteManifest(
      deps.store,
      snapshot.storagePrefix,
      () => new SiteDeployError('copy_files_missing', 'manifest.json is not in R2', false),
    );
    const stored = await readSiteFiles(deps.store, snapshot.storagePrefix, siteWorkerPaths(manifest));
    if (signal?.aborted) throw new SiteDeployError('worker_shutdown', 'worker is stopping');
    if (!stored.some((f) => f.key === 'index.html')) throw new SiteDeployError('copy_files_missing', 'index.html is not in R2', false);
    const files: SiteWorkerFile[] = stored
      .filter((f) => f.bytes.byteLength > 0 && f.bytes.byteLength <= SITE_WORKER_MAX_FILE_BYTES)
      .map((f) => ({ path: f.path, bytes: f.bytes, contentType: f.contentType }));

    const result = await deps.deployer.deploy({ name, files, signal });
    await deps.snapshots.update(tenantId, snapshotId, {
      workerStatus: 'deployed',
      workerName: result.name,
      workerUrl: result.url,
      workerError: null,
      workerNextAt: null,
      workerLockedAt: null,
      workerDeployedAt: now(),
    });
    deps.logger.info('site_worker_deployed', { snapshotId, tenantId, name: result.name, url: result.url, files: files.length });
    return { status: 'deployed', snapshotId, name: result.name, url: result.url, files: files.length };
  } catch (error) {
    const { code, text, retryable } = errorText(error);
    const shutdown = code === 'worker_shutdown' || Boolean(signal?.aborted);
    if (code === 'worker_limit_reached' && !shutdown) {
      // Not this copy's fault: give the try back and wait until someone frees or adds Worker room.
      const retryAt = new Date(now().getTime() + SITE_WORKER_LIMIT_WAIT_MS);
      await deps.snapshots.update(tenantId, snapshotId, {
        workerStatus: 'pending',
        workerAttempts: Math.max(0, snapshot.workerAttempts - 1),
        workerError: text,
        workerNextAt: retryAt,
        workerLockedAt: null,
      });
      deps.logger.error('site_worker_limit_reached', { snapshotId, tenantId, error: text, retryAt: retryAt.toISOString() });
      return { status: 'limit_reached', snapshotId, error: text, retryAt };
    }
    const next = retryAfterError({
      attempts: snapshot.workerAttempts,
      maxAttempts: SITE_WORKER_MAX_ATTEMPTS,
      backoffMs: SITE_WORKER_BACKOFF_MS,
      retryable,
      shutdown,
      now: now(),
    });
    await deps.snapshots.update(tenantId, snapshotId, {
      workerStatus: next.giveUp ? 'failed' : 'pending',
      workerAttempts: next.attempts,
      workerError: shutdown ? snapshot.workerError : text,
      workerNextAt: next.nextAt,
      workerLockedAt: null,
    });
    deps.logger.error(next.giveUp ? 'site_worker_failed' : 'site_worker_retry', {
      snapshotId,
      tenantId,
      attempts: next.attempts,
      error: text,
    });
    return { status: next.giveUp ? 'failed' : 'retry', snapshotId, error: text };
  }
}

export class SiteWorkerRequestError extends Error {
  constructor(readonly code: 'not_found' | 'not_done' | 'busy') {
    super(code);
    this.name = 'SiteWorkerRequestError';
  }
}

/** Console "Deploy" / "Redeploy": queues the copy for the worker's next deploy pass. */
export async function requestSiteWorkerDeploy(
  deps: { snapshots: SiteSnapshotRepo; now?: () => Date },
  input: { tenantId: string; id: string },
): Promise<{ queued: true }> {
  const result = await deps.snapshots.requestWorkerDeploy(input.tenantId, input.id, (deps.now ?? (() => new Date()))());
  if (result !== 'queued') throw new SiteWorkerRequestError(result);
  return { queued: true };
}
