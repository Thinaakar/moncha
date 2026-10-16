-- Cold outreach outbox (draft / sent / suppressed). Delivery gated by COLD_EMAIL_* env.
CREATE TABLE IF NOT EXISTS "ColdEmail" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "companyName" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "deliveredTo" TEXT,
    "demoUrl" TEXT,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "resendId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ColdEmail_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ColdEmail_tenantId_createdAt_idx" ON "ColdEmail"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "ColdEmail_tenantId_status_idx" ON "ColdEmail"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "ColdEmail_tenantId_leadId_idx" ON "ColdEmail"("tenantId", "leadId");
CREATE INDEX IF NOT EXISTS "ColdEmail_tenantId_toEmail_idx" ON "ColdEmail"("tenantId", "toEmail");

DO $$ BEGIN
  ALTER TABLE "ColdEmail" ADD CONSTRAINT "ColdEmail_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ColdEmail" ADD CONSTRAINT "ColdEmail_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
