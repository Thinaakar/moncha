-- AlterEnum
ALTER TYPE "JobType" ADD VALUE IF NOT EXISTS 'site_snapshot';

-- CreateTable
CREATE TABLE "SiteSnapshot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "jobId" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "sourceUrl" TEXT NOT NULL,
    "finalUrl" TEXT,
    "httpStatus" INTEGER,
    "storagePrefix" TEXT NOT NULL,
    "sourceHash" TEXT,
    "sourceBytes" INTEGER,
    "sourceCharset" TEXT,
    "assetCount" INTEGER NOT NULL DEFAULT 0,
    "skippedAssetCount" INTEGER NOT NULL DEFAULT 0,
    "totalBytes" INTEGER NOT NULL DEFAULT 0,
    "brand" JSONB,
    "llmModel" TEXT,
    "llmPromptTokens" INTEGER,
    "llmCompletionTokens" INTEGER,
    "warnings" JSONB,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "SiteSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteSnapshot_jobId_key" ON "SiteSnapshot"("jobId");

-- CreateIndex
CREATE INDEX "SiteSnapshot_tenantId_leadId_createdAt_idx" ON "SiteSnapshot"("tenantId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "SiteSnapshot_tenantId_createdAt_idx" ON "SiteSnapshot"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "SiteSnapshot_tenantId_status_idx" ON "SiteSnapshot"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "SiteSnapshot" ADD CONSTRAINT "SiteSnapshot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteSnapshot" ADD CONSTRAINT "SiteSnapshot_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
