-- Site automation reads JobRun."crawlJobId" (indexed by JobRun_tenantId_crawlJobId_idx) instead of
-- payload->>'crawlJobId', so the expression index from 20261009090000_site_automation is unused.

-- DropIndex
DROP INDEX IF EXISTS "JobRun_website_audit_crawlJobId_idx";
