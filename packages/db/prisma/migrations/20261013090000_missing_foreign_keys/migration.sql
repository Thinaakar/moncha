-- Foreign keys for id columns that had no constraint. Added NOT VALID first so the table lock is brief,
-- then validated against existing rows (all five were checked for orphans before this migration).

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_latestAuditId_fkey" FOREIGN KEY ("latestAuditId") REFERENCES "WebsiteAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_latestAuditId_fkey" FOREIGN KEY ("latestAuditId") REFERENCES "WebsiteAudit"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "SiteSnapshot" ADD CONSTRAINT "SiteSnapshot_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "SiteSnapshot" ADD CONSTRAINT "SiteSnapshot_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "JobRun"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;

-- AddForeignKey
ALTER TABLE "SiteAutomationCrawl" ADD CONSTRAINT "SiteAutomationCrawl_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "JobRun"("id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;

-- ValidateForeignKey
ALTER TABLE "Lead" VALIDATE CONSTRAINT "Lead_latestAuditId_fkey";
ALTER TABLE "Website" VALIDATE CONSTRAINT "Website_latestAuditId_fkey";
ALTER TABLE "SiteSnapshot" VALIDATE CONSTRAINT "SiteSnapshot_jobId_fkey";
ALTER TABLE "SiteSnapshot" VALIDATE CONSTRAINT "SiteSnapshot_crawlJobId_fkey";
ALTER TABLE "SiteAutomationCrawl" VALIDATE CONSTRAINT "SiteAutomationCrawl_crawlJobId_fkey";
