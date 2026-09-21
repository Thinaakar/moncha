import { after } from 'next/server';
import { tasks } from '@trigger.dev/sdk/v3';
import { prisma, PrismaCompanyRepository, PrismaJobRunRepository, PrismaLeadRepository, PrismaWebsiteRepository } from '@moncha/db';
import { createConsoleLogger, runCsvImportJob, runPlacesDiscoveryJob, runWebsiteCheckJob } from '@moncha/domain';
import { createLiveDiscoverySource, type LiveDiscoverySourceName } from '@moncha/integrations';
import { BasicHttpWebsiteChecker } from '@moncha/crawling';

function persistDeps() {
  const logger = createConsoleLogger();
  return {
    jobs: new PrismaJobRunRepository(prisma),
    companies: new PrismaCompanyRepository(prisma),
    leads: new PrismaLeadRepository(prisma),
    websites: new PrismaWebsiteRepository(prisma),
    checker: new BasicHttpWebsiteChecker(),
    logger,
  };
}

function discoveryDeps(source: LiveDiscoverySourceName) {
  const base = persistDeps();
  return {
    ...base,
    source: createLiveDiscoverySource(source, process.env, base.logger),
  };
}

async function markFailed(tenantId: string, jobId: string, error: unknown) {
  await new PrismaJobRunRepository(prisma).update(tenantId, jobId, {
    status: 'failed',
    error: error instanceof Error ? error.message : String(error),
    finishedAt: new Date(),
  });
}

export async function enqueuePlacesDiscovery(payload: {
  jobId: string;
  tenantId: string;
  country: string;
  city: string;
  keyword: string;
  source?: LiveDiscoverySourceName;
}) {
  const source = payload.source ?? 'google_places';
  if (process.env.TRIGGER_SECRET_KEY) {
    await tasks.trigger('places-discovery', { ...payload, source }, { idempotencyKey: payload.jobId });
    return;
  }
  after(async () => {
    try {
      await runPlacesDiscoveryJob(discoveryDeps(source), payload);
    } catch (error) {
      await markFailed(payload.tenantId, payload.jobId, error);
    }
  });
}

export async function enqueueWebsiteCheck(payload: {
  jobId: string;
  tenantId: string;
  companyId: string;
  url: string;
}) {
  if (process.env.TRIGGER_SECRET_KEY) {
    await tasks.trigger('website-check', payload, { idempotencyKey: payload.jobId });
    return;
  }
  after(async () => {
    try {
      await runWebsiteCheckJob(persistDeps(), payload);
    } catch (error) {
      await markFailed(payload.tenantId, payload.jobId, error);
    }
  });
}

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
  if (process.env.TRIGGER_SECRET_KEY) {
    await tasks.trigger('csv-import', payload, { idempotencyKey: payload.jobId });
    return;
  }
  after(async () => {
    try {
      await runCsvImportJob(persistDeps(), payload);
    } catch (error) {
      await markFailed(payload.tenantId, payload.jobId, error);
    }
  });
}
