import { task } from '@trigger.dev/sdk/v3';
import { prisma, PrismaCompanyRepository, PrismaJobRunRepository, PrismaLeadRepository, PrismaWebsiteRepository } from '@moncha/db';
import { createConsoleLogger, runCsvImportJob } from '@moncha/domain';
import { BasicHttpWebsiteChecker } from '@moncha/crawling';

export const csvImport = task({
  id: 'csv-import',
  run: async (payload: {
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
  }) => {
    const logger = createConsoleLogger();
    return runCsvImportJob(
      {
        jobs: new PrismaJobRunRepository(prisma),
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
