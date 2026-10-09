-- GitHub push of website copy code files (additive; existing rows stay unpushed).
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "githubStatus" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "githubAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "githubNextAt" TIMESTAMP(3);
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "githubLockedAt" TIMESTAMP(3);
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "githubCommitSha" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "githubCommitUrl" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "githubFolderUrl" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "githubError" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "githubPushedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "SiteSnapshot_githubStatus_githubNextAt_idx" ON "SiteSnapshot"("githubStatus", "githubNextAt");
