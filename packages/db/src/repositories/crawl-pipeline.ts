import type { PrismaClient, CrawlPipelineSettings as Row } from '@prisma/client';
import type {
  CrawlMode,
  CrawlPipelineCounters,
  CrawlPipelineSettingsPatch,
  CrawlPipelineSettingsRecord,
  CrawlRunKind,
  CrawlRunUsage,
  JobCreate,
} from '@moncha/domain';
import { CRAWL_MODES, crawlRunClaim, SITE_AUTOMATION_LOOKBACK_MS } from '@moncha/domain';
import { createClaimedCrawlJob, crawlRunUsageToday, type ClaimedCrawlJob } from './crawl-run-usage';

export type {
  CrawlPipelineCounters,
  CrawlPipelineSettingsPatch,
  CrawlPipelineSettingsRecord,
};

function toStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((s) => String(s).trim()).filter(Boolean);
  }
  return [];
}

function mapRow(row: Row): CrawlPipelineSettingsRecord {
  return {
    tenantId: row.tenantId,
    active: row.active,
    crawlBatchSize: row.crawlBatchSize,
    targetCountry: row.targetCountry,
    targetCities: toStringArray(row.targetCities),
    targetIndustries: toStringArray(row.targetIndustries),
    maxPagesPerSearch: row.maxPagesPerSearch,
    dailyWebsiteCreationLimit: row.dailyWebsiteCreationLimit,
    dailyCustomerReachLimit: row.dailyCustomerReachLimit,
    autoRecrawlEnabled: row.autoRecrawlEnabled,
    minQueueBuffer: row.minQueueBuffer,
    maxDailyCrawlRuns: row.maxDailyCrawlRuns,
    crawlMode: CRAWL_MODES.includes(row.crawlMode as CrawlMode) ? (row.crawlMode as CrawlMode) : 'both',
    scheduleReservedRuns: row.scheduleReservedRuns,
    followUpEnabled: row.followUpEnabled,
    followUpDelayDays: row.followUpDelayDays,
    followUpMode: (row.followUpMode as 'business_days' | 'calendar_days') || 'business_days',
    followUpPreferredHour: row.followUpPreferredHour,
    followUpSubject: row.followUpSubject,
    followUpBodyTemplate: row.followUpBodyTemplate,
    lastRecrawlAt: row.lastRecrawlAt,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function defaultSettings(tenantId: string): CrawlPipelineSettingsRecord {
  const now = new Date();
  return {
    tenantId,
    active: false,
    crawlBatchSize: 20,
    targetCountry: 'SG',
    targetCities: [],
    targetIndustries: [],
    maxPagesPerSearch: 3,
    dailyWebsiteCreationLimit: 5,
    dailyCustomerReachLimit: 5,
    autoRecrawlEnabled: true,
    minQueueBuffer: 5,
    maxDailyCrawlRuns: 10,
    crawlMode: 'both',
    scheduleReservedRuns: 0,
    followUpEnabled: true,
    followUpDelayDays: 3,
    followUpMode: 'business_days',
    followUpPreferredHour: 10,
    followUpSubject: null,
    followUpBodyTemplate: null,
    lastRecrawlAt: null,
    updatedBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

/** Sums `found` and `duplicates` over country crawl results; crawls still running have no result yet. */
export function sumCrawlResults(results: unknown[]): { found: number; duplicates: number } {
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  let found = 0;
  let duplicates = 0;
  for (const r of results) {
    if (!r || typeof r !== 'object') continue;
    found += num((r as { found?: unknown }).found);
    duplicates += num((r as { duplicates?: unknown }).duplicates);
  }
  return { found, duplicates };
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export class PrismaCrawlPipelineRepository {
  constructor(private db: PrismaClient) {}

  async get(tenantId: string): Promise<CrawlPipelineSettingsRecord> {
    const row = await this.db.crawlPipelineSettings.findUnique({ where: { tenantId } });
    if (!row) return defaultSettings(tenantId);
    return mapRow(row);
  }

  async save(
    tenantId: string,
    patch: CrawlPipelineSettingsPatch,
    updatedBy?: string | null,
  ): Promise<CrawlPipelineSettingsRecord> {
    const data: Record<string, unknown> = {
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.crawlBatchSize !== undefined ? { crawlBatchSize: patch.crawlBatchSize } : {}),
      ...(patch.targetCountry !== undefined ? { targetCountry: patch.targetCountry } : {}),
      ...(patch.targetCities !== undefined ? { targetCities: patch.targetCities } : {}),
      ...(patch.targetIndustries !== undefined ? { targetIndustries: patch.targetIndustries } : {}),
      ...(patch.maxPagesPerSearch !== undefined ? { maxPagesPerSearch: patch.maxPagesPerSearch } : {}),
      ...(patch.dailyWebsiteCreationLimit !== undefined
        ? { dailyWebsiteCreationLimit: patch.dailyWebsiteCreationLimit }
        : {}),
      ...(patch.dailyCustomerReachLimit !== undefined
        ? { dailyCustomerReachLimit: patch.dailyCustomerReachLimit }
        : {}),
      ...(patch.autoRecrawlEnabled !== undefined ? { autoRecrawlEnabled: patch.autoRecrawlEnabled } : {}),
      ...(patch.minQueueBuffer !== undefined ? { minQueueBuffer: patch.minQueueBuffer } : {}),
      ...(patch.maxDailyCrawlRuns !== undefined ? { maxDailyCrawlRuns: patch.maxDailyCrawlRuns } : {}),
      ...(patch.crawlMode !== undefined ? { crawlMode: patch.crawlMode } : {}),
      ...(patch.scheduleReservedRuns !== undefined ? { scheduleReservedRuns: patch.scheduleReservedRuns } : {}),
      ...(patch.followUpEnabled !== undefined ? { followUpEnabled: patch.followUpEnabled } : {}),
      ...(patch.followUpDelayDays !== undefined ? { followUpDelayDays: patch.followUpDelayDays } : {}),
      ...(patch.followUpMode !== undefined ? { followUpMode: patch.followUpMode } : {}),
      ...(patch.followUpPreferredHour !== undefined ? { followUpPreferredHour: patch.followUpPreferredHour } : {}),
      ...(patch.followUpSubject !== undefined ? { followUpSubject: patch.followUpSubject } : {}),
      ...(patch.followUpBodyTemplate !== undefined ? { followUpBodyTemplate: patch.followUpBodyTemplate } : {}),
      ...(patch.lastRecrawlAt !== undefined ? { lastRecrawlAt: patch.lastRecrawlAt } : {}),
      updatedBy: updatedBy ?? null,
    };

    const row = await this.db.crawlPipelineSettings.upsert({
      where: { tenantId },
      create: {
        ...defaultSettings(tenantId),
        ...data,
      },
      update: data,
    });
    return mapRow(row);
  }

  async listActive(): Promise<CrawlPipelineSettingsRecord[]> {
    const rows = await this.db.crawlPipelineSettings.findMany({ where: { active: true } });
    return rows.map(mapRow);
  }

  async recordRecrawlRun(tenantId: string, at = new Date()): Promise<void> {
    await this.db.crawlPipelineSettings.upsert({
      where: { tenantId },
      create: { ...defaultSettings(tenantId), lastRecrawlAt: at },
      update: { lastRecrawlAt: at },
    });
  }

  /** Country crawls of any trigger created since `since`. */
  countCrawlsSince(tenantId: string, since: Date): Promise<number> {
    return this.db.jobRun.count({ where: { tenantId, type: 'country_discovery', createdAt: { gte: since } } });
  }

  /** Runs claimed today (UTC); before the first claim of the day, the country crawls already created today. */
  runUsageToday(tenantId: string, now = new Date()): Promise<CrawlRunUsage> {
    return crawlRunUsageToday(this.db, tenantId, now);
  }

  /**
   * Claims one of today's runs (Max Daily Crawl Runs; auto-recrawl and manual runs never use the runs reserved for
   * schedules) and creates the country_discovery job in the same transaction. `limited` when no run is left.
   */
  async createCrawlJob(input: {
    job: JobCreate;
    kind: Exclude<CrawlRunKind, 'schedule'>;
    settings?: CrawlPipelineSettingsRecord;
    now?: Date;
  }): Promise<ClaimedCrawlJob> {
    const settings = input.settings ?? (await this.get(input.job.tenantId));
    return createClaimedCrawlJob(this.db, { job: input.job, claim: crawlRunClaim(settings, input.kind), now: input.now });
  }

  async getCountersToday(tenantId: string, now = new Date()): Promise<CrawlPipelineCounters> {
    const dayStart = startOfUtcDay(now);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

    const [
      crawlsToday,
      auditsPending,
      auditsQualifiedToday,
      websitesCreatedToday,
      customersReachedToday,
      qualifiedWaitingInQueue,
      followUpsScheduled,
      followUpsDueToday,
      followUpsOverdue,
      followUpsSentToday,
      runUsage,
    ] = await Promise.all([
      // 1-2. Country crawls started today, with their found / duplicate totals
      this.db.jobRun.findMany({
        where: {
          tenantId,
          type: 'country_discovery',
          createdAt: { gte: dayStart },
        },
        select: { result: true },
      }),

      // 3. Website audits currently in progress / pending
      this.db.jobRun.count({
        where: {
          tenantId,
          type: 'website_audit',
          status: { in: ['pending', 'running'] },
        },
      }),

      // 4. Leads audited and marked qualified today
      this.db.lead.count({
        where: {
          tenantId,
          queue: 'QUALIFIED',
          createdAt: { gte: dayStart },
        },
      }),

      // 5. Automatic website copies queued today (what the daily website creation limit caps)
      this.db.siteSnapshot.count({
        where: {
          tenantId,
          origin: 'auto',
          createdAt: { gte: dayStart },
        },
      }),

      // 6. Automatic cold emails today, drafts included (what the daily customer reach limit caps)
      this.db.coldEmail.count({
        where: {
          tenantId,
          origin: 'auto',
          createdAt: { gte: dayStart },
        },
      }),

      // 7. Qualified leads without a copy that copy automation can still pick up (from recent crawls)
      this.countCopyCandidates(tenantId, new Date(now.getTime() - SITE_AUTOMATION_LOOKBACK_MS)),

      // 8. Total scheduled follow-ups
      this.db.coldEmail.count({
        where: {
          tenantId,
          followUpStatus: 'scheduled',
        },
      }),

      // 9. Follow-ups due before the end of today, overdue ones included
      this.db.coldEmail.count({
        where: {
          tenantId,
          followUpStatus: 'scheduled',
          followUpDueDate: { lt: dayEnd },
        },
      }),

      // 10. Follow-ups whose due time has passed
      this.db.coldEmail.count({
        where: {
          tenantId,
          followUpStatus: 'scheduled',
          followUpDueDate: { lte: now },
        },
      }),

      // 11. Follow-ups sent today
      this.db.coldEmail.count({
        where: {
          tenantId,
          followUpStatus: 'sent',
          followUpSentAt: { gte: dayStart },
        },
      }),

      // 12. Daily runs claimed today (what Max Daily Crawl Runs counts)
      crawlRunUsageToday(this.db, tenantId, now),
    ]);

    const totals = sumCrawlResults(crawlsToday.map((c) => c.result));

    return {
      websitesCrawledToday: totals.found,
      duplicatesFilteredToday: totals.duplicates,
      auditsPendingToday: auditsPending,
      auditsQualifiedToday,
      websitesCreatedToday,
      customersReachedToday,
      qualifiedWaitingInQueue,
      followUpsScheduled,
      followUpsDueToday,
      followUpsOverdue,
      followUpsSentToday,
      crawlsRunToday: runUsage.runs,
      scheduledRunsToday: runUsage.scheduledRuns,
    };
  }

  /** Same pool as the copy sweep's candidates: audited by a country crawl started since `since`. */
  private async countCopyCandidates(tenantId: string, since: Date): Promise<number> {
    const rows = await this.db.$queryRaw<Array<{ n: number }>>`
      SELECT COUNT(DISTINCT l.id)::int AS n
      FROM "Lead" l
      JOIN "JobRun" a ON a."leadId" = l.id AND a."tenantId" = ${tenantId} AND a.type = 'website_audit'
      JOIN "JobRun" c ON c.id = a."crawlJobId" AND c.type = 'country_discovery' AND c."createdAt" >= ${since}
      WHERE l."tenantId" = ${tenantId}
        AND l.queue = 'QUALIFIED'
        AND NOT EXISTS (SELECT 1 FROM "SiteSnapshot" s WHERE s."leadId" = l.id)`;
    return Number(rows[0]?.n ?? 0);
  }
}
