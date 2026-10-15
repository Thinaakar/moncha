import { Prisma, type PrismaClient, type SiteSnapshot } from '@prisma/client';
import type {
  SiteBrand,
  SiteCancelResult,
  SiteChatbotStatus,
  SiteCopyOrigin,
  SiteGithubRequestResult,
  SiteGithubStatus,
  SitePipelineRepo,
  SitePipelineSteps,
  SiteQueueEntry,
  SiteSnapshotListItem,
  SiteSnapshotListQuery,
  SiteSnapshotPatch,
  SiteSnapshotRecord,
  SiteSnapshotRepo,
  SiteWorkerRequestResult,
  SiteWorkerStatus,
  SiteCopyStage,
} from '@moncha/domain';
import { clampPage, clampPageSize, siteStoragePrefix } from '@moncha/domain';
import { mapJob } from './job-run';

const companySelect = { lead: { select: { company: { select: { id: true, name: true, domain: true } } } } } as const;

type RowWithCompany = SiteSnapshot & { lead: { company: { id: string; name: string; domain: string | null } } };

function mapSnapshot(row: SiteSnapshot): SiteSnapshotRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    leadId: row.leadId,
    jobId: row.jobId,
    status: row.status,
    sourceUrl: row.sourceUrl,
    finalUrl: row.finalUrl,
    httpStatus: row.httpStatus,
    storagePrefix: row.storagePrefix,
    sourceHash: row.sourceHash,
    sourceBytes: row.sourceBytes,
    sourceCharset: row.sourceCharset,
    assetCount: row.assetCount,
    skippedAssetCount: row.skippedAssetCount,
    totalBytes: row.totalBytes,
    brand: (row.brand as SiteBrand | null) ?? null,
    llmModel: row.llmModel,
    llmPromptTokens: row.llmPromptTokens,
    llmCompletionTokens: row.llmCompletionTokens,
    llmCostUsd: row.llmCostUsd,
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
    failureReason: row.failureReason,
    failureDetail: row.failureDetail,
    attempts: row.attempts,
    origin: row.origin,
    crawlJobId: row.crawlJobId,
    githubStatus: (row.githubStatus as SiteGithubStatus | null) ?? null,
    githubAttempts: row.githubAttempts,
    githubNextAt: row.githubNextAt,
    githubCommitSha: row.githubCommitSha,
    githubCommitUrl: row.githubCommitUrl,
    githubFolderUrl: row.githubFolderUrl,
    githubError: row.githubError,
    githubPushedAt: row.githubPushedAt,
    githubRepo: row.githubRepo,
    workerStatus: (row.workerStatus as SiteWorkerStatus | null) ?? null,
    workerAttempts: row.workerAttempts,
    workerNextAt: row.workerNextAt,
    workerName: row.workerName,
    workerUrl: row.workerUrl,
    workerError: row.workerError,
    workerDeployedAt: row.workerDeployedAt,
    chatbotStatus: (row.chatbotStatus as SiteChatbotStatus | null) ?? null,
    chatbotAttempts: row.chatbotAttempts,
    chatbotNextAt: row.chatbotNextAt,
    chatbotError: row.chatbotError,
    chatbotInstalledAt: row.chatbotInstalledAt,
    stage: (row.stage as SiteCopyStage | null) ?? null,
    stageAt: row.stageAt,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

function mapListItem(row: RowWithCompany): SiteSnapshotListItem {
  const { lead, ...rest } = row;
  return { ...mapSnapshot(rest), company: lead.company };
}

