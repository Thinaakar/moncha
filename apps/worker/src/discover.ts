import './env';
import { countryDiscoverySchema } from '@moncha/contracts';
import { prisma, PrismaDiscoveryTargetRepository, PrismaDiscoveryUsageRepository } from '@moncha/db';
import {
  createConsoleLogger,
  resolveCountry,
  runCountryDiscoveryJob,
  supportedCountries,
  utcDay,
  type CountryDiscoveryJobPayload,
} from '@moncha/domain';
import { countryCrawlDeps, discoveryBudget, liveCountryCrawls } from './country-crawls';

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

  const live = await liveCountryCrawls(tenantId, profile.name);
  if (live.length) {
    throw new Error(
      `A ${profile.name} crawl is already running (job ${live.join(', ')}). ` +
        'Stop it first, or wait 15 minutes after it last searched.',
    );
  }

  const logger = createConsoleLogger();
  const deps = countryCrawlDeps(logger);
  const payload: CountryDiscoveryJobPayload = {
    mode: 'country',
    origin: 'manual',
    country: profile.name,
    countryCode: profile.code,
    cities: input.cities,
    industries: input.industries,
    maxPages: input.maxPages,
    maxSearches: input.maxSearches,
    maxCallsPerDay: input.maxCallsPerDay,
    reset: input.reset,
  };
  const job = await deps.jobs.create({ tenantId, type: 'country_discovery', payload, status: 'running', maxAttempts: 1 });

  const controller = new AbortController();
  process.on('SIGINT', () => {
    if (controller.signal.aborted) process.exit(130);
    console.log('\nStopping after the current search (Ctrl+C again to force quit)...');
    controller.abort();
  });

  const result = await runCountryDiscoveryJob(deps, {
    job,
    source: input.source,
    maxCallsPerDay: discoveryBudget().maxCallsPerDay,
    signal: controller.signal,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.stoppedReason === 'provider_error') process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
