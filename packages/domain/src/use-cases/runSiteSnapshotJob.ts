import {
  BrandExtractionError,
  SiteCaptureError,
  utcDay,
  type BrandExtractor,
  type JobRepo,
  type JobRunRecord,
  type LeadRepo,
  type LlmBudget,
  type LlmUsageRepo,
  type Logger,
  type SiteBrand,
  type SiteCaptureResult,
  type SiteCapturer,
  type SiteManifest,
  type SiteSnapshotJobPayload,
  type SiteSnapshotRepo,
  type SiteStore,
} from '../ports';
import { brandFromEvidence } from '../site/evidence-brand';

export const SITE_JOB_TIMEOUT_MS = 240_000;
const UPLOAD_CONCURRENCY = 6;
const RETRY_DELAY_MS = 60_000;

/** Capture failures that will not change on a retry. */
const PERMANENT_FAILURES = new Set([
  'blocked_host',
  'robots_disallowed',
  'not_html',
  'source_too_large',
  'too_many_redirects',
  'blocked_or_captcha',
  'snapshot_missing',
  'invalid_payload',
]);

export type SiteSnapshotJobDeps = {
  jobs: JobRepo;
  snapshots: SiteSnapshotRepo;
  leads: LeadRepo;
  capturer: SiteCapturer;
  /** Null when no LLM is configured; the brand then comes from page evidence only. */
  brandExtractor: BrandExtractor | null;
  store: SiteStore;
  llmUsage?: LlmUsageRepo;
  maxLlmCallsPerDay?: number;
  /** When the sites repo is configured, a finished copy is queued for a GitHub push. */
  githubEnabled?: boolean;
  logger: Logger;
  now?: () => Date;
};

export type SiteSnapshotJobOutcome =
  | { status: 'done'; snapshotId: string; assetCount: number; totalBytes: number; brandSource: SiteBrand['source'] }
  | { status: 'retry' | 'failed'; snapshotId?: string; reason: string }
  | { status: 'skipped'; snapshotId: string };

type Upload = { path: string; bytes: Uint8Array; contentType: string };

const encoder = new TextEncoder();
const json = (value: unknown) => encoder.encode(`${JSON.stringify(value, null, 2)}\n`);

async function uploadAll(store: SiteStore, prefix: string, uploads: Upload[], signal: AbortSignal): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < uploads.length) {
      if (signal.aborted) throw new SiteCaptureError('timeout', 'upload aborted');
      const item = uploads[next++]!;
      await store.put(`${prefix}${item.path}`, item.bytes, item.contentType);
    }
  };
  await Promise.all(Array.from({ length: Math.min(UPLOAD_CONCURRENCY, uploads.length) }, worker));
}

function failureCode(error: unknown, aborted: boolean): string {
  if (aborted) return 'timeout';
  if (error instanceof SiteCaptureError) return error.code;
  return 'unexpected_error';
}

/** The message behind a failure code, shown next to it in the console. Null when it adds nothing. */
function failureDetail(error: unknown, reason: string, timedOut: boolean, timeoutMs: number): string | null {
  if (timedOut) return `The copy did not finish within ${Math.round(timeoutMs / 1000)} seconds`;
  if (!(error instanceof Error)) return error === undefined || error === null ? null : String(error).slice(0, 500);
  const cause = error.cause instanceof Error ? error.cause.message : '';
  const message = cause && !error.message.includes(cause) ? `${error.message}: ${cause}` : error.message;
  return message && message !== reason ? message.slice(0, 500) : null;
}

function isPermanent(code: string): boolean {
  return PERMANENT_FAILURES.has(code) || /^http_4\d\d$/.test(code);
}

function llmBudget(deps: SiteSnapshotJobDeps, tenantId: string, now: () => Date): LlmBudget | undefined {
  if (!deps.llmUsage) return undefined;
  const usage = deps.llmUsage;
  const max = deps.maxLlmCallsPerDay;
  return {
    allow: async () => {
      if (!max || max <= 0) return true;
      const today = await usage.get(tenantId, utcDay(now()));
      return (today?.calls ?? 0) < max;
    },
    record: async (failed) => {
      await usage.increment(tenantId, utcDay(now()), { failed });
    },
  };
}

/**
 * Runs one site_snapshot job: capture, brand extraction and upload of every file under
 * `sites/{tenantId}/{snapshotId}/`. A retry reuses the same snapshot and overwrites its objects.
 */
