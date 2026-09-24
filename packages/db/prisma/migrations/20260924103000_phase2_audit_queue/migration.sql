-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'operator', 'viewer');

-- CreateEnum
CREATE TYPE "WebsiteStatus" AS ENUM ('UNCHECKED', 'ACTIVE', 'INACTIVE', 'PARKED', 'INACCESSIBLE', 'MISSING');

-- CreateEnum
CREATE TYPE "AssistantVerdict" AS ENUM ('NO_ASSISTANT', 'HAS_ASSISTANT', 'UNCERTAIN', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "AssistantKind" AS ENUM ('AI_CHATBOT', 'LIVE_CHAT', 'MESSAGING_LINK', 'NONE');

-- CreateEnum
CREATE TYPE "LeadQueue" AS ENUM ('PENDING_AUDIT', 'QUALIFIED', 'HAS_ASSISTANT', 'NO_WEBSITE', 'NEEDS_REVIEW', 'INACTIVE');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('places_discovery', 'csv_import', 'website_audit');

-- CreateEnum
CREATE TYPE "AuditMethod" AS ENUM ('html', 'render', 'llm');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('script_src', 'iframe_src', 'dom_selector', 'network_request', 'window_global', 'screenshot', 'page_excerpt', 'llm_reason');

-- CreateEnum
CREATE TYPE "ChannelType" AS ENUM ('whatsapp', 'contact_form', 'booking_link', 'tel', 'email');

-- CreateEnum
CREATE TYPE "ReviewTaskStatus" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'operator',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "country" TEXT,
    "city" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "queue" "LeadQueue" NOT NULL DEFAULT 'PENDING_AUDIT',
    "assistantVerdict" "AssistantVerdict",
    "assistantVendor" TEXT,
    "qualificationReason" TEXT,
    "latestAuditId" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceRecord" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT,
    "rawJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SourceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Website" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "canonicalUrl" TEXT,
    "status" "WebsiteStatus" NOT NULL DEFAULT 'UNCHECKED',
    "language" TEXT,
    "finalUrl" TEXT,
    "httpStatus" INTEGER,
    "title" TEXT,
    "latestAuditId" TEXT,
    "lastCheckedAt" TIMESTAMP(3),

    CONSTRAINT "Website_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebsiteAudit" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "websiteId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "method" "AuditMethod" NOT NULL,
    "renderRan" BOOLEAN NOT NULL DEFAULT false,
    "llmRan" BOOLEAN NOT NULL DEFAULT false,
    "verdict" "AssistantVerdict" NOT NULL,
    "kind" "AssistantKind" NOT NULL DEFAULT 'NONE',
    "vendor" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "classifierVersion" TEXT NOT NULL,
    "contentHash" TEXT,
    "failureReason" TEXT,
    "httpStatus" INTEGER,
    "finalUrl" TEXT,
    "llmModel" TEXT,
    "llmPromptVersion" TEXT,
    "llmResult" JSONB,
    "llmPromptTokens" INTEGER,
    "llmCompletionTokens" INTEGER,
    "auditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebsiteAudit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceItem" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "type" "EvidenceType" NOT NULL,
    "url" TEXT,
    "selector" TEXT,
    "excerpt" TEXT,
    "vendor" TEXT,
    "sourcePage" TEXT,
    "objectUri" TEXT,
    "contentHash" TEXT,

    CONSTRAINT "EvidenceItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DetectedChannel" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "type" "ChannelType" NOT NULL,
    "url" TEXT NOT NULL,
    "selector" TEXT,
    "sourcePage" TEXT,

    CONSTRAINT "DetectedChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewTask" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "auditId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReviewTaskStatus" NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "leadId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'pending',
    "payload" JSONB,
    "result" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "runAfter" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "dedupeKey" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "workerId" TEXT NOT NULL,
    "hostname" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("workerId")
);

-- CreateTable
CREATE TABLE "HostAuditCache" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "classifierVersion" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "auditedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HostAuditCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmResultCache" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "bundleHash" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LlmResultCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LlmUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "failedCalls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "LlmUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_tenantId_email_key" ON "User"("tenantId", "email");

-- CreateIndex
CREATE INDEX "Company_tenantId_name_idx" ON "Company"("tenantId", "name");

-- CreateIndex
CREATE INDEX "Company_tenantId_country_idx" ON "Company"("tenantId", "country");

-- CreateIndex
CREATE INDEX "Company_tenantId_city_idx" ON "Company"("tenantId", "city");

-- CreateIndex
CREATE INDEX "Company_tenantId_createdAt_idx" ON "Company"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Company_tenantId_domain_key" ON "Company"("tenantId", "domain");

-- CreateIndex
CREATE INDEX "Lead_tenantId_queue_idx" ON "Lead"("tenantId", "queue");

-- CreateIndex
CREATE INDEX "Lead_tenantId_assistantVerdict_idx" ON "Lead"("tenantId", "assistantVerdict");

-- CreateIndex
CREATE INDEX "Lead_tenantId_assistantVendor_idx" ON "Lead"("tenantId", "assistantVendor");

