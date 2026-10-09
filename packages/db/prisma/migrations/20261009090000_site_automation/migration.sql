-- CreateEnum
CREATE TYPE "SiteCopyOrigin" AS ENUM ('manual', 'auto');

-- AlterTable
ALTER TABLE "SiteSnapshot" ADD COLUMN "origin" "SiteCopyOrigin" NOT NULL DEFAULT 'manual';
ALTER TABLE "SiteSnapshot" ADD COLUMN "crawlJobId" TEXT;

-- CreateIndex
CREATE INDEX "SiteSnapshot_tenantId_origin_createdAt_idx" ON "SiteSnapshot"("tenantId", "origin", "createdAt");

-- CreateIndex
CREATE INDEX "SiteSnapshot_crawlJobId_idx" ON "SiteSnapshot"("crawlJobId");

-- CreateTable
CREATE TABLE "SiteAutomationSettings" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "dailyCap" INTEGER NOT NULL DEFAULT 20,
    "enabledAt" TIMESTAMP(3),
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteAutomationSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "SiteAutomationCrawl" (
    "crawlJobId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'waiting_audits',
    "auditsTotal" INTEGER NOT NULL DEFAULT 0,
    "auditsPending" INTEGER NOT NULL DEFAULT 0,
    "qualified" INTEGER NOT NULL DEFAULT 0,
    "queued" INTEGER NOT NULL DEFAULT 0,
    "carriedOver" INTEGER NOT NULL DEFAULT 0,
    "crawlFinishedAt" TIMESTAMP(3) NOT NULL,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAutomationCrawl_pkey" PRIMARY KEY ("crawlJobId")
);

-- CreateIndex
CREATE INDEX "SiteAutomationCrawl_tenantId_status_crawlFinishedAt_idx" ON "SiteAutomationCrawl"("tenantId", "status", "crawlFinishedAt");

-- CreateIndex
CREATE INDEX "SiteAutomationCrawl_tenantId_crawlFinishedAt_idx" ON "SiteAutomationCrawl"("tenantId", "crawlFinishedAt");

-- AddForeignKey
ALTER TABLE "SiteAutomationSettings" ADD CONSTRAINT "SiteAutomationSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteAutomationCrawl" ADD CONSTRAINT "SiteAutomationCrawl_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Website audits started by a country crawl carry payload.crawlJobId; the copy sweep looks them up by it.
CREATE INDEX "JobRun_website_audit_crawlJobId_idx" ON "JobRun" ("tenantId", (payload->>'crawlJobId'))
WHERE type = 'website_audit';
