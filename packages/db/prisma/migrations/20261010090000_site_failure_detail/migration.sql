-- Why a website copy failed, and how many attempts it took (additive).
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "failureDetail" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "attempts" INTEGER NOT NULL DEFAULT 0;

-- Existing copies take their attempt count from their job.
UPDATE "SiteSnapshot" s
SET "attempts" = j."attempts"
FROM "JobRun" j
WHERE s."jobId" = j."id" AND s."attempts" = 0;
