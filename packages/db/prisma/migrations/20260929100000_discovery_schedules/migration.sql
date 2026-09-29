-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'country_discovery';

-- CreateTable
CREATE TABLE "DiscoverySchedule" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "timeOfDay" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoverySchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoverySchedule_enabled_nextRunAt_idx" ON "DiscoverySchedule"("enabled", "nextRunAt");

-- CreateIndex
CREATE INDEX "DiscoverySchedule_tenantId_countryCode_idx" ON "DiscoverySchedule"("tenantId", "countryCode");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoverySchedule_tenantId_countryCode_timeOfDay_key" ON "DiscoverySchedule"("tenantId", "countryCode", "timeOfDay");

-- AddForeignKey
ALTER TABLE "DiscoverySchedule" ADD CONSTRAINT "DiscoverySchedule_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
