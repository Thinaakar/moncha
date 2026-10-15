-- MonCha demo bot per lead (internal lead API), created before the lead's website is copied.

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN "botStatus" TEXT;
ALTER TABLE "Lead" ADD COLUMN "botCreatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "LeadBot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "siteSnapshotId" TEXT,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "name" TEXT,
    "planTier" TEXT,
    "idempotencyKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "error" TEXT,
    "chatbotId" TEXT,
    "monchaTenantId" TEXT,
    "connectionId" TEXT,
    "config" JSONB,
    "createdBotAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadBot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LeadBot_leadId_key" ON "LeadBot"("leadId");

-- CreateIndex
CREATE INDEX "LeadBot_tenantId_status_idx" ON "LeadBot"("tenantId", "status");

-- CreateIndex
CREATE INDEX "LeadBot_status_nextAt_idx" ON "LeadBot"("status", "nextAt");

-- AddForeignKey
ALTER TABLE "LeadBot" ADD CONSTRAINT "LeadBot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadBot" ADD CONSTRAINT "LeadBot_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
