import {
  prisma,
  PrismaCompanyRepository,
  PrismaDiscoveryTargetRepository,
  PrismaDiscoveryUsageRepository,
  PrismaJobRunRepository,
  PrismaLeadRepository,
  PrismaWebsiteRepository,
} from '@moncha/db';
import type { CountryDiscoveryJobDeps, Logger } from '@moncha/domain';
import { GooglePlacesDiscoverySource } from '@moncha/integrations';

const STALE_CRAWL_MS = 15 * 60_000;

export const discoveryBudget = () => ({
  maxCallsPerDay: Math.max(1, Number(process.env.DISCOVERY_MAX_CALLS_PER_DAY || 500)),
  maxCallsPerRun: Math.max(1, Number(process.env.DISCOVERY_MAX_CALLS_PER_RUN || 30)),
});

export function countryCrawlDeps(logger: Logger): CountryDiscoveryJobDeps {
  const source = new GooglePlacesDiscoverySource(process.env.GOOGLE_PLACES_API_KEY || '', logger);
  return {
    source,
    providerCalls: () => source.requestCount,
    targets: new PrismaDiscoveryTargetRepository(prisma),
    usage: new PrismaDiscoveryUsageRepository(prisma),
    jobs: new PrismaJobRunRepository(prisma),
    companies: new PrismaCompanyRepository(prisma),
    leads: new PrismaLeadRepository(prisma),
    websites: new PrismaWebsiteRepository(prisma),
    logger,
  };
}

/**
 * Ids of crawls of `country` (by name) that are running right now, other than `excludeJobId`.
 * A running crawl whose heartbeat (lockedAt) is 15 minutes old was killed without a clean shutdown;
 * it is marked failed instead of being reported as live.
 */
export async function liveCountryCrawls(tenantId: string, country: string, excludeJobId?: string): Promise<string[]> {
  const running = await prisma.jobRun.findMany({
    where: {
      tenantId,
      type: { in: ['country_discovery', 'places_discovery'] },
      status: 'running',
      ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
      payload: { path: ['mode'], equals: 'country' },
      AND: [{ payload: { path: ['country'], equals: country } }],
    },
    select: { id: true, startedAt: true, lockedAt: true },
  });
  const heartbeat = (j: (typeof running)[number]) => (j.lockedAt ?? j.startedAt)?.getTime() ?? 0;
  const live = running.filter((j) => Date.now() - heartbeat(j) < STALE_CRAWL_MS);
  const stale = running.filter((j) => !live.includes(j));
  if (stale.length) {
    await prisma.jobRun.updateMany({
      where: { id: { in: stale.map((j) => j.id) } },
      data: {
        status: 'failed',
        lastError: 'interrupted: process ended without a clean shutdown',
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
      },
    });
  }
  return live.map((j) => j.id);
}
