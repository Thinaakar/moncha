import './env';
import { prisma, PrismaSiteSnapshotRepository } from '@moncha/db';
import {
  createConsoleLogger,
  deploySiteSnapshotToWorker,
  pushSiteSnapshotToGithub,
  siteName,
} from '@moncha/domain';
import { siteAgentConfig, siteGithubPublisher, siteWorkerDeployer } from './site-agent';

/**
 * Publishes the newest finished copy of each website to its own GitHub repo and Cloudflare Worker.
 *
 *   pnpm --filter @moncha/worker sites:backfill -- --limit 3            queue for the running worker
 *   pnpm --filter @moncha/worker sites:backfill -- --limit 3 --run      publish now from this machine
 *   options: --dry-run, --only github|worker, --site ja-edu-sg (repeatable)
 */

function args() {
  const argv = process.argv.slice(2);
  const value = (name: string) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const sites = argv.flatMap((a, i) => (a === '--site' && argv[i + 1] ? [argv[i + 1]!] : []));
  const only = value('--only');
  return {
    limit: Math.max(1, Number(value('--limit') ?? 3) || 3),
    dryRun: argv.includes('--dry-run'),
    run: argv.includes('--run'),
    github: only !== 'worker',
    worker: only !== 'github',
    sites: new Set(sites),
  };
}

function assertNotProduction() {
  const prodHost = process.env.PROD_DB_HOST?.trim();
  const urls = [process.env.DATABASE_URL, process.env.DIRECT_URL].filter(Boolean) as string[];
  if (prodHost && urls.some((u) => u.includes(prodHost))) {
    throw new Error('Refusing to run against the production database');
  }
}

async function main() {
  assertNotProduction();
  const opts = args();
  const logger = createConsoleLogger();
  const publisher = opts.github ? siteGithubPublisher() : null;
  const deployer = opts.worker ? siteWorkerDeployer() : null;
  const store = siteAgentConfig().store;
  if (!publisher && !deployer) throw new Error('Neither GitHub (GITHUB_TOKEN + owner) nor Cloudflare (CLOUDFLARE_API_TOKEN) is configured');

  const rows = await prisma.siteSnapshot.findMany({
    where: { status: 'done' },
    select: {
      id: true,
      tenantId: true,
      sourceUrl: true,
      finalUrl: true,
      createdAt: true,
      githubRepo: true,
      githubStatus: true,
      workerStatus: true,
      lead: { select: { company: { select: { domain: true } } } },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });

  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const name = siteName({ id: row.id, company: { domain: row.lead.company.domain }, finalUrl: row.finalUrl, sourceUrl: row.sourceUrl });
    if (!newest.has(name)) newest.set(name, row);
  }

  const busy = new Set(['pushing', 'deploying', 'pending']);
  const picked = [...newest.entries()]
    .filter(([name]) => !opts.sites.size || opts.sites.has(name))
    .map(([name, row]) => ({
      name,
      row,
      github: Boolean(publisher) && !row.githubRepo && !busy.has(row.githubStatus ?? ''),
      worker: Boolean(deployer) && row.workerStatus !== 'deployed' && !busy.has(row.workerStatus ?? ''),
    }))
    .filter((p) => p.github || p.worker)
    .slice(0, opts.limit);

  console.log(
    JSON.stringify({
      websites: newest.size,
      selected: picked.length,
      mode: opts.dryRun ? 'dry-run' : opts.run ? 'run' : 'queue',
      github: Boolean(publisher),
      worker: Boolean(deployer),
    }),
  );
  for (const p of picked) console.log(`  ${p.name}  copy=${p.row.id}  github=${p.github}  worker=${p.worker}`);
  if (opts.dryRun || !picked.length) return;

  const now = new Date();
  if (!opts.run) {
    for (const p of picked) {
      await prisma.siteSnapshot.update({
        where: { id: p.row.id },
        data: {
          ...(p.github ? { githubStatus: 'pending', githubAttempts: 0, githubNextAt: now, githubError: null, githubLockedAt: null } : {}),
          ...(p.worker ? { workerStatus: 'pending', workerAttempts: 0, workerNextAt: now, workerError: null, workerLockedAt: null } : {}),
        },
      });
    }
    console.log(`Queued ${picked.length} website(s); the worker publishes them within a few seconds each.`);
    return;
  }

  if (!store) throw new Error('R2 is not configured (R2_*), so copy files cannot be read');
  const snapshots = new PrismaSiteSnapshotRepository(prisma);
  let githubPausedUntil: Date | null = null;
  for (const p of picked) {
    // Claimed rows (deploying/pushing) are skipped by every other worker until they go stale.
    if (p.worker && deployer) {
      await prisma.siteSnapshot.update({
        where: { id: p.row.id },
        data: { workerStatus: 'deploying', workerAttempts: 1, workerLockedAt: new Date(), workerError: null },
      });
      const claimed = (await snapshots.get(p.row.tenantId, p.row.id))!;
      const outcome = await deploySiteSnapshotToWorker({ snapshots, store, deployer, logger }, claimed);
      console.log(JSON.stringify({ site: p.name, step: 'worker', ...outcome }));
    }
    if (p.github && publisher && !githubPausedUntil) {
      await prisma.siteSnapshot.update({
        where: { id: p.row.id },
        data: { githubStatus: 'pushing', githubAttempts: 1, githubLockedAt: new Date(), githubError: null },
      });
      const claimed = (await snapshots.get(p.row.tenantId, p.row.id))!;
      const outcome = await pushSiteSnapshotToGithub(
        { snapshots, store, publisher, logger, liveUrlFor: deployer ? (name) => deployer.urlFor(name) : undefined },
        claimed,
      );
      console.log(JSON.stringify({ site: p.name, step: 'github', ...outcome }));
      if (outcome.status === 'rate_limited') {
        githubPausedUntil = outcome.retryAt;
        console.log(`GitHub is rate limited until ${outcome.retryAt.toISOString()}; skipping the remaining GitHub pushes.`);
      }
    }
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
