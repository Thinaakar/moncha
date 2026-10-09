import type { PrismaClient, SiteAutomationCrawl, SiteAutomationSettings } from '@prisma/client';
import type {
  JobStatus,
  SiteAutomationCandidate,
  SiteAutomationCrawlListItem,
  SiteAutomationCrawlPatch,
  SiteAutomationCrawlRecord,
  SiteAutomationCrawlStatus,
  SiteAutomationRepo,
  SiteAutomationSettingsRecord,
} from '@moncha/domain';
import { SITE_AUTOMATION_DEFAULT_CAP } from '@moncha/domain';

function mapSettings(row: SiteAutomationSettings): SiteAutomationSettingsRecord {
  return {
    tenantId: row.tenantId,
    enabled: row.enabled,
    dailyCap: row.dailyCap,
    enabledAt: row.enabledAt,
    updatedBy: row.updatedBy,
    updatedAt: row.updatedAt,
  };
}

const CRAWL_STATUSES: SiteAutomationCrawlStatus[] = ['waiting_audits', 'queuing', 'complete'];

function mapCrawl(row: SiteAutomationCrawl): SiteAutomationCrawlRecord {
  return {
    crawlJobId: row.crawlJobId,
    tenantId: row.tenantId,
    status: CRAWL_STATUSES.includes(row.status as SiteAutomationCrawlStatus)
      ? (row.status as SiteAutomationCrawlStatus)
      : 'waiting_audits',
    auditsTotal: row.auditsTotal,
    auditsPending: row.auditsPending,
    qualified: row.qualified,
    queued: row.queued,
    carriedOver: row.carriedOver,
    crawlFinishedAt: row.crawlFinishedAt,
    lastCheckedAt: row.lastCheckedAt,
    completedAt: row.completedAt,
  };
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

export class PrismaSiteAutomationRepository implements SiteAutomationRepo {
  constructor(private db: PrismaClient) {}

  async getSettings(tenantId: string): Promise<SiteAutomationSettingsRecord> {
    const row = await this.db.siteAutomationSettings.findUnique({ where: { tenantId } });
    return row
      ? mapSettings(row)
      : { tenantId, enabled: false, dailyCap: SITE_AUTOMATION_DEFAULT_CAP, enabledAt: null, updatedBy: null, updatedAt: null };
  }

  async saveSettings(
    tenantId: string,
    patch: { enabled?: boolean; dailyCap?: number; updatedBy?: string | null },
    at: Date,
  ): Promise<SiteAutomationSettingsRecord> {
    const existing = await this.db.siteAutomationSettings.findUnique({ where: { tenantId } });
    const turningOn = patch.enabled === true && !existing?.enabled;
    const data = {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.dailyCap !== undefined ? { dailyCap: patch.dailyCap } : {}),
      ...(turningOn ? { enabledAt: at } : {}),
      updatedBy: patch.updatedBy ?? null,
    };
    const row = await this.db.siteAutomationSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return mapSettings(row);
  }

  async listEnabled(): Promise<SiteAutomationSettingsRecord[]> {
    const rows = await this.db.siteAutomationSettings.findMany({ where: { enabled: true } });
    return rows.map(mapSettings);
  }

  async trackFinishedCrawls(tenantId: string, since: Date): Promise<number> {
    return this.db.$executeRaw`
      INSERT INTO "SiteAutomationCrawl" ("crawlJobId", "tenantId", "crawlFinishedAt")
      SELECT j.id, j."tenantId", j."finishedAt"
      FROM "JobRun" j
      WHERE j."tenantId" = ${tenantId}
        AND j.type = 'country_discovery'
        AND j.status IN ('done', 'failed')
        AND j."finishedAt" >= ${since}
      ON CONFLICT ("crawlJobId") DO NOTHING`;
  }

  async listOpenCrawls(tenantId: string): Promise<SiteAutomationCrawlRecord[]> {
    const rows = await this.db.siteAutomationCrawl.findMany({
      where: { tenantId, status: { not: 'complete' } },
      orderBy: [{ crawlFinishedAt: 'asc' }, { crawlJobId: 'asc' }],
      take: 200,
    });
    return rows.map(mapCrawl);
  }

  async updateCrawl(crawlJobId: string, patch: SiteAutomationCrawlPatch): Promise<void> {
    await this.db.siteAutomationCrawl.update({ where: { crawlJobId }, data: patch });
  }

  async auditCounts(tenantId: string, crawlJobId: string): Promise<{ total: number; pending: number }> {
    const rows = await this.db.$queryRaw<Array<{ total: number; pending: number }>>`
      SELECT COUNT(*)::int AS total,
             (COUNT(*) FILTER (WHERE status IN ('pending', 'running')))::int AS pending
      FROM "JobRun"
      WHERE "tenantId" = ${tenantId} AND type = 'website_audit' AND payload->>'crawlJobId' = ${crawlJobId}`;
    return { total: num(rows[0]?.total), pending: num(rows[0]?.pending) };
  }

  async candidates(tenantId: string, crawlJobId: string): Promise<SiteAutomationCandidate[]> {
    return this.db.$queryRaw<SiteAutomationCandidate[]>`
      SELECT l.id AS "leadId", w.url AS "websiteUrl", w."finalUrl" AS "websiteFinalUrl", c.domain AS "domain"
      FROM "Lead" l
      JOIN "Company" c ON c.id = l."companyId"
      LEFT JOIN "Website" w ON w."companyId" = c.id
      WHERE l."tenantId" = ${tenantId}
        AND l.queue = 'QUALIFIED'
        AND l.id IN (
          SELECT j.payload->>'leadId' FROM "JobRun" j
          WHERE j."tenantId" = ${tenantId} AND j.type = 'website_audit' AND j.payload->>'crawlJobId' = ${crawlJobId}
        )
        AND NOT EXISTS (SELECT 1 FROM "SiteSnapshot" s WHERE s."leadId" = l.id)
      ORDER BY l."createdAt" ASC, l.id ASC
      LIMIT 1000`;
  }

  async countAutoSince(tenantId: string, since: Date): Promise<number> {
    return this.db.siteSnapshot.count({ where: { tenantId, origin: 'auto', createdAt: { gte: since } } });
  }

  async getCrawls(tenantId: string, crawlJobIds: string[]): Promise<SiteAutomationCrawlRecord[]> {
    if (crawlJobIds.length === 0) return [];
    const rows = await this.db.siteAutomationCrawl.findMany({ where: { tenantId, crawlJobId: { in: crawlJobIds } } });
    return rows.map(mapCrawl);
  }

  async listCrawls(tenantId: string, limit: number): Promise<SiteAutomationCrawlListItem[]> {
    const rows = await this.db.siteAutomationCrawl.findMany({
      where: { tenantId },
      orderBy: [{ crawlFinishedAt: 'desc' }, { crawlJobId: 'desc' }],
      take: Math.min(200, Math.max(1, limit)),
    });
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.crawlJobId);
    const [jobs, copies] = await Promise.all([
      this.db.jobRun.findMany({
        where: { tenantId, id: { in: ids } },
        select: { id: true, status: true, payload: true, result: true },
      }),
      this.db.siteSnapshot.groupBy({
        by: ['crawlJobId', 'status'],
        where: { tenantId, crawlJobId: { in: ids } },
        _count: { _all: true },
      }),
    ]);
    const jobById = new Map(jobs.map((j) => [j.id, j]));
    const copyCounts = new Map<string, Record<JobStatus, number>>();
    for (const c of copies) {
      if (!c.crawlJobId) continue;
      const counts = copyCounts.get(c.crawlJobId) ?? { pending: 0, running: 0, done: 0, failed: 0 };
      counts[c.status] += c._count._all;
      copyCounts.set(c.crawlJobId, counts);
    }
    return rows.map((row) => {
      const job = jobById.get(row.crawlJobId);
      const payload = (job?.payload ?? {}) as { country?: string; countryCode?: string; origin?: string };
      const result = (job?.result ?? {}) as { country?: string; countryCode?: string; created?: number; auditsEnqueued?: number };
      return {
        ...mapCrawl(row),
        country: result.country ?? payload.country ?? null,
        countryCode: result.countryCode ?? payload.countryCode ?? null,
        trigger: payload.origin === 'schedule' ? 'schedule' : 'manual',
        crawlStatus: job?.status ?? 'done',
        leadsCreated: num(result.created),
        auditsEnqueued: num(result.auditsEnqueued),
        copies: copyCounts.get(row.crawlJobId) ?? { pending: 0, running: 0, done: 0, failed: 0 },
      };
    });
  }
}
