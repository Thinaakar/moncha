-- Cold email origin (manual / auto / test) and per-tenant automation settings (off and draft-only by default).
ALTER TABLE "ColdEmail" ADD COLUMN IF NOT EXISTS "origin" TEXT NOT NULL DEFAULT 'manual';
CREATE INDEX IF NOT EXISTS "ColdEmail_tenantId_origin_createdAt_idx" ON "ColdEmail"("tenantId", "origin", "createdAt");

-- Every row before this migration was a demo sent to an internal test inbox, never to the lead.
UPDATE "ColdEmail" SET "origin" = 'test'
WHERE "deliveredTo" IN ('thinaakark2004@gmail.com', 'vinothjv4.tech@gmail.com');

CREATE TABLE IF NOT EXISTS "ColdEmailAutomationSettings" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "mode" TEXT NOT NULL DEFAULT 'draft',
    "dailyCap" INTEGER NOT NULL DEFAULT 20,
    "enabledAt" TIMESTAMP(3),
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ColdEmailAutomationSettings_pkey" PRIMARY KEY ("tenantId")
);

DO $$ BEGIN
  ALTER TABLE "ColdEmailAutomationSettings" ADD CONSTRAINT "ColdEmailAutomationSettings_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
