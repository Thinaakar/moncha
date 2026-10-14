import type {
  JobRepo,
  JobRunRecord,
  Logger,
  SitePipelineRepo,
  SitePipelineSteps,
  SiteSnapshotListItem,
  SiteSnapshotRecord,
  SiteSnapshotRepo,
} from '../ports';
import { SITE_GITHUB_MAX_ATTEMPTS, SITE_GITHUB_STALE_MS, type SiteGithubPushOutcome } from './siteGithub';
import { SITE_SNAPSHOT_MAX_ATTEMPTS } from './siteSnapshots';
import { SITE_WORKER_MAX_ATTEMPTS, SITE_WORKER_STALE_MS, type SiteWorkerDeployOutcome } from './siteWorker';

/**
 * The website pipeline takes one website at a time through copy, GitHub push and Cloudflare Worker deploy. The next
 * website starts only when the current one is live or one of its steps gave up (3 tries; errors a retry cannot fix
 * stop at once). A GitHub rate limit or a full Cloudflare account pauses the pipeline on the current website without
 * using up a try. Everything it needs to resume after a restart is on the SiteSnapshot and JobRun rows.
 */
export type SitePipelineStep = 'copy' | 'github' | 'deploy';

type PublishFields = Pick<SiteSnapshotRecord, 'status' | 'githubStatus' | 'workerStatus'>;

/** The publish step a finished copy still needs, or null once it went through every step or a step gave up. */
export function sitePublishStep(snapshot: PublishFields, steps: SitePipelineSteps): 'github' | 'deploy' | null {
  if (snapshot.status !== 'done' || snapshot.githubStatus === 'failed' || snapshot.workerStatus === 'failed') return null;
  if (steps.github && snapshot.githubStatus !== 'pushed') return 'github';
  if (steps.worker && snapshot.workerStatus !== 'deployed') return 'deploy';
  return null;
}

/** How a website's job ends once no step is left: done when every step succeeded, failed with the step's error otherwise. */
export function sitePublishVerdict(
  snapshot: Pick<SiteSnapshotRecord, 'githubStatus' | 'githubError' | 'workerStatus' | 'workerError'>,
): { status: 'done' | 'failed'; lastError: string | null } {
  if (snapshot.githubStatus === 'failed') return { status: 'failed', lastError: `GitHub push failed: ${snapshot.githubError ?? 'unknown error'}` };
  if (snapshot.workerStatus === 'failed') return { status: 'failed', lastError: `Deploy failed: ${snapshot.workerError ?? 'unknown error'}` };
  return { status: 'done', lastError: null };
}

export type SitePipelineDeps = {
  pipeline: SitePipelineRepo;
  snapshots: SiteSnapshotRepo;
  jobs: JobRepo;
  /** Claims copy job `jobId` when it is due, or without an id the next copy in line; null when there is none. */
  claimCopy(jobId?: string): Promise<JobRunRecord | null>;
  runCopy(job: JobRunRecord): Promise<unknown>;
  /** Missing when GitHub is not configured: the step is skipped. */
  push?: (snapshot: SiteSnapshotListItem) => Promise<SiteGithubPushOutcome>;
  /** Missing when Cloudflare is not configured: the step is skipped. */
  deploy?: (snapshot: SiteSnapshotListItem) => Promise<SiteWorkerDeployOutcome>;
  logger: Logger;
  now?: () => Date;
};

export type SitePipelineTickOutcome =
  | { action: 'idle' }
  | { action: 'ran'; step: SitePipelineStep; snapshotId: string | null; jobId: string | null; result: string }
  | { action: 'waiting'; step: SitePipelineStep; snapshotId: string; until: Date | null }
  | { action: 'finished'; snapshotId: string; status: 'done' | 'failed' };

export function sitePipelineSteps(deps: Pick<SitePipelineDeps, 'push' | 'deploy'>): SitePipelineSteps {
  return { github: Boolean(deps.push), worker: Boolean(deps.deploy) };
}

