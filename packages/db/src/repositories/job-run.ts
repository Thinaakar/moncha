import { Prisma, type PrismaClient } from '@prisma/client';
import type { JobCreate, JobPatch, JobRepo, JobRunRecord } from '@moncha/domain';

/** Job types the worker claims from the queue. */
export const WORKER_JOB_TYPES = ['website_audit', 'country_discovery', 'csv_import', 'site_snapshot'] as const;
export type WorkerJobType = (typeof WORKER_JOB_TYPES)[number];

export function mapJob(row: {
  id: string;
  tenantId: string;
  type: JobRunRecord['type'];
  status: JobRunRecord['status'];
  payload: unknown;
  result: unknown;
  attempts: number;
  maxAttempts: number;
  runAfter: Date;
  lockedAt: Date | null;
  lockedBy: string | null;
  lastError: string | null;
  dedupeKey: string | null;
  leadId?: string | null;
  crawlJobId?: string | null;
  auditId?: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
}): JobRunRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    type: row.type,
    status: row.status,
    payload: row.payload,
    result: row.result,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    runAfter: row.runAfter,
    lockedAt: row.lockedAt,
    lockedBy: row.lockedBy,
    lastError: row.lastError,
    dedupeKey: row.dedupeKey,
    leadId: row.leadId ?? null,
    crawlJobId: row.crawlJobId ?? null,
    auditId: row.auditId ?? null,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    createdAt: row.createdAt,
  };
}

const SITE_LIVE = Prisma.sql`(s."workerStatus" = 'deployed')`;
/** A step stopped, or waits to retry after an error. */
const SITE_PROBLEM = Prisma.sql`(
  s.status = 'failed'
  OR (s.status IN ('pending', 'running') AND s."failureReason" IS NOT NULL)
  OR s."githubStatus" = 'failed' OR (s."githubStatus" = 'pending' AND s."githubError" IS NOT NULL)
  OR s."workerStatus" = 'failed' OR (s."workerStatus" = 'pending' AND s."workerError" IS NOT NULL)
)`;
const SITE_ACTIVE = Prisma.sql`(
  s.status IN ('pending', 'running') OR s."githubStatus" IN ('pending', 'pushing') OR s."workerStatus" IN ('pending', 'deploying')
)`;
const DEPLOY_FILTERS = {
  live: SITE_LIVE,
  problem: Prisma.sql`${SITE_LIVE} IS NOT TRUE AND ${SITE_PROBLEM} IS TRUE`,
  in_progress: Prisma.sql`${SITE_LIVE} IS NOT TRUE AND ${SITE_PROBLEM} IS NOT TRUE AND ${SITE_ACTIVE} IS TRUE`,
  not_deployed: Prisma.sql`s.status = 'done' AND s."workerStatus" IS NULL AND ${SITE_PROBLEM} IS NOT TRUE AND ${SITE_ACTIVE} IS NOT TRUE`,
} as const;

export class PrismaJobRunRepository implements JobRepo {
  constructor(private db: PrismaClient) {}

  async create(data: JobCreate) {
    const now = new Date();
    const running = data.status === 'running';
    const row = await this.db.jobRun.create({
      data: {
        tenantId: data.tenantId,
        type: data.type,
        payload: data.payload as Prisma.InputJsonValue,
        dedupeKey: data.dedupeKey ?? null,
        leadId: data.leadId ?? null,
        crawlJobId: data.crawlJobId ?? null,
        maxAttempts: data.maxAttempts ?? 3,
        runAfter: data.runAfter ?? now,
        ...(running ? { status: 'running', attempts: 1, startedAt: now, lockedAt: now } : {}),
      },
    });
    return mapJob(row);
  }

  async update(tenantId: string, id: string, data: JobPatch) {
    const existing = await this.db.jobRun.findFirst({ where: { id, tenantId } });
    if (!existing) return null;
    const row = await this.db.jobRun.update({
      where: { id },
      data: {
        status: data.status,
        lastError: data.lastError,
        result: data.result as Prisma.InputJsonValue | undefined,
        auditId: data.auditId,
        attempts: data.attempts,
        runAfter: data.runAfter === null ? undefined : data.runAfter,
        lockedAt: data.lockedAt === undefined ? undefined : data.lockedAt,
        lockedBy: data.lockedBy === undefined ? undefined : data.lockedBy,
        startedAt: data.startedAt === undefined ? undefined : data.startedAt,
        finishedAt: data.finishedAt === undefined ? undefined : data.finishedAt,
      },
    });
    return mapJob(row);
  }

  async get(tenantId: string, id: string) {
    const row = await this.db.jobRun.findFirst({ where: { tenantId, id } });
    return row ? mapJob(row) : null;
  }

  list(tenantId: string) {
    return this.db.jobRun.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }

