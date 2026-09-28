import { after } from 'next/server';
import {
  prisma,
  PrismaCompanyRepository,
  PrismaJobRunRepository,
  PrismaLeadRepository,
  PrismaWebsiteRepository,
} from '@moncha/db';
import { createConsoleLogger, runCsvImportJob, runPlacesDiscoveryJob } from '@moncha/domain';
import { createLiveDiscoverySource, type LiveDiscoverySourceName } from '@moncha/integrations';

function persistDeps() {
  const logger = createConsoleLogger();
  return {
    jobs: new PrismaJobRunRepository(prisma),
    companies: new PrismaCompanyRepository(prisma),
    leads: new PrismaLeadRepository(prisma),
    websites: new PrismaWebsiteRepository(prisma),
    logger,
  };
}

/** Next/Turbopack does not expose a full `process.env` object when passed through;
 *  each key must be read as a static `process.env.X` access. */
function discoveryEnv(): Record<string, string | undefined> {
  return {
    GOOGLE_PLACES_API_KEY: process.env.GOOGLE_PLACES_API_KEY,
    YELP_API_KEY: process.env.YELP_API_KEY,
    FOURSQUARE_API_KEY: process.env.FOURSQUARE_API_KEY,
    SEARCH_API_KEY: process.env.SEARCH_API_KEY,
    SEARCH_ENGINE_ID: process.env.SEARCH_ENGINE_ID,
    DATAFORSEO_LOGIN: process.env.DATAFORSEO_LOGIN,
    DATAFORSEO_PASSWORD: process.env.DATAFORSEO_PASSWORD,
  };
}

function discoveryDeps(source: LiveDiscoverySourceName) {
  const base = persistDeps();
  return {
    ...base,
    source: createLiveDiscoverySource(source, discoveryEnv(), base.logger),
  };
}

async function markFailed(tenantId: string, jobId: string, error: unknown) {
  await new PrismaJobRunRepository(prisma).update(tenantId, jobId, {
    status: 'failed',
    lastError: error instanceof Error ? error.message : String(error),
    finishedAt: new Date(),
  });
}

/** Console runs Places discovery in-process via Next `after()`. Worker only claims website_audit. */
export async function enqueuePlacesDiscovery(payload: {
  jobId: string;
  tenantId: string;
  country: string;
  city: string;
  keyword: string;
  source?: LiveDiscoverySourceName;
}) {
  const source = payload.source ?? 'google_places';
  after(async () => {
    try {
      await runPlacesDiscoveryJob(discoveryDeps(source), payload);
    } catch (error) {
      await markFailed(payload.tenantId, payload.jobId, error);
    }
  });
}

/** Console runs CSV import in-process via Next `after()`. Worker only claims website_audit. */
export async function enqueueCsvImport(payload: {
  jobId: string;
  tenantId: string;
  csv?: string;
  records?: Array<{
    name?: string;
    domain?: string;
    website?: string;
    country?: string;
    city?: string;
    phone?: string;
    address?: string;
  }>;
}) {
  after(async () => {
    try {
      await runCsvImportJob(persistDeps(), payload);
    } catch (error) {
      await markFailed(payload.tenantId, payload.jobId, error);
    }
  });
}
