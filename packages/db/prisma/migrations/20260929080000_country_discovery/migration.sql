-- CreateEnum
CREATE TYPE "DiscoveryTargetStatus" AS ENUM ('pending', 'done', 'failed');

-- CreateTable
CREATE TABLE "DiscoveryTarget" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "status" "DiscoveryTargetStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "found" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveryTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveryUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "DiscoveryUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DiscoveryTarget_tenantId_source_countryCode_status_rank_idx" ON "DiscoveryTarget"("tenantId", "source", "countryCode", "status", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryTarget_tenantId_source_countryCode_city_keyword_key" ON "DiscoveryTarget"("tenantId", "source", "countryCode", "city", "keyword");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveryUsage_tenantId_source_day_key" ON "DiscoveryUsage"("tenantId", "source", "day");

-- AddForeignKey
ALTER TABLE "DiscoveryTarget" ADD CONSTRAINT "DiscoveryTarget_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveryUsage" ADD CONSTRAINT "DiscoveryUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
