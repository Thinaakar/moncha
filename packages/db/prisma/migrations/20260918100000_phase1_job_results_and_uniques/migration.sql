-- CreateSchema
CREATE TABLE IF NOT EXISTS "Tenant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- AlterTable Website.tenantId and JobRun.resultJson are added in later statements for existing DBs

ALTER TABLE "Website" ADD COLUMN IF NOT EXISTS "tenantId" TEXT;
ALTER TABLE "JobRun" ADD COLUMN IF NOT EXISTS "resultJson" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "Lead_tenantId_companyId_key" ON "Lead"("tenantId", "companyId");
CREATE INDEX IF NOT EXISTS "Company_tenantId_country_idx" ON "Company"("tenantId", "country");
CREATE INDEX IF NOT EXISTS "Company_tenantId_city_idx" ON "Company"("tenantId", "city");
CREATE INDEX IF NOT EXISTS "Company_tenantId_createdAt_idx" ON "Company"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Lead_tenantId_createdAt_idx" ON "Lead"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "JobRun_tenantId_status_idx" ON "JobRun"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "Website_tenantId_idx" ON "Website"("tenantId");
