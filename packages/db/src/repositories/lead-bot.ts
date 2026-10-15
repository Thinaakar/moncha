import { Prisma, type LeadBot, type PrismaClient } from '@prisma/client';
import type {
  BotPlanTier,
  KnowledgeDocument,
  LeadBotItem,
  LeadBotKnowledgeStatus,
  LeadBotListQuery,
  LeadBotPatch,
  LeadBotRepo,
  LeadBotStatus,
} from '@moncha/domain';
import { clampPage, clampPageSize } from '@moncha/domain';

const companySelect = {
  lead: {
    select: {
      company: { select: { id: true, name: true, domain: true, website: { select: { url: true, finalUrl: true } } } },
    },
  },
} as const;

type RowWithCompany = LeadBot & {
  lead: {
    company: { id: string; name: string; domain: string | null; website: { url: string; finalUrl: string | null } | null };
  };
};

const STATUSES: LeadBotStatus[] = ['pending', 'creating', 'created', 'failed'];
const KNOWLEDGE_STATUSES: LeadBotKnowledgeStatus[] = ['pending', 'discovering', 'training', 'trained', 'failed'];

function websiteUrl(company: RowWithCompany['lead']['company']): string | null {
  const url = company.website?.finalUrl || company.website?.url || (company.domain ? `https://${company.domain}/` : null);
  return url && /^https?:\/\//i.test(url) ? url : url ? `https://${url}` : null;
}

function json(value: unknown) {
  return value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue);
}

function mapBot(row: RowWithCompany): LeadBotItem {
  const { lead, ...bot } = row;
  const { website: _website, ...company } = lead.company;
  return {
    id: bot.id,
    tenantId: bot.tenantId,
    leadId: bot.leadId,
    siteSnapshotId: bot.siteSnapshotId,
    environment: bot.environment,
    status: bot.status as LeadBotStatus,
    name: bot.name,
    planTier: (bot.planTier as BotPlanTier | null) ?? null,
    idempotencyKey: bot.idempotencyKey,
    attempts: bot.attempts,
    nextAt: bot.nextAt,
    lockedAt: bot.lockedAt,
    error: bot.error,
    chatbotId: bot.chatbotId,
    monchaTenantId: bot.monchaTenantId,
    connectionId: bot.connectionId,
    config: bot.config ?? null,
    createdBotAt: bot.createdBotAt,
    knowledgeStatus: bot.knowledgeStatus as LeadBotKnowledgeStatus,
    knowledgeAttempts: bot.knowledgeAttempts,
    knowledgeNextAt: bot.knowledgeNextAt,
    knowledgeLockedAt: bot.knowledgeLockedAt,
    websiteUrl: bot.websiteUrl,
    discoveredUrls: Array.isArray(bot.discoveredUrls) ? (bot.discoveredUrls as string[]) : null,
    pagesFetched: bot.pagesFetched,
    discoveryTruncated: bot.discoveryTruncated,
    discoveredAt: bot.discoveredAt,
    trainingKey: bot.trainingKey,
    trainingPayload: (bot.trainingPayload as { documents: KnowledgeDocument[] } | null) ?? null,
    trainingId: bot.trainingId,
    trainingResult: bot.trainingResult ?? null,
    trainingSubmittedAt: bot.trainingSubmittedAt,
    trainedAt: bot.trainedAt,
    widgetPrimaryColor: bot.widgetPrimaryColor,
    widgetConfigBefore: bot.widgetConfigBefore ?? null,
    widgetConfig: bot.widgetConfig ?? null,
    installValues: bot.installValues ?? null,
    widgetConfiguredAt: bot.widgetConfiguredAt,
    createdAt: bot.createdAt,
    updatedAt: bot.updatedAt,
    company: { ...company, websiteUrl: websiteUrl(lead.company) },
  };
}

/** A copy that has not started: pending, never tried, its job still pending. */
const WAITING_COPY = Prisma.sql`s.status = 'pending' AND s.attempts = 0 AND j.status = 'pending'`;

export class PrismaLeadBotRepository implements LeadBotRepo {
  constructor(private db: PrismaClient) {}

