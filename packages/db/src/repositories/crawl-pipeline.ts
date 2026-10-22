import type { PrismaClient, CrawlPipelineSettings as Row } from '@prisma/client';
import type {
  CrawlPipelineCounters,
  CrawlPipelineSettingsPatch,
  CrawlPipelineSettingsRecord,
} from '@moncha/domain';

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

  async getCountersToday(tenantId: string, now = new Date()): Promise<CrawlPipelineCounters> {
    const dayStart = startOfUtcDay(now);

    const [
      crawlsToday,
      sourcesCreatedToday,
      auditsPending,
      auditsQualifiedToday,
      websitesCreatedToday,
      customersReachedToday,
      qualifiedWaitingInQueue,
      followUpsScheduled,
      followUpsDueToday,
    ] = await Promise.all([
      // 1. Crawl job runs started today
      this.db.jobRun.count({
        where: {
          tenantId,
          type: 'country_discovery',
          createdAt: { gte: dayStart },
        },
      }),

      // 2. Raw discovered sources saved today
      this.db.sourceRecord.count({
        where: {
          tenantId,
          createdAt: { gte: dayStart },
        },
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

      // 5. Websites created (snapshots done) today
      this.db.siteSnapshot.count({
        where: {
          tenantId,
          status: 'done',
          createdAt: { gte: dayStart },
        },
      }),

      // 6. Customers reached (cold emails sent) today
      this.db.coldEmail.count({
        where: {
          tenantId,
          status: 'sent',
          sentAt: { gte: dayStart },
        },
      }),

      // 7. Qualified leads waiting in queue without a website copy yet
      this.db.lead.count({
        where: {
          tenantId,
          queue: 'QUALIFIED',
          siteSnapshots: { none: {} },
        },
      }),

      // 8. Total scheduled follow-ups
      this.db.coldEmail.count({
        where: {
          tenantId,
          followUpStatus: 'scheduled',
        },
      }),

      // 9. Follow-ups due right now (followUpDueDate <= now)
      this.db.coldEmail.count({
        where: {
          tenantId,
          followUpStatus: 'scheduled',
          followUpDueDate: { lte: now },
        },
      }),
    ]);

    // Approximate duplicates from discovery target records if available
    const duplicates = Math.max(0, sourcesCreatedToday - auditsQualifiedToday);

    return {
      websitesCrawledToday: sourcesCreatedToday,
      duplicatesFilteredToday: duplicates,
      auditsPendingToday: auditsPending,
      auditsQualifiedToday,
      websitesCreatedToday,
      customersReachedToday,
      qualifiedWaitingInQueue,
      followUpsScheduled,
      followUpsDueToday,
      crawlsRunToday: crawlsToday,
    };
  }
}
