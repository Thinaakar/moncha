-- JobRun.leadId, crawlJobId and auditId: real columns for links that so far lived only in
-- payload.leadId, payload.crawlJobId and result.auditId. The JSON keys are still written.
-- The backfill is idempotent (only NULL columns, only targets that exist in the same tenant), so it
-- can be run again for jobs created by a worker that does not write the columns yet.

-- AlterTable
ALTER TABLE "JobRun" ADD COLUMN     "auditId" TEXT,
ADD COLUMN     "crawlJobId" TEXT,
ADD COLUMN     "leadId" TEXT;

-- CreateIndex
CREATE INDEX "JobRun_tenantId_leadId_type_status_idx" ON "JobRun"("tenantId", "leadId", "type", "status");

-- CreateIndex
CREATE INDEX "JobRun_tenantId_crawlJobId_idx" ON "JobRun"("tenantId", "crawlJobId");

-- CreateIndex
CREATE INDEX "JobRun_auditId_idx" ON "JobRun"("auditId");

-- Backfill
UPDATE "JobRun" j SET "leadId" = j.payload->>'leadId'
WHERE j."leadId" IS NULL
  AND j.payload->>'leadId' IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Lead" l WHERE l.id = j.payload->>'leadId' AND l."tenantId" = j."tenantId");

UPDATE "JobRun" j SET "crawlJobId" = j.payload->>'crawlJobId'
WHERE j."crawlJobId" IS NULL
  AND j.payload->>'crawlJobId' IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM "JobRun" c
    WHERE c.id = j.payload->>'crawlJobId' AND c."tenantId" = j."tenantId" AND c.type = 'country_discovery'
  );

UPDATE "JobRun" j SET "auditId" = j.result->>'auditId'
WHERE j."auditId" IS NULL
  AND j.type = 'website_audit'
  AND j.result->>'auditId' IS NOT NULL
  AND EXISTS (SELECT 1 FROM "WebsiteAudit" a WHERE a.id = j.result->>'auditId' AND a."tenantId" = j."tenantId");

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- ValidateForeignKey
ALTER TABLE "JobRun" VALIDATE CONSTRAINT "JobRun_leadId_fkey";
ALTER TABLE "JobRun" VALIDATE CONSTRAINT "JobRun_crawlJobId_fkey";
ALTER TABLE "JobRun" VALIDATE CONSTRAINT "JobRun_auditId_fkey";
