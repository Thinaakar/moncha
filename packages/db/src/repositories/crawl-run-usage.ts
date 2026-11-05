import { Prisma, type PrismaClient } from '@prisma/client';
import type { CrawlRunClaim, CrawlRunUsage, JobCreate, JobRunRecord } from '@moncha/domain';
import { utcDay } from '@moncha/domain';
import { mapJob } from './job-run';

type Tx = Prisma.TransactionClient;

const DAY_MS = 24 * 60 * 60_000;

function dayBounds(now: Date): { day: string; start: Date; end: Date } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return { day: utcDay(now), start, end: new Date(start.getTime() + DAY_MS) };
}

/** Today's usage row, or the country crawls already created today when no run was claimed yet. */
export async function crawlRunUsageToday(db: PrismaClient | Tx, tenantId: string, now = new Date()): Promise<CrawlRunUsage> {
  const { day, start, end } = dayBounds(now);
  const row = await db.crawlRunUsage.findUnique({ where: { tenantId_day: { tenantId, day } } });
  if (row) return { day, runs: row.runs, scheduledRuns: row.scheduledRuns };
  return { day, ...(await countExistingRuns(db, tenantId, start, end)) };
}

async function countExistingRuns(db: PrismaClient | Tx, tenantId: string, start: Date, end: Date) {
  const rows = await db.$queryRaw<Array<{ runs: number; scheduled: number }>>`
    SELECT COUNT(*)::int AS runs,
           (COUNT(*) FILTER (WHERE payload->>'origin' = 'schedule'))::int AS scheduled
    FROM "JobRun"
    WHERE "tenantId" = ${tenantId} AND type = 'country_discovery'
      AND "createdAt" >= ${start} AND "createdAt" < ${end}`;
  return { runs: Number(rows[0]?.runs ?? 0), scheduledRuns: Number(rows[0]?.scheduled ?? 0) };
}

/**
 * Claims one of today's crawl runs inside the caller's transaction, or returns null when the limit is reached.
 *
 * 1. The first claim of a UTC day creates the tenant's row from the country crawls that already exist that day
 *    (INSERT … ON CONFLICT DO NOTHING: concurrent first claims seed it once; the loser waits for the winner's commit).
 * 2. One conditional UPDATE claims the run. Its row lock serialises concurrent claims, and the same rule applies to
 *    every claim, the first one included: never more than `maxRuns`, and auto-recrawl or manual runs never use the runs
 *    reserved for schedules.
 *
 * The caller creates the job in the same transaction, so a failed or duplicate job rolls the claim back.
 */
export async function claimCrawlRun(tx: Tx, tenantId: string, claim: CrawlRunClaim, now: Date): Promise<CrawlRunUsage | null> {
  const { day, start, end } = dayBounds(now);
  const exists = await tx.crawlRunUsage.findUnique({ where: { tenantId_day: { tenantId, day } }, select: { day: true } });
  if (!exists) {
    const seed = await countExistingRuns(tx, tenantId, start, end);
    await tx.$executeRaw`
      INSERT INTO "CrawlRunUsage" ("tenantId", day, runs, "scheduledRuns", "updatedAt")
      VALUES (${tenantId}, ${day}, ${seed.runs}, ${seed.scheduledRuns}, ${now})
      ON CONFLICT ("tenantId", day) DO NOTHING`;
  }
  const isSchedule = claim.kind === 'schedule' ? 1 : 0;
  const reserved = Math.min(claim.maxRuns, Math.max(0, claim.reservedForSchedules));
  const rows = await tx.$queryRaw<Array<{ runs: number; scheduledRuns: number }>>`
    UPDATE "CrawlRunUsage"
    SET runs = runs + 1, "scheduledRuns" = "scheduledRuns" + ${isSchedule}, "updatedAt" = ${now}
    WHERE "tenantId" = ${tenantId} AND day = ${day}
      AND runs < ${claim.maxRuns}
      AND (${isSchedule} = 1 OR runs - "scheduledRuns" < ${claim.maxRuns - reserved})
    RETURNING runs, "scheduledRuns"`;
  const row = rows[0];
  return row ? { day, runs: Number(row.runs), scheduledRuns: Number(row.scheduledRuns) } : null;
}

/** Creates a country_discovery job inside the caller's transaction, with the same clock as its claim. */
export async function createCrawlJobRow(tx: Tx, job: JobCreate, now: Date): Promise<JobRunRecord> {
  const row = await tx.jobRun.create({
    data: {
      tenantId: job.tenantId,
      type: 'country_discovery',
      payload: job.payload as Prisma.InputJsonValue,
      dedupeKey: job.dedupeKey ?? null,
      maxAttempts: job.maxAttempts ?? 1,
      runAfter: job.runAfter ?? now,
      createdAt: now,
      ...(job.status === 'running' ? { status: 'running', attempts: 1, startedAt: now, lockedAt: now } : {}),
    },
  });
  return mapJob(row);
}

export type ClaimedCrawlJob =
  | { status: 'created'; job: JobRunRecord; usage: CrawlRunUsage }
  | { status: 'limited'; usage: CrawlRunUsage };

/** Claims a daily run and creates its country_discovery job in one transaction (both or neither). */
export async function createClaimedCrawlJob(
  db: PrismaClient,
  input: { job: JobCreate; claim: CrawlRunClaim; now?: Date },
): Promise<ClaimedCrawlJob> {
  const now = input.now ?? new Date();
  return db.$transaction(
    async (tx) => {
      const usage = await claimCrawlRun(tx, input.job.tenantId, input.claim, now);
      if (!usage) return { status: 'limited' as const, usage: await crawlRunUsageToday(tx, input.job.tenantId, now) };
      const job = await createCrawlJobRow(tx, input.job, now);
      return { status: 'created' as const, job, usage };
    },
    { maxWait: 15_000, timeout: 30_000 },
  );
}
