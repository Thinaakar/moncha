-- MonCha chatbot on each website: widget colour (PUT widget) and install values (GET install) on the lead's bot, and
-- the step that adds the embed to index.html before the GitHub push on the website copy.

-- AlterTable
ALTER TABLE "SiteSnapshot" ADD COLUMN "chatbotStatus" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN "chatbotAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SiteSnapshot" ADD COLUMN "chatbotNextAt" TIMESTAMP(3);
ALTER TABLE "SiteSnapshot" ADD COLUMN "chatbotLockedAt" TIMESTAMP(3);
ALTER TABLE "SiteSnapshot" ADD COLUMN "chatbotError" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN "chatbotInstalledAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "LeadBot" ADD COLUMN "widgetPrimaryColor" TEXT;
ALTER TABLE "LeadBot" ADD COLUMN "widgetConfigBefore" JSONB;
ALTER TABLE "LeadBot" ADD COLUMN "widgetConfig" JSONB;
ALTER TABLE "LeadBot" ADD COLUMN "installValues" JSONB;
ALTER TABLE "LeadBot" ADD COLUMN "widgetConfiguredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SiteSnapshot_chatbotStatus_chatbotNextAt_idx" ON "SiteSnapshot"("chatbotStatus", "chatbotNextAt");
