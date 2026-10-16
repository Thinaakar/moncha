-- Allowed widget hostnames from MonCha PUT /bots/:botId/domains (6.2), set after the Worker deploy.

-- AlterTable
ALTER TABLE "LeadBot" ADD COLUMN "domains" JSONB;
ALTER TABLE "LeadBot" ADD COLUMN "domainsConfiguredAt" TIMESTAMP(3);
