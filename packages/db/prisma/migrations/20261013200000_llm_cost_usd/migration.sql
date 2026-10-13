-- USD that OpenRouter charged for AI calls, shown on the Costs page. Older rows stay null and are
-- estimated from their tokens. Adding a column does not touch the WebsiteAudit immutability trigger.
ALTER TABLE "SiteSnapshot" ADD COLUMN IF NOT EXISTS "llmCostUsd" DOUBLE PRECISION;
ALTER TABLE "WebsiteAudit" ADD COLUMN IF NOT EXISTS "llmCostUsd" DOUBLE PRECISION;
