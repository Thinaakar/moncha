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
}
