import type { PrismaClient } from '@prisma/client';

export class PrismaWorkerHeartbeatRepository {
  constructor(private db: PrismaClient) {}

  async touch(workerId: string, hostname?: string) {
    return this.db.workerHeartbeat.upsert({
      where: { workerId },
      create: { workerId, hostname },
      update: { hostname },
    });
  }

  async latest() {
    return this.db.workerHeartbeat.findFirst({ orderBy: { updatedAt: 'desc' } });
  }

  async isStale(maxAgeMs: number) {
    const row = await this.latest();
    if (!row) return true;
    return Date.now() - row.updatedAt.getTime() > maxAgeMs;
  }

  /** Workers seen since `since`, newest first. */
  recent(since: Date) {
    return this.db.workerHeartbeat.findMany({ where: { updatedAt: { gte: since } }, orderBy: { updatedAt: 'desc' } });
  }

  /** Every restart gets a new workerId, so old rows are deleted to keep the table small. */
  async prune(before: Date) {
    const { count } = await this.db.workerHeartbeat.deleteMany({ where: { updatedAt: { lt: before } } });
    return count;
  }
}
