import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  DiscoveryScheduleCreate,
  DiscoveryScheduleRecord,
  DiscoveryScheduleRepo,
  JobCreate,
} from '@moncha/domain';
import { mapJob } from './job-run';

export class PrismaDiscoveryScheduleRepository implements DiscoveryScheduleRepo {
  constructor(private db: PrismaClient) {}

  async create(data: DiscoveryScheduleCreate): Promise<DiscoveryScheduleRecord | null> {
    try {
      return await this.db.discoverySchedule.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  list(tenantId: string) {
    return this.db.discoverySchedule.findMany({
      where: { tenantId },
      orderBy: [{ countryCode: 'asc' }, { timeOfDay: 'asc' }],
    });
  }

  async delete(tenantId: string, id: string) {
    const res = await this.db.discoverySchedule.deleteMany({ where: { tenantId, id } });
    return res.count > 0;
  }

  async deleteByCountry(tenantId: string, countryCode: string) {
    const res = await this.db.discoverySchedule.deleteMany({ where: { tenantId, countryCode } });
    return res.count;
  }

  due(now: Date, limit: number) {
    return this.db.discoverySchedule.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  advance(schedule: DiscoveryScheduleRecord, next: Date, ranAt: Date, job?: JobCreate) {
    return this.db.$transaction(async (tx) => {
      const moved = await tx.discoverySchedule.updateMany({
        where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
        data: { nextRunAt: next, ...(job ? { lastRunAt: ranAt } : {}) },
      });
      if (!moved.count || !job) return { advanced: moved.count > 0, job: null };
      if (job.dedupeKey) {
        const existing = await tx.jobRun.findUnique({
          where: { tenantId_dedupeKey: { tenantId: job.tenantId, dedupeKey: job.dedupeKey } },
          select: { id: true },
        });
        if (existing) return { advanced: true, job: null };
      }
      const row = await tx.jobRun.create({
        data: {
          tenantId: job.tenantId,
          type: job.type,
          payload: job.payload as Prisma.InputJsonValue,
          dedupeKey: job.dedupeKey ?? null,
          maxAttempts: job.maxAttempts ?? 1,
          runAfter: job.runAfter ?? ranAt,
        },
      });
      return { advanced: true, job: mapJob(row) };
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  async recentRuns(tenantId: string, limit: number) {
    const rows = await this.db.jobRun.findMany({
      where: { tenantId, type: 'country_discovery' },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return rows.map(mapJob);
  }
}
