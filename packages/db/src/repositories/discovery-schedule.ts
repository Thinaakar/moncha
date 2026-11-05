import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  CrawlRunClaim,
  DiscoveryScheduleCreate,
  DiscoveryScheduleRecord,
  DiscoveryScheduleRepo,
  JobCreate,
  ScheduleAdvanceResult,
  ScheduleSkipReason,
  ScheduleSkipRecord,
} from '@moncha/domain';
import { claimCrawlRun, createCrawlJobRow } from './crawl-run-usage';
import { mapJob } from './job-run';

/** A skipped slot, once per schedule and slot (a second scheduler that lost the advance writes nothing). */
async function recordSkip(
  tx: Prisma.TransactionClient,
  schedule: DiscoveryScheduleRecord,
  reason: ScheduleSkipReason,
  detail: string | null,
  at: Date,
) {
  await tx.scheduleRunSkip.createMany({
    data: [
      {
        tenantId: schedule.tenantId,
        scheduleId: schedule.id,
        countryCode: schedule.countryCode,
        timeOfDay: schedule.timeOfDay,
        timezone: schedule.timezone,
        scheduledFor: schedule.nextRunAt,
        reason,
        detail: detail?.slice(0, 500) ?? null,
        createdAt: at,
      },
    ],
    skipDuplicates: true,
  });
}

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

  async setIndustries(tenantId: string, id: string, industries: string[]) {
    const res = await this.db.discoverySchedule.updateMany({ where: { tenantId, id }, data: { industries } });
    if (!res.count) return null;
    return this.db.discoverySchedule.findFirst({ where: { tenantId, id } });
  }

  due(now: Date, limit: number) {
    return this.db.discoverySchedule.findMany({
      where: { enabled: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: 'asc' },
      take: limit,
    });
  }

  /**
   * One transaction: move the slot, then either record a skip, or claim a daily run (when `claim` is given) and create
   * the job. A failed claim records a daily_run_limit skip instead; a failed job insert rolls everything back.
   */
  advance(
    schedule: DiscoveryScheduleRecord,
    next: Date,
    ranAt: Date,
    job?: JobCreate,
    options?: { claim?: CrawlRunClaim; skip?: { reason: ScheduleSkipReason; detail?: string | null } },
  ): Promise<ScheduleAdvanceResult> {
    return this.db.$transaction(async (tx) => {
      const moved = await tx.discoverySchedule.updateMany({
        where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
        data: { nextRunAt: next },
      });
      if (!moved.count) return { advanced: false, job: null };
      if (!job) {
        if (options?.skip) await recordSkip(tx, schedule, options.skip.reason, options.skip.detail ?? null, ranAt);
        return { advanced: true, job: null };
      }
      if (job.dedupeKey) {
        const existing = await tx.jobRun.findUnique({
          where: { tenantId_dedupeKey: { tenantId: job.tenantId, dedupeKey: job.dedupeKey } },
          select: { id: true },
        });
        if (existing) return { advanced: true, job: null };
      }
      if (options?.claim) {
        const usage = await claimCrawlRun(tx, job.tenantId, options.claim, ranAt);
        if (!usage) {
          await recordSkip(tx, schedule, 'daily_run_limit', null, ranAt);
          return { advanced: true, job: null, limited: true };
        }
      }
      await tx.discoverySchedule.update({ where: { id: schedule.id }, data: { lastRunAt: ranAt } });
      const created =
        job.type === 'country_discovery'
          ? await createCrawlJobRow(tx, job, ranAt)
          : mapJob(
              await tx.jobRun.create({
                data: {
                  tenantId: job.tenantId,
                  type: job.type,
                  payload: job.payload as Prisma.InputJsonValue,
                  dedupeKey: job.dedupeKey ?? null,
                  maxAttempts: job.maxAttempts ?? 1,
                  runAfter: job.runAfter ?? ranAt,
                },
              }),
            );
      return { advanced: true, job: created };
    }, { maxWait: 15_000, timeout: 30_000 });
  }

  async recentSkips(tenantId: string, limit: number): Promise<ScheduleSkipRecord[]> {
    const rows = await this.db.scheduleRunSkip.findMany({
      where: { tenantId },
      orderBy: [{ scheduledFor: 'desc' }, { id: 'desc' }],
      take: limit,
    });
    return rows.map((r) => ({ ...r, reason: r.reason as ScheduleSkipReason }));
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
