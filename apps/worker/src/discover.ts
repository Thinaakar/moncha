import './env';
import { countryDiscoverySchema } from '@moncha/contracts';
import {
  prisma,
  PrismaCompanyRepository,
  PrismaDiscoveryTargetRepository,
  PrismaDiscoveryUsageRepository,
  PrismaJobRunRepository,
  PrismaLeadRepository,
  PrismaWebsiteRepository,
} from '@moncha/db';
import { createConsoleLogger, resolveCountry, runCountryDiscovery, supportedCountries, utcDay } from '@moncha/domain';
import { GooglePlacesDiscoverySource } from '@moncha/integrations';

const USAGE = `Country-wide discovery: searches every city × industry in a country and queues website audits.

  pnpm --filter @moncha/worker discover --country <Singapore|Malaysia|Japan> [options]

Options
  --cities "A;B"        Only these search areas (semicolon-separated, e.g. "Shinjuku;Osaka")
  --industries "a,b"    Only these industries (comma-separated); default is the built-in list
  --max-pages <1-3>     Result pages per search, 20 results each (default 3)
  --max-searches <n>    Stop after n searches in this run
  --max-calls <n>       Daily Google call limit (default DISCOVERY_MAX_CALLS_PER_DAY or 500)
  --reset               Re-crawl: put every search for the country back to pending
  --status              Show progress and today's usage without searching`;

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    if (!arg.startsWith('--')) continue;
    const [flag, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    if (inline !== undefined) out[flag] = inline;
    else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) out[flag] = argv[++i]!;
    else out[flag] = true;
  }
  return out;
}

const list = (value: string | boolean | undefined, sep: string) =>
  typeof value === 'string'
    ? value
        .split(sep)
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.country) {
    console.log(USAGE);
    process.exit(args.help ? 0 : 1);
  }

  const tenantId = process.env.DEFAULT_TENANT_ID || 'tenant_moncha_internal';
  const input = countryDiscoverySchema.parse({
    country: args.country,
    cities: list(args.cities, ';'),
    industries: list(args.industries, ','),
    maxPages: args['max-pages'],
    maxSearches: args['max-searches'],
    maxCallsPerDay: args['max-calls'] ?? process.env.DISCOVERY_MAX_CALLS_PER_DAY ?? 500,
    reset: args.reset === true,
  });
  const profile = resolveCountry(input.country);
  if (!profile) throw new Error(`Unsupported country "${input.country}". Supported: ${supportedCountries().join(', ')}`);

  const targets = new PrismaDiscoveryTargetRepository(prisma);
  const usage = new PrismaDiscoveryUsageRepository(prisma);
  const key = { tenantId, source: input.source, countryCode: profile.code };

  if (args.status) {
    const counts = await targets.counts(key);
    const today = await usage.get(tenantId, input.source, utcDay());
    console.log(
      JSON.stringify(
        { country: profile.name, searches: counts, callsToday: today, maxCallsPerDay: input.maxCallsPerDay },
        null,
        2,
      ),
    );
    return;
  }

  await releaseStaleCrawls(tenantId, profile.name);

  const logger = createConsoleLogger();
  const source = new GooglePlacesDiscoverySource(process.env.GOOGLE_PLACES_API_KEY || '', logger);
  const jobs = new PrismaJobRunRepository(prisma);
  const job = await jobs.create({
    tenantId,
    type: 'places_discovery',
    payload: { mode: 'country', origin: 'worker', ...input, country: profile.name },
  });
  await jobs.update(tenantId, job.id, { status: 'running', startedAt: new Date(), lockedAt: new Date() });

  // lockedAt doubles as this crawl's heartbeat (see releaseStaleCrawls).
  const trackedTargets: typeof targets = Object.assign(Object.create(targets), {
    markStarted: async (id: string) => {
      await targets.markStarted(id);
      await jobs.update(tenantId, job.id, { lockedAt: new Date() });
    },
  });

  const controller = new AbortController();
  process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(130);
    console.log('\nStopping after the current search (Ctrl+C again to force quit)...');
    controller.abort();
  });

  try {
    const result = await runCountryDiscovery(
      {
        source,
        providerCalls: () => source.requestCount,
        targets: trackedTargets,
        usage,
        jobs,
        companies: new PrismaCompanyRepository(prisma),
        leads: new PrismaLeadRepository(prisma),
        websites: new PrismaWebsiteRepository(prisma),
        logger,
      },
      { tenantId, ...input, maxCallsPerDay: input.maxCallsPerDay ?? 500, signal: controller.signal },
    );
    await jobs.update(tenantId, job.id, {
      status: result.stoppedReason === 'provider_error' ? 'failed' : 'done',
      result,
      lastError: result.stoppedReason === 'provider_error' ? result.lastError : null,
      finishedAt: new Date(),
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.stoppedReason === 'provider_error') process.exitCode = 1;
  } catch (error) {
    await jobs.update(tenantId, job.id, {
      status: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
      finishedAt: new Date(),
    });
    throw error;
  }
}

const STALE_CRAWL_MS = 15 * 60_000;

/**
 * One crawl per country at a time. A "running" crawl with no search activity for 15 minutes was
 * killed without a clean shutdown; mark it failed so it does not look live forever.
 */
async function releaseStaleCrawls(tenantId: string, country: string) {
  const running = await prisma.jobRun.findMany({
    where: {
      tenantId,
      type: 'places_discovery',
      status: 'running',
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
      data: { status: 'failed', lastError: 'interrupted: process ended without a clean shutdown', finishedAt: new Date() },
    });
  }
  if (live.length) {
    throw new Error(
      `A ${country} crawl is already running (job ${live.map((j) => j.id).join(', ')}). ` +
        'Stop it first, or wait 15 minutes after it last searched.',
    );
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
