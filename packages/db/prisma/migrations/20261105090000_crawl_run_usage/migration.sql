-- Crawl mode and runs reserved for schedules (defaults keep today's behaviour).
ALTER TABLE "CrawlPipelineSettings" ADD COLUMN IF NOT EXISTS "crawlMode" TEXT NOT NULL DEFAULT 'both';
ALTER TABLE "CrawlPipelineSettings" ADD COLUMN IF NOT EXISTS "scheduleReservedRuns" INTEGER NOT NULL DEFAULT 0;

-- Daily country crawl runs per tenant (UTC day). Rows are created by the first claim of a day.
CREATE TABLE IF NOT EXISTS "CrawlRunUsage" (
    "tenantId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "runs" INTEGER NOT NULL DEFAULT 0,
    "scheduledRuns" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlRunUsage_pkey" PRIMARY KEY ("tenantId", "day")
);

DO $$ BEGIN
  ALTER TABLE "CrawlRunUsage" ADD CONSTRAINT "CrawlRunUsage_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Schedule slots that were skipped instead of run.
CREATE TABLE IF NOT EXISTS "ScheduleRunSkip" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "scheduleId" TEXT,
    "countryCode" TEXT NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleRunSkip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ScheduleRunSkip_scheduleId_scheduledFor_key" ON "ScheduleRunSkip"("scheduleId", "scheduledFor");
CREATE INDEX IF NOT EXISTS "ScheduleRunSkip_tenantId_createdAt_idx" ON "ScheduleRunSkip"("tenantId", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ScheduleRunSkip" ADD CONSTRAINT "ScheduleRunSkip_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ScheduleRunSkip" ADD CONSTRAINT "ScheduleRunSkip_scheduleId_fkey"
    FOREIGN KEY ("scheduleId") REFERENCES "DiscoverySchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
