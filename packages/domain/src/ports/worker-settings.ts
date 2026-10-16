export type WorkerSettingsRecord = {
  id: string;
  queuePaused: boolean;
  pausedAt: Date | null;
  pausedBy: string | null;
  updatedAt: Date | null;
};

export interface WorkerSettingsRepo {
  get(): Promise<WorkerSettingsRecord>;
  /** Sets or clears the operator drain pause. `pausedBy` is the user id when pausing. */
  setQueuePaused(paused: boolean, at: Date, pausedBy: string | null): Promise<WorkerSettingsRecord>;
};