  async queueForWaitingCopies(environment: string): Promise<number> {
    return this.db.$executeRaw`
      WITH waiting AS (
        SELECT DISTINCT ON (s."leadId") s."leadId", s."tenantId", s.id AS "snapshotId"
        FROM "SiteSnapshot" s
        JOIN "JobRun" j ON j.id = s."jobId"
        WHERE ${WAITING_COPY}
          AND NOT EXISTS (SELECT 1 FROM "LeadBot" b WHERE b."leadId" = s."leadId")
        ORDER BY s."leadId", s."createdAt"
      ), inserted AS (
        INSERT INTO "LeadBot" (id, "tenantId", "leadId", "siteSnapshotId", environment, status, "createdAt", "updatedAt")
        SELECT gen_random_uuid()::text, w."tenantId", w."leadId", w."snapshotId", ${environment}, 'pending', NOW(), NOW()
        FROM waiting w
        ON CONFLICT ("leadId") DO NOTHING
        RETURNING "leadId"
      )
      UPDATE "Lead" SET "botStatus" = 'pending' WHERE id IN (SELECT "leadId" FROM inserted)`;
  }

  async queueForLiveWebsites(environment: string, options: { tenantId?: string; dryRun?: boolean } = {}): Promise<number> {
    const tenant = options.tenantId ? Prisma.sql`AND s."tenantId" = ${options.tenantId}` : Prisma.empty;
    const live = Prisma.sql`
      SELECT DISTINCT ON (s."leadId") s."leadId", s."tenantId", s.id AS "snapshotId"
      FROM "SiteSnapshot" s
      WHERE s."workerStatus" = 'deployed' ${tenant}
        AND NOT EXISTS (SELECT 1 FROM "LeadBot" b WHERE b."leadId" = s."leadId")
      ORDER BY s."leadId", s."workerDeployedAt" DESC NULLS LAST`;
    if (options.dryRun) {
      const rows = await this.db.$queryRaw<Array<{ n: number }>>`SELECT COUNT(*)::int AS n FROM (${live}) live`;
      return rows[0]?.n ?? 0;
    }
    return this.db.$executeRaw`
      WITH live AS (${live}), inserted AS (
        INSERT INTO "LeadBot" (id, "tenantId", "leadId", "siteSnapshotId", environment, status, "createdAt", "updatedAt")
        SELECT gen_random_uuid()::text, l."tenantId", l."leadId", l."snapshotId", ${environment}, 'pending', NOW(), NOW()
        FROM live l
        ON CONFLICT ("leadId") DO NOTHING
        RETURNING "leadId"
      )
      UPDATE "Lead" SET "botStatus" = 'pending' WHERE id IN (SELECT "leadId" FROM inserted)`;
  }

  async ensure(input: { tenantId: string; leadId: string; environment: string }): Promise<LeadBotItem> {
    const existing = await this.getForLead(input.tenantId, input.leadId);
    if (existing) return existing;
    try {
      await this.db.$transaction([
        this.db.leadBot.create({ data: { tenantId: input.tenantId, leadId: input.leadId, environment: input.environment } }),
        this.db.lead.updateMany({ where: { id: input.leadId, tenantId: input.tenantId }, data: { botStatus: 'pending' } }),
      ]);
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    }
    const bot = await this.getForLead(input.tenantId, input.leadId);
    if (!bot) throw new Error('lead_bot_missing');
    return bot;
  }

  async claimNext(now: Date, staleBefore: Date, options: { tenantId?: string; leadId?: string } = {}): Promise<LeadBotItem | null> {
    const tenant = options.tenantId ? Prisma.sql`AND x."tenantId" = ${options.tenantId}` : Prisma.empty;
    const due = options.leadId
      ? Prisma.sql`x."leadId" = ${options.leadId} AND (x.status = 'pending' OR (x.status = 'creating' AND x."lockedAt" < ${staleBefore}))`
      : Prisma.sql`((x.status = 'pending' AND (x."nextAt" IS NULL OR x."nextAt" <= ${now}))
          OR (x.status = 'creating' AND x."lockedAt" < ${staleBefore}))`;
    const rows = await this.db.$queryRaw<Array<{ id: string; tenantId: string; leadId: string }>>`
      UPDATE "LeadBot" AS b
      SET status = 'creating', attempts = b.attempts + 1, "lockedAt" = ${now}, "updatedAt" = ${now}
      WHERE b.id = (
        SELECT x.id FROM "LeadBot" x
        WHERE ${due} ${tenant}
        ORDER BY EXISTS (
          SELECT 1 FROM "SiteSnapshot" s JOIN "JobRun" j ON j.id = s."jobId" WHERE s."leadId" = x."leadId" AND ${WAITING_COPY}
        ) DESC, x."createdAt" ASC, x.id
        FOR UPDATE OF x SKIP LOCKED
        LIMIT 1
      )
      RETURNING b.id, b."tenantId", b."leadId"`;
    const claimed = rows[0];
    if (!claimed) return null;
    await this.db.lead.updateMany({ where: { id: claimed.leadId }, data: { botStatus: 'creating' } });
    const row = await this.db.leadBot.findUnique({ where: { id: claimed.id }, include: companySelect });
    return row ? mapBot(row) : null;
  }

