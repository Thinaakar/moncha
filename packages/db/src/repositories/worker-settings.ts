import type { PrismaClient } from '@prisma/client';
import type { WorkerSettingsRecord, WorkerSettingsRepo } from '@moncha/domain';

const DEFAULT_ID = 'default';

function map(row: { id: string; queuePaused: boolean; pausedAt: Date | null; pausedBy: string | null; updatedAt: Date }): WorkerSettingsRecord {
  return {
    id: row.id,
    queuePaused: row.queuePaused,
    pausedAt: row.pausedAt,
    pausedBy: row.pausedBy,
    updatedAt: row.updatedAt,
  };
}

export class PrismaWorkerSettingsRepository implements WorkerSettingsRepo {
  constructor(private db: PrismaClient) {}

  async get(): Promise<WorkerSettingsRecord> {
    const row =
      (await this.db.workerSettings.findUnique({ where: { id: DEFAULT_ID } })) ??
      (await this.db.workerSettings.create({ data: { id: DEFAULT_ID, queuePaused: false } }));
    return map(row);
  }

  async setQueuePaused(paused: boolean, at: Date, pausedBy: string | null): Promise<WorkerSettingsRecord> {
    const row = await this.db.workerSettings.upsert({
      where: { id: DEFAULT_ID },
      create: {
        id: DEFAULT_ID,
        queuePaused: paused,
        pausedAt: paused ? at : null,
        pausedBy: paused ? pausedBy : null,
        updatedAt: at,
      },
      update: {
        queuePaused: paused,
        pausedAt: paused ? at : null,
        pausedBy: paused ? pausedBy : null,
        updatedAt: at,
      },
    });
    return map(row);
  }
}
