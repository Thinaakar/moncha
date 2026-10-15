-- Website training of each lead's MonCha bot (knowledge/discover, ingest-bulk, training status) before its website is copied.

-- AlterTable
ALTER TABLE "LeadBot" ADD COLUMN "knowledgeStatus" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "LeadBot" ADD COLUMN "knowledgeAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LeadBot" ADD COLUMN "knowledgeNextAt" TIMESTAMP(3);
ALTER TABLE "LeadBot" ADD COLUMN "knowledgeLockedAt" TIMESTAMP(3);
ALTER TABLE "LeadBot" ADD COLUMN "websiteUrl" TEXT;
ALTER TABLE "LeadBot" ADD COLUMN "discoveredUrls" JSONB;
ALTER TABLE "LeadBot" ADD COLUMN "pagesFetched" INTEGER;
ALTER TABLE "LeadBot" ADD COLUMN "discoveryTruncated" BOOLEAN;
ALTER TABLE "LeadBot" ADD COLUMN "discoveredAt" TIMESTAMP(3);
ALTER TABLE "LeadBot" ADD COLUMN "trainingKey" TEXT;
ALTER TABLE "LeadBot" ADD COLUMN "trainingPayload" JSONB;
ALTER TABLE "LeadBot" ADD COLUMN "trainingId" TEXT;
ALTER TABLE "LeadBot" ADD COLUMN "trainingResult" JSONB;
ALTER TABLE "LeadBot" ADD COLUMN "trainingSubmittedAt" TIMESTAMP(3);
ALTER TABLE "LeadBot" ADD COLUMN "trainedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "LeadBot_status_knowledgeStatus_knowledgeNextAt_idx" ON "LeadBot"("status", "knowledgeStatus", "knowledgeNextAt");
