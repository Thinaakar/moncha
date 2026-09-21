import { task } from '@trigger.dev/sdk/v3';
import { prisma, PrismaJobRunRepository, PrismaWebsiteRepository } from '@moncha/db';
import { createConsoleLogger, runWebsiteCheckJob } from '@moncha/domain';
import { BasicHttpWebsiteChecker } from '@moncha/crawling';

export const websiteCheck = task({
  id: 'website-check',
  run: async (payload: { jobId: string; tenantId: string; companyId: string; url: string }) => {
    const logger = createConsoleLogger();
    return runWebsiteCheckJob(
      {
        jobs: new PrismaJobRunRepository(prisma),
        websites: new PrismaWebsiteRepository(prisma),
        checker: new BasicHttpWebsiteChecker(),
        logger,
      },
      payload,
    );
  },
});
