import type { WorkerSettingsRecord, WorkerSettingsRepo } from '../ports/worker-settings';

export type WorkerQueueDeps = {
  settings: WorkerSettingsRepo;
  now?: () => Date;
};

export type WorkerQueueState = {
  paused: boolean;
  pausedAt: Date | null;
  pausedBy: string | null;
  updatedAt: Date | null;
};

function toState(row: WorkerSettingsRecord): WorkerQueueState {
  return {
    paused: row.queuePaused,
    pausedAt: row.pausedAt,
    pausedBy: row.pausedBy,
    updatedAt: row.updatedAt,
  };
}

/** Operator drain flag: when paused, in-flight work finishes and new queue work waits. */
export async function getWorkerQueueState(deps: WorkerQueueDeps): Promise<WorkerQueueState> {
  return toState(await deps.settings.get());
}

/** Turns the drain pause on or off. Discovery schedules keep running either way. */
export async function setWorkerQueuePaused(
  deps: WorkerQueueDeps,
  input: { paused: boolean; pausedBy?: string | null },
): Promise<WorkerQueueState> {
  const now = deps.now?.() ?? new Date();
  return toState(await deps.settings.setQueuePaused(input.paused, now, input.paused ? (input.pausedBy ?? null) : null));
}