  async claimNextKnowledge(
    now: Date,
    staleBefore: Date,
    options: { tenantId?: string; leadId?: string } = {},
  ): Promise<LeadBotItem | null> {
    const tenant = options.tenantId ? Prisma.sql`AND x."tenantId" = ${options.tenantId}` : Prisma.empty;
    const unlocked = Prisma.sql`(x."knowledgeLockedAt" IS NULL OR x."knowledgeLockedAt" < ${staleBefore})`;
    const dueAt = options.leadId ? Prisma.sql`TRUE` : Prisma.sql`(x."knowledgeNextAt" IS NULL OR x."knowledgeNextAt" <= ${now})`;
    const lead = options.leadId ? Prisma.sql`AND x."leadId" = ${options.leadId}` : Prisma.empty;
    const rows = await this.db.$queryRaw<Array<{ id: string }>>`
      UPDATE "LeadBot" AS b
      SET "knowledgeStatus" = CASE WHEN b."knowledgeStatus" = 'training' THEN 'training' ELSE 'discovering' END,
          "knowledgeAttempts" = CASE WHEN b."knowledgeStatus" = 'training' THEN b."knowledgeAttempts" ELSE b."knowledgeAttempts" + 1 END,
          "knowledgeLockedAt" = ${now},
          "updatedAt" = ${now}
      WHERE b.id = (
        SELECT x.id FROM "LeadBot" x
        WHERE x.status = 'created' AND x."chatbotId" IS NOT NULL ${lead} ${tenant}
          AND ((x."knowledgeStatus" = 'pending' AND ${dueAt})
            OR (x."knowledgeStatus" = 'discovering' AND x."knowledgeLockedAt" < ${staleBefore})
            OR (x."knowledgeStatus" = 'training' AND ${dueAt} AND ${unlocked}))
        ORDER BY EXISTS (
          SELECT 1 FROM "SiteSnapshot" s JOIN "JobRun" j ON j.id = s."jobId" WHERE s."leadId" = x."leadId" AND ${WAITING_COPY}
        ) DESC, (x."knowledgeStatus" = 'training') DESC, x."createdBotAt" ASC NULLS LAST, x.id
        FOR UPDATE OF x SKIP LOCKED
        LIMIT 1
      )
      RETURNING b.id`;
    const claimed = rows[0];
    if (!claimed) return null;
    const row = await this.db.leadBot.findUnique({ where: { id: claimed.id }, include: companySelect });
    return row ? mapBot(row) : null;
  }

  async update(tenantId: string, id: string, patch: LeadBotPatch): Promise<LeadBotItem | null> {
    const { config, discoveredUrls, trainingPayload, trainingResult, widgetConfigBefore, widgetConfig, installValues, ...rest } = patch;
    const row = await this.db.$transaction(async (tx) => {
      const { count } = await tx.leadBot.updateMany({
        where: { id, tenantId },
        data: {
          ...rest,
          ...(config !== undefined ? { config: json(config) } : {}),
          ...(discoveredUrls !== undefined ? { discoveredUrls: json(discoveredUrls) } : {}),
          ...(trainingPayload !== undefined ? { trainingPayload: json(trainingPayload) } : {}),
          ...(trainingResult !== undefined ? { trainingResult: json(trainingResult) } : {}),
          ...(widgetConfigBefore !== undefined ? { widgetConfigBefore: json(widgetConfigBefore) } : {}),
          ...(widgetConfig !== undefined ? { widgetConfig: json(widgetConfig) } : {}),
          ...(installValues !== undefined ? { installValues: json(installValues) } : {}),
        },
      });
      if (!count) return null;
      const bot = await tx.leadBot.findUnique({ where: { id }, include: companySelect });
      if (bot && patch.status) {
        await tx.lead.updateMany({
          where: { id: bot.leadId, tenantId },
          data: {
            botStatus: patch.status,
            ...(patch.status === 'created' ? { botCreatedAt: bot.createdBotAt ?? new Date() } : {}),
          },
        });
      }
      return bot;
    });
    return row ? mapBot(row) : null;
  }