const jsonOrNull = (value: unknown) => (value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

export class PrismaSiteSnapshotRepository implements SiteSnapshotRepo, SitePipelineRepo {
  constructor(private db: PrismaClient) {}

  async createWithJob(input: {
    tenantId: string;
    leadId: string;
    sourceUrl: string;
    maxAttempts: number;
    origin?: SiteCopyOrigin;
    crawlJobId?: string | null;
    dedupeKey?: string;
  }) {
    const origin = input.origin ?? 'manual';
    const crawlJobId = input.crawlJobId ?? null;
    return this.db.$transaction(async (tx) => {
      const created = await tx.siteSnapshot.create({
        data: {
          tenantId: input.tenantId,
          leadId: input.leadId,
          sourceUrl: input.sourceUrl,
          storagePrefix: '',
          origin,
          crawlJobId,
        },
      });
      const job = await tx.jobRun.create({
        data: {
          tenantId: input.tenantId,
          type: 'site_snapshot',
          payload: {
            snapshotId: created.id,
            leadId: input.leadId,
            url: input.sourceUrl,
            origin,
            ...(crawlJobId ? { crawlJobId } : {}),
          },
          leadId: input.leadId,
          crawlJobId,
          maxAttempts: input.maxAttempts,
          dedupeKey: input.dedupeKey ?? `site_snapshot:${input.leadId}:${Date.now()}`,
        },
      });
      const snapshot = await tx.siteSnapshot.update({
        where: { id: created.id },
        data: { jobId: job.id, storagePrefix: siteStoragePrefix(input.tenantId, created.id) },
      });
      return { snapshot: mapSnapshot(snapshot), job: mapJob(job) };
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.db.siteSnapshot.findFirst({ where: { id, tenantId }, include: companySelect });
    return row ? mapListItem(row) : null;
  }

  async update(tenantId: string, id: string, patch: SiteSnapshotPatch) {
    const { brand, warnings, ...rest } = patch;
    const { count } = await this.db.siteSnapshot.updateMany({
      where: { id, tenantId },
      data: {
        ...rest,
        ...(brand !== undefined ? { brand: jsonOrNull(brand) } : {}),
        ...(warnings !== undefined ? { warnings: jsonOrNull(warnings) } : {}),
      },
    });
    if (!count) return null;
    const row = await this.db.siteSnapshot.findUnique({ where: { id } });
    return row ? mapSnapshot(row) : null;
  }

  async findOpenForLead(tenantId: string, leadId: string) {
    const row = await this.db.siteSnapshot.findFirst({
      where: { tenantId, leadId, status: { in: ['pending', 'running'] } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? mapSnapshot(row) : null;
  }

  /** Copies made by these site_snapshot jobs (one copy per job). */
  async listByJobIds(tenantId: string, jobIds: string[]) {
    if (!jobIds.length) return [];
    const rows = await this.db.siteSnapshot.findMany({ where: { tenantId, jobId: { in: jobIds } }, include: companySelect });
    return rows.map(mapListItem);
  }

  async listForLead(tenantId: string, leadId: string, limit: number) {
    const rows = await this.db.siteSnapshot.findMany({
      where: { tenantId, leadId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(100, Math.max(1, limit)),
      include: companySelect,
    });
    return rows.map(mapListItem);
  }

  async list(tenantId: string, query: SiteSnapshotListQuery) {
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);
    const search = query.search?.trim();
    const where: Prisma.SiteSnapshotWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.origin ? { origin: query.origin } : {}),
      ...(search
        ? {
            OR: [
              { sourceUrl: { contains: search, mode: 'insensitive' } },
              { lead: { company: { name: { contains: search, mode: 'insensitive' } } } },
              { lead: { company: { domain: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.siteSnapshot.findMany({
        where,
        include: companySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.siteSnapshot.count({ where }),
    ]);
    return {
      items: rows.map(mapListItem),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async queue(tenantId: string): Promise<SiteQueueEntry[]> {
    const rows = await this.db.siteSnapshot.findMany({
      where: { tenantId, status: { in: ['pending', 'running'] } },
      include: companySelect,
      take: 500,
    });
    const jobIds = rows.map((r) => r.jobId).filter((id): id is string => Boolean(id));
    const jobs = jobIds.length
      ? await this.db.jobRun.findMany({
          where: { tenantId, id: { in: jobIds } },
          select: {
            id: true,
            status: true,
            attempts: true,
            maxAttempts: true,
            runAfter: true,
            lockedAt: true,
            startedAt: true,
            lastError: true,
            createdAt: true,
          },
        })
      : [];
    const byId = new Map(jobs.map((j) => [j.id, j]));
    const entries: SiteQueueEntry[] = rows.map((row) => ({ ...mapListItem(row), job: (row.jobId && byId.get(row.jobId)) || null }));
    const sortKey = (e: SiteQueueEntry) => [(e.job?.runAfter ?? e.createdAt).getTime(), (e.job?.createdAt ?? e.createdAt).getTime()];
    return entries.sort((a, b) => {
      const [ra, ca] = sortKey(a);
      const [rb, cb] = sortKey(b);
      return ra! - rb! || ca! - cb! || a.id.localeCompare(b.id);
    });
  }

  async cancel(tenantId: string, id: string, at: Date): Promise<SiteCancelResult> {
    return this.db.$transaction(async (tx) => {
      const snapshot = await tx.siteSnapshot.findFirst({ where: { id, tenantId }, select: { id: true, jobId: true, status: true } });
      if (!snapshot) return 'not_found';
      if (snapshot.status !== 'pending') return 'not_pending';
      if (snapshot.jobId) {
        const { count } = await tx.jobRun.updateMany({
          where: { id: snapshot.jobId, tenantId, status: 'pending' },
          data: { status: 'failed', lastError: 'cancelled', finishedAt: at, lockedAt: null, lockedBy: null },
        });
        if (!count) return 'not_pending';
      }
      await tx.siteSnapshot.update({
        where: { id: snapshot.id },
        data: { status: 'failed', failureReason: 'cancelled', finishedAt: at },
      });
      return 'cancelled';
    });
  }

  async averageRunMs(tenantId: string, sample: number): Promise<number | null> {
    const rows = await this.db.$queryRaw<Array<{ avg_ms: number | null }>>`
      SELECT AVG(EXTRACT(EPOCH FROM (j."finishedAt" - COALESCE(j."lockedAt", j."startedAt"))) * 1000)::float8 AS avg_ms
      FROM (
        SELECT "finishedAt", "lockedAt", "startedAt" FROM "JobRun"
        WHERE "tenantId" = ${tenantId} AND type = 'site_snapshot' AND status = 'done'
          AND "finishedAt" IS NOT NULL AND "startedAt" IS NOT NULL
        ORDER BY "finishedAt" DESC
        LIMIT ${Math.max(1, Math.min(100, sample))}
      ) j`;
    const avg = rows[0]?.avg_ms;
    return typeof avg === 'number' && Number.isFinite(avg) && avg > 0 ? Math.round(avg) : null;
  }

  async claimGithubPush(now: Date, staleBefore: Date, options: { id?: string } = {}): Promise<SiteSnapshotListItem | null> {
    const onlyId = options.id ? Prisma.sql`AND id = ${options.id}` : Prisma.empty;
    const rows = await this.db.$queryRaw<Array<{ id: string; tenantId: string }>>`
      UPDATE "SiteSnapshot" AS s
      SET "githubStatus" = 'pushing', "githubLockedAt" = ${now}, "githubAttempts" = s."githubAttempts" + 1
      WHERE s.id = (
        SELECT id FROM "SiteSnapshot"
        WHERE status = 'done'
          ${onlyId}
          AND (
            ("githubStatus" = 'pending' AND ("githubNextAt" IS NULL OR "githubNextAt" <= ${now}))
            OR ("githubStatus" = 'pushing' AND "githubLockedAt" < ${staleBefore})
          )
        ORDER BY "githubNextAt" ASC NULLS FIRST, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING s.id, s."tenantId"`;
    const claimed = rows[0];
    return claimed ? this.get(claimed.tenantId, claimed.id) : null;
  }

  async requestGithubPush(tenantId: string, id: string, now: Date): Promise<SiteGithubRequestResult> {
    const snapshot = await this.db.siteSnapshot.findFirst({ where: { id, tenantId }, select: { status: true } });
    if (!snapshot) return 'not_found';
    if (snapshot.status !== 'done') return 'not_done';
    const { count } = await this.db.siteSnapshot.updateMany({
      where: { id, tenantId, status: 'done', OR: [{ githubStatus: null }, { githubStatus: { not: 'pushing' } }] },
      data: { githubStatus: 'pending', githubAttempts: 0, githubNextAt: now, githubError: null, githubLockedAt: null },
    });
    return count ? 'queued' : 'busy';
  }

  async claimWorkerDeploy(
    now: Date,
    staleBefore: Date,
    options: { afterGithub?: boolean; id?: string } = {},
  ): Promise<SiteSnapshotListItem | null> {
    const afterGithub = Boolean(options.afterGithub);
    const onlyId = options.id ? Prisma.sql`AND id = ${options.id}` : Prisma.empty;
    const rows = await this.db.$queryRaw<Array<{ id: string; tenantId: string }>>`
      UPDATE "SiteSnapshot" AS s
      SET "workerStatus" = 'deploying', "workerLockedAt" = ${now}, "workerAttempts" = s."workerAttempts" + 1
      WHERE s.id = (
        SELECT id FROM "SiteSnapshot"
        WHERE status = 'done'
          ${onlyId}
          AND (
            ("workerStatus" = 'pending' AND ("workerNextAt" IS NULL OR "workerNextAt" <= ${now})
              AND (${afterGithub} = false OR "githubStatus" = 'pushed'))
            OR ("workerStatus" = 'deploying' AND "workerLockedAt" < ${staleBefore})
          )
        ORDER BY "workerNextAt" ASC NULLS FIRST, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING s.id, s."tenantId"`;
    const claimed = rows[0];
    return claimed ? this.get(claimed.tenantId, claimed.id) : null;
  }

  async requestWorkerDeploy(tenantId: string, id: string, now: Date): Promise<SiteWorkerRequestResult> {
    const snapshot = await this.db.siteSnapshot.findFirst({ where: { id, tenantId }, select: { status: true } });
    if (!snapshot) return 'not_found';
    if (snapshot.status !== 'done') return 'not_done';
    const { count } = await this.db.siteSnapshot.updateMany({
      where: { id, tenantId, status: 'done', OR: [{ workerStatus: null }, { workerStatus: { not: 'deploying' } }] },
      data: { workerStatus: 'pending', workerAttempts: 0, workerNextAt: now, workerError: null, workerLockedAt: null },
    });
    return count ? 'queued' : 'busy';
  }

  async claimChatbotInstall(now: Date, staleBefore: Date, options: { id?: string } = {}): Promise<SiteSnapshotListItem | null> {
    const onlyId = options.id ? Prisma.sql`AND id = ${options.id}` : Prisma.empty;
    const rows = await this.db.$queryRaw<Array<{ id: string; tenantId: string }>>`
      UPDATE "SiteSnapshot" AS s
      SET "chatbotStatus" = 'installing', "chatbotLockedAt" = ${now}, "chatbotAttempts" = s."chatbotAttempts" + 1
      WHERE s.id = (
        SELECT id FROM "SiteSnapshot"
        WHERE status = 'done'
          ${onlyId}
          AND (
            ("chatbotStatus" = 'pending' AND ("chatbotNextAt" IS NULL OR "chatbotNextAt" <= ${now}))
            OR ("chatbotStatus" = 'installing' AND "chatbotLockedAt" < ${staleBefore})
          )
        ORDER BY "chatbotNextAt" ASC NULLS FIRST, "createdAt" ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING s.id, s."tenantId"`;
    const claimed = rows[0];
    return claimed ? this.get(claimed.tenantId, claimed.id) : null;
  }

  async requestChatbotInstall(tenantId: string, id: string, now: Date): Promise<SiteGithubRequestResult> {
    const snapshot = await this.db.siteSnapshot.findFirst({ where: { id, tenantId }, select: { status: true } });
    if (!snapshot) return 'not_found';
    if (snapshot.status !== 'done') return 'not_done';
    const { count } = await this.db.siteSnapshot.updateMany({
      where: { id, tenantId, status: 'done', OR: [{ chatbotStatus: null }, { chatbotStatus: { not: 'installing' } }] },
      data: { chatbotStatus: 'pending', chatbotAttempts: 0, chatbotNextAt: now, chatbotError: null, chatbotLockedAt: null },
    });
    return count ? 'queued' : 'busy';
  }

  async currentPublish(): Promise<SiteSnapshotListItem | null> {
    const rows = await this.db.$queryRaw<Array<{ id: string; tenantId: string }>>`
      SELECT s.id, s."tenantId" FROM "SiteSnapshot" s
      JOIN "JobRun" j ON j.id = s."jobId"
      WHERE s.status = 'done' AND j.status = 'running' AND j."lockedAt" IS NULL
      ORDER BY j."startedAt" ASC NULLS LAST, s.id
      LIMIT 1`;
    return this.getFirst(rows);
  }

  async inFlightCopy(): Promise<SiteSnapshotListItem | null> {
    const rows = await this.db.$queryRaw<Array<{ id: string; tenantId: string }>>`
      SELECT s.id, s."tenantId" FROM "SiteSnapshot" s
      JOIN "JobRun" j ON j.id = s."jobId"
      WHERE (s.status = 'running' OR (s.status = 'pending' AND s.attempts > 0))
        AND j.status IN ('pending', 'running')
      ORDER BY s."createdAt" ASC, s.id
      LIMIT 1`;
    return this.getFirst(rows);
  }

  async nextToPublish(steps: SitePipelineSteps): Promise<SiteSnapshotListItem | null> {
    const rows = await this.db.$queryRaw<Array<{ id: string; tenantId: string }>>`
      SELECT s.id, s."tenantId" FROM "SiteSnapshot" s
      WHERE ${needsPublish(steps)}
      ORDER BY (s."workerStatus" IS NOT DISTINCT FROM 'deployed') DESC, s."finishedAt" DESC NULLS LAST, s.id
      LIMIT 1`;
    return this.getFirst(rows);
  }

  async countToPublish(tenantId: string, steps: SitePipelineSteps): Promise<number> {
    const rows = await this.db.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(*)::int AS n FROM "SiteSnapshot" s WHERE s."tenantId" = ${tenantId} AND ${needsPublish(steps)}`;
    return rows[0]?.n ?? 0;
  }

  countWaitingCopies(tenantId: string): Promise<number> {
    return this.db.siteSnapshot.count({ where: { tenantId, status: 'pending', attempts: 0 } });
  }

  private async getFirst(rows: Array<{ id: string; tenantId: string }>) {
    const first = rows[0];
    return first ? this.get(first.tenantId, first.id) : null;
  }
}

/**
 * A done copy that still needs a publish step and whose steps have not given up. Copies with no job are left to the
 * console buttons, and so is an older copy once a newer copy of the same lead is done (it would overwrite the Worker).
 * With the chatbot step, a copy waits until its lead's MonCha bot is created and trained (live websites without the
 * chatbot are picked up as their bots finish training).
 */
function needsPublish(steps: SitePipelineSteps): Prisma.Sql {
  const chatbot = steps.chatbot ? Prisma.sql`s."chatbotStatus" IS DISTINCT FROM 'installed'` : Prisma.sql`FALSE`;
  const github = steps.github ? Prisma.sql`s."githubStatus" IS DISTINCT FROM 'pushed'` : Prisma.sql`FALSE`;
  const worker = steps.worker ? Prisma.sql`s."workerStatus" IS DISTINCT FROM 'deployed'` : Prisma.sql`FALSE`;
  const botReady = steps.chatbot
    ? Prisma.sql`AND EXISTS (
        SELECT 1 FROM "LeadBot" b WHERE b."leadId" = s."leadId" AND b.status = 'created' AND b."knowledgeStatus" = 'trained'
      )`
    : Prisma.empty;
  return Prisma.sql`s.status = 'done'
    AND s."jobId" IS NOT NULL
    AND s."githubStatus" IS DISTINCT FROM 'failed'
    AND s."workerStatus" IS DISTINCT FROM 'failed'
    AND s."chatbotStatus" IS DISTINCT FROM 'failed'
    AND (${chatbot} OR ${github} OR ${worker})
    ${botReady}
    AND NOT EXISTS (
      SELECT 1 FROM "SiteSnapshot" n
      WHERE n."leadId" = s."leadId" AND n.status = 'done' AND n."createdAt" > s."createdAt"
    )`;
}