export async function runSiteSnapshotJob(
  deps: SiteSnapshotJobDeps,
  input: { job: JobRunRecord; timeoutMs?: number; signal?: AbortSignal },
): Promise<SiteSnapshotJobOutcome> {
  const { job } = input;
  const now = deps.now ?? (() => new Date());
  const payload = (job.payload ?? {}) as Partial<SiteSnapshotJobPayload>;
  const tenantId = job.tenantId;

  const finishJob = (status: 'done' | 'failed', extra: { result?: unknown; lastError?: string | null }) =>
    deps.jobs.update(tenantId, job.id, { status, finishedAt: now(), lockedAt: null, lockedBy: null, ...extra });

  if (!payload.snapshotId || !payload.url) {
    await finishJob('failed', { lastError: 'invalid_payload' });
    return { status: 'failed', reason: 'invalid_payload' };
  }
  const snapshotId = payload.snapshotId;
  const snapshot = await deps.snapshots.get(tenantId, snapshotId);
  if (!snapshot) {
    await finishJob('failed', { lastError: 'snapshot_missing' });
    return { status: 'failed', snapshotId, reason: 'snapshot_missing' };
  }
  if (snapshot.status === 'done') {
    await finishJob('done', { result: { snapshotId, skipped: 'already_done' }, lastError: null });
    return { status: 'skipped', snapshotId };
  }

  await deps.snapshots.update(tenantId, snapshotId, { status: 'running', attempts: job.attempts });
  if (job.status === 'pending') {
    await deps.jobs.update(tenantId, job.id, { status: 'running', startedAt: now(), lockedAt: now() });
  }

  const timeoutMs = input.timeoutMs ?? SITE_JOB_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = () => controller.abort();
  input.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const signal = controller.signal;

  try {
    const capture: SiteCaptureResult = await deps.capturer.capture({ url: payload.url, signal });
    if (signal.aborted) throw new SiteCaptureError('timeout');

    const warnings = [...capture.warnings];
    const lead = await deps.leads.get(tenantId, snapshot.leadId);
    const company = {
      name: lead?.company.name ?? snapshot.company.name,
      domain: lead?.company.domain ?? snapshot.company.domain,
      phone: lead?.company.phone ?? null,
      address: lead?.company.address ?? null,
      country: lead?.company.country ?? null,
    };

    let brand: SiteBrand;
    let llmModel: string | null = null;
    let usage = { promptTokens: 0, completionTokens: 0 };
    if (deps.brandExtractor) {
      try {
        const extracted = await deps.brandExtractor.extract({
          evidence: capture.evidence,
          company,
          screenshots: {
            desktopViewport: capture.screenshots.desktopViewport,
            mobileViewport: capture.screenshots.mobileViewport,
          },
          budget: llmBudget(deps, tenantId, now),
        });
        brand = extracted.brand;
        llmModel = extracted.model;
        usage = extracted.usage;
        warnings.push(...extracted.warnings);
      } catch (error) {
        const reason = error instanceof BrandExtractionError ? error.reason : 'llm_failed';
        if (error instanceof BrandExtractionError) usage = error.usage;
        deps.logger.error('site_brand_llm_skipped', {
          snapshotId,
          reason,
          message: error instanceof Error ? error.message.slice(0, 200) : String(error),
        });
        warnings.push(`llm_skipped:${reason}`);
        brand = brandFromEvidence(capture.evidence, company);
      }
    } else {
      warnings.push('llm_skipped:not_configured');
      brand = brandFromEvidence(capture.evidence, company);
    }
    if (signal.aborted) throw new SiteCaptureError('timeout');

    const manifest: SiteManifest = { ...capture.manifest, snapshotId };

    const htmlType = `text/html; charset=${capture.source.charset}`;
    const uploads: Upload[] = [
      { path: 'source.html', bytes: capture.source.bytes, contentType: htmlType },
      { path: 'rendered.html', bytes: encoder.encode(capture.renderedHtml), contentType: 'text/html; charset=utf-8' },
      { path: 'index.html', bytes: capture.indexHtml, contentType: htmlType },
      { path: 'brand.json', bytes: json(brand), contentType: 'application/json; charset=utf-8' },
      { path: 'manifest.json', bytes: json(manifest), contentType: 'application/json; charset=utf-8' },
      ...capture.files.map((f) => ({ path: f.path, bytes: f.bytes, contentType: f.contentType })),
    ];
    if (capture.screenshots.desktop) {
      uploads.push({ path: 'screenshot-desktop.png', bytes: capture.screenshots.desktop, contentType: 'image/png' });
    }
    if (capture.screenshots.mobile) {
      uploads.push({ path: 'screenshot-mobile.png', bytes: capture.screenshots.mobile, contentType: 'image/png' });
    }
    await uploadAll(deps.store, snapshot.storagePrefix, uploads, signal);

    const totalBytes = uploads.reduce((sum, u) => sum + u.bytes.byteLength, 0);
    const uniqueWarnings = [...new Set(warnings)];
    await deps.snapshots.update(tenantId, snapshotId, {
      status: 'done',
      finalUrl: capture.finalUrl,
      httpStatus: capture.httpStatus,
      sourceHash: capture.source.sha256,
      sourceBytes: capture.source.bytes.byteLength,
      sourceCharset: capture.source.charset,
      assetCount: capture.manifest.assets.length,
      skippedAssetCount: capture.manifest.skipped.length,
      totalBytes,
      brand,
      llmModel,
      llmPromptTokens: llmModel ? usage.promptTokens : null,
      llmCompletionTokens: llmModel ? usage.completionTokens : null,
      warnings: uniqueWarnings,
      failureReason: null,
      failureDetail: null,
      finishedAt: now(),
      ...(deps.githubEnabled
        ? { githubStatus: 'pending' as const, githubAttempts: 0, githubNextAt: now(), githubError: null }
        : {}),
    });
    await finishJob('done', {
      lastError: null,
      result: {
        snapshotId,
        finalUrl: capture.finalUrl,
        assetCount: capture.manifest.assets.length,
        skippedAssetCount: capture.manifest.skipped.length,
        totalBytes,
        brandSource: brand.source,
        warnings: uniqueWarnings.length,
      },
    });
    deps.logger.info('site_snapshot_done', {
      snapshotId,
      tenantId,
      assets: capture.manifest.assets.length,
      skipped: capture.manifest.skipped.length,
      totalBytes,
      brandSource: brand.source,
    });
    return { status: 'done', snapshotId, assetCount: capture.manifest.assets.length, totalBytes, brandSource: brand.source };
  } catch (error) {
    const timedOut = signal.aborted && !input.signal?.aborted;
    const reason = failureCode(error, timedOut);
    const detail = failureDetail(error, reason, timedOut, timeoutMs);
    const lastError = detail ? `${reason}: ${detail}` : reason;
    const shutdown = Boolean(input.signal?.aborted);
    const canRetry = !isPermanent(reason) && job.attempts < job.maxAttempts;
    if (shutdown) {
      // Not the copy's fault: give the claimed attempt back and keep the last real error on the copy.
      const attempts = Math.max(0, job.attempts - 1);
      await deps.snapshots.update(tenantId, snapshotId, { status: 'pending', attempts });
      await deps.jobs.update(tenantId, job.id, {
        status: 'pending',
        lastError: 'worker_shutdown',
        lockedAt: null,
        lockedBy: null,
        attempts,
        runAfter: now(),
      });
      deps.logger.error('site_snapshot_retry', { snapshotId, reason: 'worker_shutdown', attempts });
      return { status: 'retry', snapshotId, reason: 'worker_shutdown' };
    }
    if (canRetry) {
      // Transient failure: back to the queue, same snapshot and storage prefix.
      await deps.snapshots.update(tenantId, snapshotId, { status: 'pending', failureReason: reason, failureDetail: detail });
      await deps.jobs.update(tenantId, job.id, {
        status: 'pending',
        lastError,
        lockedAt: null,
        lockedBy: null,
        runAfter: new Date(now().getTime() + RETRY_DELAY_MS * job.attempts),
      });
      deps.logger.error('site_snapshot_retry', { snapshotId, reason, detail, attempts: job.attempts });
      return { status: 'retry', snapshotId, reason };
    }
    await deps.snapshots.update(tenantId, snapshotId, {
      status: 'failed',
      failureReason: reason,
      failureDetail: detail,
      finishedAt: now(),
    });
    await finishJob('failed', { lastError });
    deps.logger.error('site_snapshot_failed', { snapshotId, reason, detail, attempts: job.attempts });
    return { status: 'failed', snapshotId, reason };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onOuterAbort);
  }
}
