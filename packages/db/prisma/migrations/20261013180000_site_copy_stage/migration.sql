-- Copy job step shown in the console while a website copy runs.
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "stage" TEXT;
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "stageAt" TIMESTAMP(3);