/** Moves the pipeline one step: the website being published first, then a copy that started, older copies, new copies. */
export async function runSitePipelineTick(deps: SitePipelineDeps): Promise<SitePipelineTickOutcome> {
  const now = deps.now?.() ?? new Date();
  const steps = sitePipelineSteps(deps);

  const current = await deps.pipeline.currentPublish();
  if (current) return publishStep(deps, current, steps, now);

  const copy = await deps.pipeline.inFlightCopy();
  if (copy) return copyStep(deps, copy, now);

  const older = await deps.pipeline.nextToPublish(steps);
  if (older) {
    if (older.jobId) {
      await deps.jobs.update(older.tenantId, older.jobId, {
        status: 'running',
        startedAt: now,
        finishedAt: null,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
      });
    }
    deps.logger.info('site_pipeline_publish_started', { snapshotId: older.id, tenantId: older.tenantId, jobId: older.jobId });
    return publishStep(deps, older, steps, now);
  }

  const job = await deps.claimCopy();
  if (!job) return { action: 'idle' };
  await deps.runCopy(job);
  return { action: 'ran', step: 'copy', snapshotId: snapshotIdOf(job), jobId: job.id, result: 'copy_attempted' };
}

function snapshotIdOf(job: JobRunRecord): string | null {
  const id = (job.payload as { snapshotId?: unknown } | null | undefined)?.snapshotId;
  return typeof id === 'string' ? id : null;
}

async function copyStep(deps: SitePipelineDeps, snapshot: SiteSnapshotListItem, now: Date): Promise<SitePipelineTickOutcome> {
  const job = snapshot.jobId ? await deps.jobs.get(snapshot.tenantId, snapshot.jobId) : null;
  if (job?.status === 'pending' && job.runAfter.getTime() <= now.getTime()) {
    const claimed = await deps.claimCopy(job.id);
    if (claimed) {
      await deps.runCopy(claimed);
      return { action: 'ran', step: 'copy', snapshotId: snapshot.id, jobId: job.id, result: 'copy_attempted' };
    }
  }
  return { action: 'waiting', step: 'copy', snapshotId: snapshot.id, until: job?.status === 'pending' ? job.runAfter : null };
}

async function publishStep(
  deps: SitePipelineDeps,
  site: SiteSnapshotListItem,
  steps: SitePipelineSteps,
  now: Date,
): Promise<SitePipelineTickOutcome> {
  const step = sitePublishStep(site, steps);
  if (!step) return finishPublish(deps, site, now);

  let result: string;
  if (step === 'github') {
    if (!site.githubStatus) {
      await deps.snapshots.update(site.tenantId, site.id, { githubStatus: 'pending', githubAttempts: 0, githubNextAt: now, githubError: null });
    }
    const claimed = await deps.snapshots.claimGithubPush(now, new Date(now.getTime() - SITE_GITHUB_STALE_MS), { id: site.id });
    if (!claimed) return { action: 'waiting', step, snapshotId: site.id, until: site.githubNextAt };
    result = (await deps.push!(claimed)).status;
  } else {
    if (!site.workerStatus) {
      await deps.snapshots.update(site.tenantId, site.id, { workerStatus: 'pending', workerAttempts: 0, workerNextAt: now, workerError: null });
    }
    const claimed = await deps.snapshots.claimWorkerDeploy(now, new Date(now.getTime() - SITE_WORKER_STALE_MS), {
      id: site.id,
      afterGithub: steps.github,
    });
    if (!claimed) return { action: 'waiting', step, snapshotId: site.id, until: site.workerNextAt };
    result = (await deps.deploy!(claimed)).status;
  }

  const fresh = await deps.snapshots.get(site.tenantId, site.id);
  if (fresh && !sitePublishStep(fresh, steps)) return finishPublish(deps, fresh, deps.now?.() ?? new Date());
  return { action: 'ran', step, snapshotId: site.id, jobId: site.jobId, result };
}

async function finishPublish(deps: SitePipelineDeps, site: SiteSnapshotListItem, now: Date): Promise<SitePipelineTickOutcome> {
  const verdict = sitePublishVerdict(site);
  if (site.jobId) {
    const job = await deps.jobs.get(site.tenantId, site.jobId);
    const previous = job?.result && typeof job.result === 'object' && !Array.isArray(job.result) ? job.result : {};
    await deps.jobs.update(site.tenantId, site.jobId, {
      status: verdict.status,
      lastError: verdict.lastError,
      finishedAt: now,
      lockedAt: null,
      lockedBy: null,
      result: { ...previous, snapshotId: site.id, liveUrl: site.workerUrl, githubRepo: site.githubRepo },
    });
  }
  const log = verdict.status === 'done' ? deps.logger.info : deps.logger.error;
  log.call(deps.logger, 'site_pipeline_finished', {
    snapshotId: site.id,
    tenantId: site.tenantId,
    jobId: site.jobId,
    status: verdict.status,
    liveUrl: site.workerUrl,
    error: verdict.lastError,
  });
  return { action: 'finished', snapshotId: site.id, status: verdict.status };
}

