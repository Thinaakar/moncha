import type { SiteSnapshotRecord } from '../ports';

/** Ordered steps of a website copy, from the queue to its live Worker URL. */
export type SiteCopyStep = 'queued' | 'copying' | 'reading_source' | 'building' | 'updating_git' | 'deploying_url' | 'live';

/**
 * not_started = not reached yet (or never queued), waiting = queued for its turn, active = running now,
 * retrying = waiting to try again after an error, failed = stopped until someone retries, done = finished.
 */
export type SiteCopyStepState = 'not_started' | 'waiting' | 'active' | 'retrying' | 'failed' | 'done';

export type SiteCopyProgress = {
  /** First step that is not done; the last step once everything is done. */
  step: SiteCopyStep;
  state: SiteCopyStepState;
  /** Error behind a retrying or failed step. */
  error: string | null;
  /** When the current step started, or when the last step finished. */
  since: Date | null;
  /** Next try of a waiting or retrying GitHub push or Worker deploy. */
  nextAt: Date | null;
  steps: Array<{ step: SiteCopyStep; state: SiteCopyStepState }>;
};

type Row = Pick<
  SiteSnapshotRecord,
  | 'status'
  | 'attempts'
  | 'failureReason'
  | 'failureDetail'
  | 'stage'
  | 'stageAt'
  | 'createdAt'
  | 'finishedAt'
  | 'githubStatus'
  | 'githubAttempts'
  | 'githubNextAt'
  | 'githubError'
  | 'githubPushedAt'
  | 'workerStatus'
  | 'workerAttempts'
  | 'workerNextAt'
  | 'workerError'
  | 'workerDeployedAt'
>;

type StepInfo = { step: SiteCopyStep; state: SiteCopyStepState; error: string | null; since: Date | null; nextAt: Date | null };

const COPY_STEPS = ['copying', 'reading_source', 'building'] as const;

function copySteps(row: Row): StepInfo[] {
  const blank = (step: SiteCopyStep, state: SiteCopyStepState): StepInfo => ({ step, state, error: null, since: null, nextAt: null });
  if (row.status === 'done') {
    return [blank('queued', 'done'), ...COPY_STEPS.map((step) => blank(step, 'done'))];
  }
  const error = row.failureDetail ?? row.failureReason;
  const firstTry = row.status === 'pending' && row.attempts === 0 && !row.failureReason;
  if (firstTry) {
    return [{ ...blank('queued', 'waiting'), since: row.createdAt }, ...COPY_STEPS.map((step) => blank(step, 'not_started'))];
  }
  const current = row.stage ?? 'copying';
  const state: SiteCopyStepState = row.status === 'running' ? 'active' : row.status === 'failed' ? 'failed' : 'retrying';
  const at = COPY_STEPS.indexOf(current);
  return [
    blank('queued', 'done'),
    ...COPY_STEPS.map((step, i) =>
      i < at
        ? blank(step, 'done')
        : i === at
          ? { step, state, error: state === 'active' ? null : error, since: row.stageAt, nextAt: null }
          : blank(step, 'not_started'),
    ),
  ];
}

/** State of a GitHub push or Worker deploy from its status columns (both share one lifecycle). */
function publishState(
  status: 'pending' | 'pushing' | 'pushed' | 'deploying' | 'deployed' | 'failed' | null,
  attempts: number,
  error: string | null,
): SiteCopyStepState {
  if (!status) return 'not_started';
  if (status === 'pushed' || status === 'deployed') return 'done';
  if (status === 'pushing' || status === 'deploying') return 'active';
  if (status === 'failed') return 'failed';
  return attempts > 0 || error ? 'retrying' : 'waiting';
}

/**
 * Where a copy is on the way to its live URL: copy (copying, reading the source, building the files), then the
 * GitHub push, then the Worker deploy, which only starts once the push is done when GitHub is configured.
 * GitHub and Worker steps appear when they are configured or the copy already has them.
 */
export function siteCopyProgress(row: Row, options: { githubEnabled: boolean; workerEnabled: boolean }): SiteCopyProgress {
  const steps = copySteps(row);
  const copied = row.status === 'done';
  const withGit = options.githubEnabled || row.githubStatus !== null;
  const withWorker = options.workerEnabled || row.workerStatus !== null;

  if (withGit) {
    const state = copied ? publishState(row.githubStatus, row.githubAttempts, row.githubError) : 'not_started';
    steps.push({
      step: 'updating_git',
      state,
      error: state === 'retrying' || state === 'failed' ? row.githubError : null,
      since: state === 'done' ? row.githubPushedAt : null,
      nextAt: state === 'waiting' || state === 'retrying' ? row.githubNextAt : null,
    });
  }
  if (withWorker) {
    const gitDone = !withGit || row.githubStatus === 'pushed';
    const state = copied ? publishState(row.workerStatus, row.workerAttempts, row.workerError) : 'not_started';
    steps.push({
      step: 'deploying_url',
      state,
      error: state === 'retrying' || state === 'failed' ? row.workerError : null,
      since: state === 'done' ? row.workerDeployedAt : null,
      nextAt: (state === 'waiting' || state === 'retrying') && gitDone ? row.workerNextAt : null,
    });
    const live = row.workerStatus === 'deployed';
    steps.push({ step: 'live', state: live ? 'done' : 'not_started', error: null, since: live ? row.workerDeployedAt : null, nextAt: null });
  }

  const current = steps.find((s) => s.state !== 'done');
  const last = steps[steps.length - 1]!;
  const head = current ?? { ...last, since: last.since ?? row.finishedAt };
  return {
    step: head.step,
    state: head.state,
    error: head.error,
    since: head.since,
    nextAt: head.nextAt,
    steps: steps.map(({ step, state }) => ({ step, state })),
  };
}