-- CreateIndex
CREATE INDEX "Lead_tenantId_createdAt_idx" ON "Lead"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_tenantId_companyId_key" ON "Lead"("tenantId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceRecord_tenantId_source_externalId_key" ON "SourceRecord"("tenantId", "source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "Website_companyId_key" ON "Website"("companyId");

-- CreateIndex
CREATE INDEX "Website_tenantId_status_idx" ON "Website"("tenantId", "status");

-- CreateIndex
CREATE INDEX "WebsiteAudit_tenantId_leadId_auditedAt_idx" ON "WebsiteAudit"("tenantId", "leadId", "auditedAt");

-- CreateIndex
CREATE INDEX "WebsiteAudit_tenantId_websiteId_auditedAt_idx" ON "WebsiteAudit"("tenantId", "websiteId", "auditedAt");

-- CreateIndex
CREATE INDEX "WebsiteAudit_tenantId_method_idx" ON "WebsiteAudit"("tenantId", "method");

-- CreateIndex
CREATE INDEX "WebsiteAudit_tenantId_vendor_idx" ON "WebsiteAudit"("tenantId", "vendor");

-- CreateIndex
CREATE INDEX "EvidenceItem_tenantId_auditId_idx" ON "EvidenceItem"("tenantId", "auditId");

-- CreateIndex
CREATE INDEX "DetectedChannel_tenantId_auditId_idx" ON "DetectedChannel"("tenantId", "auditId");

-- CreateIndex
CREATE INDEX "ReviewTask_tenantId_status_idx" ON "ReviewTask"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ReviewTask_tenantId_leadId_idx" ON "ReviewTask"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_tenantId_leadId_idx" ON "AuditLog"("tenantId", "leadId");

-- CreateIndex
CREATE INDEX "JobRun_status_runAfter_idx" ON "JobRun"("status", "runAfter");

-- CreateIndex
CREATE INDEX "JobRun_tenantId_createdAt_idx" ON "JobRun"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "JobRun_tenantId_status_idx" ON "JobRun"("tenantId", "status");

-- CreateIndex
CREATE INDEX "JobRun_status_lockedAt_idx" ON "JobRun"("status", "lockedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JobRun_tenantId_dedupeKey_key" ON "JobRun"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "HostAuditCache_tenantId_auditedAt_idx" ON "HostAuditCache"("tenantId", "auditedAt");

-- CreateIndex
CREATE UNIQUE INDEX "HostAuditCache_tenantId_host_classifierVersion_key" ON "HostAuditCache"("tenantId", "host", "classifierVersion");

-- CreateIndex
CREATE UNIQUE INDEX "LlmResultCache_tenantId_bundleHash_model_promptVersion_key" ON "LlmResultCache"("tenantId", "bundleHash", "model", "promptVersion");

-- CreateIndex
CREATE UNIQUE INDEX "LlmUsage_tenantId_day_key" ON "LlmUsage"("tenantId", "day");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceRecord" ADD CONSTRAINT "SourceRecord_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Website" ADD CONSTRAINT "Website_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAudit" ADD CONSTRAINT "WebsiteAudit_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAudit" ADD CONSTRAINT "WebsiteAudit_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "Website"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebsiteAudit" ADD CONSTRAINT "WebsiteAudit_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceItem" ADD CONSTRAINT "EvidenceItem_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedChannel" ADD CONSTRAINT "DetectedChannel_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DetectedChannel" ADD CONSTRAINT "DetectedChannel_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewTask" ADD CONSTRAINT "ReviewTask_auditId_fkey" FOREIGN KEY ("auditId") REFERENCES "WebsiteAudit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostAuditCache" ADD CONSTRAINT "HostAuditCache_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmResultCache" ADD CONSTRAINT "LlmResultCache_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LlmUsage" ADD CONSTRAINT "LlmUsage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique: one open review task per lead
CREATE UNIQUE INDEX "review_task_one_open_per_lead"
ON "ReviewTask" ("tenantId", "leadId")
WHERE status = 'open';

CREATE OR REPLACE FUNCTION moncha_forbid_audit_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'WebsiteAudit is immutable: UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER website_audit_immutable_update
BEFORE UPDATE ON "WebsiteAudit"
FOR EACH ROW EXECUTE FUNCTION moncha_forbid_audit_mutation();

CREATE TRIGGER website_audit_immutable_delete
BEFORE DELETE ON "WebsiteAudit"
FOR EACH ROW EXECUTE FUNCTION moncha_forbid_audit_mutation();

CREATE OR REPLACE FUNCTION moncha_forbid_evidence_mutation()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'EvidenceItem is immutable: UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER evidence_item_immutable_update
BEFORE UPDATE ON "EvidenceItem"
FOR EACH ROW EXECUTE FUNCTION moncha_forbid_evidence_mutation();

CREATE TRIGGER evidence_item_immutable_delete
BEFORE DELETE ON "EvidenceItem"
FOR EACH ROW EXECUTE FUNCTION moncha_forbid_evidence_mutation();