/** `working` runs now or is about to; `retrying` waits before its next try; `paused` waits for a GitHub or Cloudflare limit. */
export type SitePipelineState = 'working' | 'retrying' | 'paused';

export type SitePipelineCurrent = {
  snapshot: SiteSnapshotListItem;
  step: SitePipelineStep;
  state: SitePipelineState;
  /** Tries of this step so far (the running one included). */
  attempts: number;
  maxAttempts: number;
  /** When the next try starts (retrying or paused). */
  nextAt: Date | null;
  /** Last error of this step, `code: message`. */
  error: string | null;
};

export type SitePipelineView = {
  steps: SitePipelineSteps;
  /** Null when the pipeline is idle, or busy with another tenant's website. */
  current: SitePipelineCurrent | null;
  /** Finished copies of the tenant still waiting for GitHub or the Worker deploy (the current website not counted). */
  toPublish: number;
  /** Copies of the tenant waiting for their first try. */
  waitingCopies: number;
};

/** Errors that pause the whole pipeline: the account is limited, not the website. */
const PAUSE_CODES = new Set(['github_rate_limited', 'worker_limit_reached']);

function errorCode(error: string | null): string | null {
  return error?.match(/^([a-z0-9_]+):/)?.[1] ?? null;
}

function waitState(nextAt: Date | null, error: string | null, now: Date): SitePipelineState {
  if (!nextAt || nextAt.getTime() <= now.getTime()) return 'working';
  return PAUSE_CODES.has(errorCode(error) ?? '') ? 'paused' : 'retrying';
}

function publishCurrent(site: SiteSnapshotListItem, steps: SitePipelineSteps, now: Date): SitePipelineCurrent {
  const step = sitePublishStep(site, steps) ?? (steps.worker ? 'deploy' : 'github');
  if (step === 'github') {
    const waiting = site.githubStatus === 'pending';
    return {
      snapshot: site,
      step,
      state: waiting ? waitState(site.githubNextAt, site.githubError, now) : 'working',
      attempts: site.githubAttempts,
      maxAttempts: SITE_GITHUB_MAX_ATTEMPTS,
      nextAt: waiting ? site.githubNextAt : null,
      error: site.githubError,
    };
  }
  const waiting = site.workerStatus === 'pending';
  return {
    snapshot: site,
    step,
    state: waiting ? waitState(site.workerNextAt, site.workerError, now) : 'working',
    attempts: site.workerAttempts,
    maxAttempts: SITE_WORKER_MAX_ATTEMPTS,
    nextAt: waiting ? site.workerNextAt : null,
    error: site.workerError,
  };
}

/** What the pipeline is doing right now, for the console. */
export async function describeSitePipeline(
  deps: { pipeline: SitePipelineRepo; jobs: JobRepo; steps: SitePipelineSteps; now?: () => Date },
  input: { tenantId: string },
): Promise<SitePipelineView> {
  const now = deps.now?.() ?? new Date();
  const [publishing, toPublish, waitingCopies] = await Promise.all([
    deps.pipeline.currentPublish(),
    deps.pipeline.countToPublish(input.tenantId, deps.steps),
    deps.pipeline.countWaitingCopies(input.tenantId),
  ]);

  let current: SitePipelineCurrent | null = null;
  if (publishing) {
    current = publishCurrent(publishing, deps.steps, now);
  } else {
    const copy = await deps.pipeline.inFlightCopy();
    if (copy) {
      const job = copy.jobId ? await deps.jobs.get(copy.tenantId, copy.jobId) : null;
      const retryAt = copy.status === 'pending' && job?.status === 'pending' ? job.runAfter : null;
      current = {
        snapshot: copy,
        step: 'copy',
        state: waitState(retryAt, null, now),
        attempts: job?.attempts ?? copy.attempts,
        maxAttempts: job?.maxAttempts ?? SITE_SNAPSHOT_MAX_ATTEMPTS,
        nextAt: retryAt,
        error: copy.failureReason ? (copy.failureDetail ? `${copy.failureReason}: ${copy.failureDetail}` : copy.failureReason) : null,
      };
    }
  }
  if (current && current.snapshot.tenantId !== input.tenantId) current = null;
  const currentCounted = current && current.step !== 'copy' && sitePublishStep(current.snapshot, deps.steps) ? 1 : 0;
  return { steps: deps.steps, current, toPublish: Math.max(0, toPublish - currentCounted), waitingCopies };
}
