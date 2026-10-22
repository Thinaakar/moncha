-- AlterTable ColdEmail: add follow-up email tracking columns
ALTER TABLE "ColdEmail" ADD COLUMN IF NOT EXISTS "followUpDueDate" TIMESTAMP(3);
ALTER TABLE "ColdEmail" ADD COLUMN IF NOT EXISTS "followUpStatus" TEXT DEFAULT 'none';
ALTER TABLE "ColdEmail" ADD COLUMN IF NOT EXISTS "followUpSentAt" TIMESTAMP(3);
ALTER TABLE "ColdEmail" ADD COLUMN IF NOT EXISTS "followUpResendId" TEXT;
ALTER TABLE "ColdEmail" ADD COLUMN IF NOT EXISTS "followUpError" TEXT;

-- CreateIndex for follow-up scheduling queries
CREATE INDEX IF NOT EXISTS "ColdEmail_tenantId_followUpStatus_followUpDueDate_idx" 
ON "ColdEmail"("tenantId", "followUpStatus", "followUpDueDate");

-- CreateTable CrawlPipelineSettings
CREATE TABLE IF NOT EXISTS "CrawlPipelineSettings" (
    "tenantId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "crawlBatchSize" INTEGER NOT NULL DEFAULT 20,
    "targetCountry" TEXT NOT NULL DEFAULT 'SG',
    "targetCities" JSONB,
    "targetIndustries" JSONB,
    "maxPagesPerSearch" INTEGER NOT NULL DEFAULT 3,
    "dailyWebsiteCreationLimit" INTEGER NOT NULL DEFAULT 5,
    "dailyCustomerReachLimit" INTEGER NOT NULL DEFAULT 5,
    "autoRecrawlEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minQueueBuffer" INTEGER NOT NULL DEFAULT 5,
    "maxDailyCrawlRuns" INTEGER NOT NULL DEFAULT 10,
    "followUpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "followUpDelayDays" INTEGER NOT NULL DEFAULT 3,
    "followUpMode" TEXT NOT NULL DEFAULT 'business_days',
    "followUpPreferredHour" INTEGER NOT NULL DEFAULT 10,
    "followUpSubject" TEXT,
    "followUpBodyTemplate" TEXT,
    "lastRecrawlAt" TIMESTAMP(3),
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrawlPipelineSettings_pkey" PRIMARY KEY ("tenantId")
);

-- Foreign key to Tenant
DO $$ BEGIN
  ALTER TABLE "CrawlPipelineSettings" ADD CONSTRAINT "CrawlPipelineSettings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