  /** Newest first. `payload` drops `records`: a queued CSV import stores up to 20,000 rows there. */
  async listPage(
    tenantId: string,
    query: {
      page: number;
      pageSize: number;
      type?: JobRunRecord['type'];
      status?: JobRunRecord['status'];
      /** Website copies only: who started them. Copies made before automation existed count as manual. */
      origin?: 'auto' | 'manual';
      /** Website copies only: where the copy is on the way to its live URL (see `siteDeployFilterSchema`). */
      deploy?: 'live' | 'in_progress' | 'problem' | 'not_deployed';
    },
  ) {
    const page = Math.max(1, Math.floor(query.page));
    const pageSize = Math.min(100, Math.max(1, Math.floor(query.pageSize)));
    const typeFilter = query.type ? Prisma.sql`AND type = ${query.type}::"JobType"` : Prisma.empty;
    const statusFilter = query.status ? Prisma.sql`AND status = ${query.status}::"JobStatus"` : Prisma.empty;
    const originFilter = query.origin
      ? Prisma.sql`AND type = 'site_snapshot' AND COALESCE(payload->>'origin', 'manual') = ${query.origin}`
      : Prisma.empty;
    const deployFilter = query.deploy
      ? Prisma.sql`AND EXISTS (SELECT 1 FROM "SiteSnapshot" s WHERE s."jobId" = "JobRun".id AND ${DEPLOY_FILTERS[query.deploy]})`
      : Prisma.empty;
    const [rows, counted] = await Promise.all([
      this.db.$queryRaw<
        Array<{
          id: string;
          type: JobRunRecord['type'];
          status: JobRunRecord['status'];
          payload: unknown;
          result: unknown;
          attempts: number;
          maxAttempts: number;
          runAfter: Date;
          lastError: string | null;
          startedAt: Date | null;
          finishedAt: Date | null;
          createdAt: Date;
        }>
      >`
        SELECT id, type, status, payload - 'records' AS payload, result, attempts, "maxAttempts",
               "runAfter", "lastError", "startedAt", "finishedAt", "createdAt"
        FROM "JobRun"
        WHERE "tenantId" = ${tenantId} ${typeFilter} ${statusFilter} ${originFilter} ${deployFilter}
        ORDER BY "createdAt" DESC, id DESC
        OFFSET ${(page - 1) * pageSize}
        LIMIT ${pageSize}
      `,
      this.db.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n FROM "JobRun"
        WHERE "tenantId" = ${tenantId} ${typeFilter} ${statusFilter} ${originFilter} ${deployFilter}
      `,
    ]);
    const total = Number(counted[0]?.n ?? 0);
    return { items: rows, total, page, pageSize, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
  }

  /**
   * Claim up to `limit` pending jobs of one type using SKIP LOCKED; with `id`, only that job.
   * places_discovery stays with the console in-process runner.
   */
  async claimJobs(
    workerId: string,
    limit: number,
    type: WorkerJobType = 'website_audit',
    options: { id?: string } = {},
  ): Promise<JobRunRecord[]> {
    // The console runs its own csv_import jobs in-process; only API-queued ones belong to the worker.
    const onlyQueuedCsv = type === 'csv_import' ? Prisma.sql`AND payload->>'mode' = 'queued'` : Prisma.empty;
    const onlyId = options.id ? Prisma.sql`AND id = ${options.id}` : Prisma.empty;
    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        tenantId: string;
        type: JobRunRecord['type'];
        status: JobRunRecord['status'];
        payload: unknown;
        result: unknown;
        attempts: number;
        maxAttempts: number;
        runAfter: Date;
        lockedAt: Date | null;
        lockedBy: string | null;
        lastError: string | null;
        dedupeKey: string | null;
        leadId: string | null;
        crawlJobId: string | null;
        auditId: string | null;
        startedAt: Date | null;
        finishedAt: Date | null;
        createdAt: Date;
      }>
    >`
      UPDATE "JobRun" AS j
      SET
        status = 'running',
        "lockedAt" = NOW(),
        "lockedBy" = ${workerId},
        attempts = j.attempts + 1,
        "startedAt" = COALESCE(j."startedAt", NOW())
      WHERE j.id IN (
        SELECT id FROM "JobRun"
        WHERE status = 'pending'
          AND "runAfter" <= NOW()
          AND type = ${type}::"JobType"
          ${onlyQueuedCsv}
          ${onlyId}
        ORDER BY "runAfter" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      -- No RETURNING *: Neon's pooler keeps prepared plans across deploys, and they fail once a column is added.
      RETURNING j.id, j."tenantId", j.type, j.status, j.payload, j.result, j.attempts, j."maxAttempts",
                j."runAfter", j."lockedAt", j."lockedBy", j."lastError", j."dedupeKey", j."leadId",
                j."crawlJobId", j."auditId", j."startedAt", j."finishedAt", j."createdAt"
    `;
    return rows.map(mapJob);
  }

  async recoverStuck(staleBefore: Date) {
    const result = await this.db.jobRun.updateMany({
      where: {
        // Only jobs claimJobs hands out; other runners own their own job rows.
        OR: [
          { type: { in: ['website_audit', 'country_discovery', 'site_snapshot'] } },
          { type: 'csv_import', payload: { path: ['mode'], equals: 'queued' } },
        ],
        status: 'running',
        lockedAt: { lt: staleBefore },
      },
      data: {
        status: 'pending',
        lockedAt: null,
        lockedBy: null,
      },
    });
    return result.count;
  }
}