  async getForLead(tenantId: string, leadId: string): Promise<LeadBotItem | null> {
    const row = await this.db.leadBot.findFirst({ where: { tenantId, leadId }, include: companySelect });
    return row ? mapBot(row) : null;
  }

  async list(tenantId: string, query: LeadBotListQuery) {
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);
    const where: Prisma.LeadBotWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.knowledgeStatus ? { knowledgeStatus: query.knowledgeStatus } : {}),
    };
    const [rows, total, grouped, groupedKnowledge] = await Promise.all([
      this.db.leadBot.findMany({
        where,
        include: companySelect,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.leadBot.count({ where }),
      this.db.leadBot.groupBy({ by: ['status'], where: { tenantId }, _count: { _all: true } }),
      this.db.leadBot.groupBy({ by: ['knowledgeStatus'], where: { tenantId, status: 'created' }, _count: { _all: true } }),
    ]);
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<LeadBotStatus, number>;
    for (const g of grouped) if ((STATUSES as string[]).includes(g.status)) counts[g.status as LeadBotStatus] = g._count._all;
    const knowledgeCounts = Object.fromEntries(KNOWLEDGE_STATUSES.map((s) => [s, 0])) as Record<LeadBotKnowledgeStatus, number>;
    for (const g of groupedKnowledge) {
      if ((KNOWLEDGE_STATUSES as string[]).includes(g.knowledgeStatus)) knowledgeCounts[g.knowledgeStatus as LeadBotKnowledgeStatus] = g._count._all;
    }
    return {
      items: rows.map(mapBot),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
      counts,
      knowledgeCounts,
    };
  }

  async nameTaken(tenantId: string, environment: string, name: string, exceptLeadId: string): Promise<boolean> {
    const found = await this.db.leadBot.findFirst({
      where: { tenantId, environment, name, leadId: { not: exceptLeadId } },
      select: { id: true },
    });
    return Boolean(found);
  }

  async failWaitingCopies(tenantId: string, leadId: string, error: string, at: Date): Promise<number> {
    return this.failCopies(Prisma.sql`s."tenantId" = ${tenantId} AND s."leadId" = ${leadId}`, Prisma.sql`${error}`, at);
  }

  async failCopiesOfFailedBots(at: Date): Promise<number> {
    return this.failCopies(
      Prisma.sql`EXISTS (SELECT 1 FROM "LeadBot" b WHERE b."leadId" = s."leadId" AND (b.status = 'failed' OR b."knowledgeStatus" = 'failed'))`,
      Prisma.sql`(SELECT CASE WHEN b.status = 'failed' THEN 'Bot creation failed: ' ELSE 'Bot training failed: ' END
        || COALESCE(b.error, 'unknown error') FROM "LeadBot" b WHERE b."leadId" = s."leadId")`,
      at,
    );
  }

  /** Waiting copies matching `where` (alias s, job alias j) and their jobs become failed with reason bot_failed. */
  private async failCopies(where: Prisma.Sql, error: Prisma.Sql, at: Date): Promise<number> {
    return this.db.$transaction(async (tx) => {
      const failed = await tx.$queryRaw<Array<{ id: string; error: string }>>`
        UPDATE "JobRun" AS j
        SET status = 'failed', "lastError" = ${error}, "finishedAt" = ${at}, "lockedAt" = NULL, "lockedBy" = NULL
        FROM "SiteSnapshot" s
        WHERE s."jobId" = j.id AND ${WAITING_COPY} AND ${where}
        RETURNING s.id, j."lastError" AS error`;
      for (const copy of failed) {
        await tx.siteSnapshot.update({
          where: { id: copy.id },
          data: { status: 'failed', failureReason: 'bot_failed', failureDetail: copy.error, finishedAt: at },
        });
      }
      return failed.length;
    });
  }
}
