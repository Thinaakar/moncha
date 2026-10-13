-- One website = one GitHub repo = one Cloudflare Worker (additive; existing rows stay undeployed).
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "githubRepo" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "workerStatus" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "workerAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "workerNextAt" TIMESTAMP(3);
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "workerLockedAt" TIMESTAMP(3);
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "workerName" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "workerUrl" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "workerError" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "workerDeployedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "SiteSnapshot_workerStatus_workerNextAt_idx" ON "SiteSnapshot"("workerStatus", "workerNextAt");
