import { task } from '@trigger.dev/sdk/v3';
import { prisma, PrismaCompanyRepository, PrismaJobRunRepository, PrismaLeadRepository, PrismaWebsiteRepository } from '@moncha/db';
import { createConsoleLogger, runPlacesDiscoveryJob } from '@moncha/domain';
import { createLiveDiscoverySource, type LiveDiscoverySourceName } from '@moncha/integrations';
import { BasicHttpWebsiteChecker } from '@moncha/crawling';

export const placesDiscovery = task({
  id: 'places-discovery',
  run: async (payload: {
    jobId: string;
    tenantId: string;
    country: string;
    city: string;
    keyword: string;
    source?: LiveDiscoverySourceName;
  }) => {
    const logger = createConsoleLogger();
    const sourceName = payload.source ?? 'google_places';
    return runPlacesDiscoveryJob(
      {
        jobs: new PrismaJobRunRepository(prisma),
        source: createLiveDiscoverySource(sourceName, process.env, logger),
        companies: new PrismaCompanyRepository(prisma),
        leads: new PrismaLeadRepository(prisma),
        websites: new PrismaWebsiteRepository(prisma),
        checker: new BasicHttpWebsiteChecker(),
        logger,
      },
      payload,
    );
  },
});
