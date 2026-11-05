/**
 * One-shot: for every live website copy with the chatbot installed, set the bot's profile picture (botIconUrl)
 * and the floating launcher bubble (launcherIconUrl) to the website's favicon (at least 48 px), else its logo,
 * as its Worker serves it, both on a white background. New deploys do this automatically; this covers copies deployed
 * before that, including bots whose avatar was set before the launcher logo was.
 *
 * A picture that is not square (a wide header logo) is shown whole only through the square icon a deploy publishes
 * (moncha-chatbot-icon.svg). Those copies are listed as "needs redeploy"; --redeploy deploys them again now, which
 * publishes the icon and sets it (and the allowed domain) on the chatbot. --force also redeploys copies whose chatbot
 * already uses the square icon, to rebuild it.
 *   pnpm --filter @moncha/worker avatars:backfill -- --dry-run [--limit <n>]
 *   pnpm --filter @moncha/worker avatars:backfill [-- --tenant <id>] [-- --limit <n>] [-- --lead <id>] [-- --redeploy [--force]]
 */
import './env';
import { prisma, PrismaLeadBotRepository, PrismaSiteSnapshotRepository } from '@moncha/db';
import {
  CHATBOT_ICON_PATH,
  chatbotIconPlan,
  createConsoleLogger,
  deploySiteSnapshotToWorker,
  liveAssetUrl,
  readSiteManifest,
  setChatbotAvatarForLiveUrl,
  type SiteBrand,
} from '@moncha/domain';
import { createMonchaInternalClientFromEnv, createR2SiteStoreFromEnv, MonchaInternalError } from '@moncha/integrations';
import { siteWorkerDeployer } from './site-agent';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Candidate = {
  tenantId: string;
  leadId: string;
  chatbotId: string;
  snapshotId: string;
  workerUrl: string;
  storagePrefix: string;
  brand: SiteBrand | null;
};

async function candidates(options: { tenantId?: string; leadId?: string; limit?: number }): Promise<Candidate[]> {
  const live = { workerStatus: 'deployed', workerUrl: { not: null }, chatbotStatus: 'installed' } as const;
  const bots = await prisma.leadBot.findMany({
    where: {
      status: 'created',
      chatbotId: { not: null },
      ...(options.tenantId ? { tenantId: options.tenantId } : {}),
      ...(options.leadId ? { leadId: options.leadId } : {}),
      lead: { siteSnapshots: { some: live } },
    },
    select: {
      tenantId: true,
      leadId: true,
      chatbotId: true,
      lead: {
        select: {
          siteSnapshots: {
            where: live,
            orderBy: [{ workerDeployedAt: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { id: true, workerUrl: true, storagePrefix: true, brand: true },
          },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
    ...(options.limit ? { take: options.limit } : {}),
  });
  return bots.flatMap((bot) => {
    const snap = bot.lead.siteSnapshots[0];
    if (!bot.chatbotId || !snap?.workerUrl) return [];
    return [
      {
        tenantId: bot.tenantId,
        leadId: bot.leadId,
        chatbotId: bot.chatbotId,
        snapshotId: snap.id,
        workerUrl: snap.workerUrl,
        storagePrefix: snap.storagePrefix,
        brand: (snap.brand as SiteBrand | null) ?? null,
      },
    ];
  });
}

async function main() {
  const client = createMonchaInternalClientFromEnv();
  if (!client) throw new Error('MONCHA_INTERNAL_KEY is not set in apps/worker/.env');
  const store = createR2SiteStoreFromEnv();
  if (!store) throw new Error('R2_* keys are not set in apps/worker/.env');

  const dryRun = process.argv.includes('--dry-run');
  const redeploy = process.argv.includes('--redeploy');
  const force = process.argv.includes('--force');
  const deployer = redeploy ? siteWorkerDeployer() : null;
  if (redeploy && !deployer) throw new Error('--redeploy needs CLOUDFLARE_API_TOKEN and the Workers settings in apps/worker/.env');
  const limitRaw = arg('--limit');
  const limit = limitRaw ? Math.max(1, Number(limitRaw)) : undefined;
  if (limitRaw && !Number.isFinite(limit)) throw new Error(`--limit must be a number (got ${limitRaw})`);

  const list = await candidates({ tenantId: arg('--tenant'), leadId: arg('--lead'), limit });
  console.log(`${dryRun ? 'would set' : 'setting'} avatars for ${list.length} live chatbot(s) (${client.environment})`);
  if (!list.length) return;

  const bots = new PrismaLeadBotRepository(prisma);
  const snapshots = new PrismaSiteSnapshotRepository(prisma);
  const logger = createConsoleLogger();
  const avatarDeps = { bots, api: client, logger };
  const missing = () => new Error('manifest.json is not in R2');
  let ok = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;
  let needRedeploy = 0;
  let redeployed = 0;

  for (const row of list) {
    let manifest;
    try {
      manifest = await readSiteManifest(store, row.storagePrefix, missing);
    } catch (error) {
      failed += 1;
      console.error(`fail lead=${row.leadId}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }

    const readAsset = (asset: { storedPath: string }) => store.getBytes(`${row.storagePrefix}${asset.storedPath}`);

    if (dryRun) {
      const plan = await chatbotIconPlan(manifest, row.brand, readAsset);
      const url = plan ? liveAssetUrl(row.workerUrl, plan.asset.storedPath) : null;
      if (url) ok += 1;
      else skipped += 1;
      if (plan?.padded) needRedeploy += 1;
      const size = plan?.size ? ` ${plan.size.width}x${plan.size.height}` : '';
      console.log(
        `${url ? 'would set' : 'no image'} lead=${row.leadId}${url ? ` ${plan!.asset.kind === 'icon' ? 'favicon' : 'logo'}${size}${plan!.padded ? ' [square icon on redeploy]' : ''} ${url}` : ''}`,
      );
      continue;
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await setChatbotAvatarForLiveUrl(avatarDeps, {
          tenantId: row.tenantId,
          leadId: row.leadId,
          workerUrl: row.workerUrl,
          manifest,
          brand: row.brand,
          readAsset,
        });
        if (!result) {
          skipped += 1;
          console.log(`skip lead=${row.leadId} (no created bot)`);
        } else if (!result.botIconUrl) {
          skipped += 1;
          console.log(`${result.changed ? 'cleared' : 'no image'} lead=${row.leadId}`);
        } else if (!result.changed) {
          unchanged += 1;
          console.log(`same lead=${row.leadId} ${result.botIconUrl}`);
        } else {
          ok += 1;
          console.log(`ok ${ok} lead=${row.leadId} ${result.botIconUrl}`);
        }

        const rebuild = force && Boolean(result?.botIconUrl?.endsWith(`/${CHATBOT_ICON_PATH}`));
        if (result?.needsSquareIcon || rebuild) {
          needRedeploy += 1;
          if (!deployer) {
            console.log(`needs redeploy lead=${row.leadId} (picture is not square; run again with --redeploy)`);
          } else {
            // Claimed like the poller does, so no other worker deploys this copy at the same time.
            await prisma.siteSnapshot.update({
              where: { id: row.snapshotId },
              data: { workerStatus: 'deploying', workerAttempts: 1, workerLockedAt: new Date(), workerError: null },
            });
            const claimed = (await snapshots.get(row.tenantId, row.snapshotId))!;
            const outcome = await deploySiteSnapshotToWorker(
              { snapshots, store, deployer, logger, domains: { bots, api: client, logger }, avatar: avatarDeps },
              claimed,
            );
            if (outcome.status === 'deployed') redeployed += 1;
            else failed += 1;
            console.log(`redeploy lead=${row.leadId} ${outcome.status}${'url' in outcome ? ` ${outcome.url}` : ''}${'error' in outcome ? ` ${outcome.error}` : ''}`);
          }
        }
        break;
      } catch (error) {
        const moncha = error instanceof MonchaInternalError ? error : null;
        if (moncha?.status === 429 && attempt < 3) {
          const waitMs = Math.max(2_000, (moncha.retryAt?.getTime() ?? Date.now() + 5_000) - Date.now());
          console.log(`rate limited; waiting ${Math.ceil(waitMs / 1000)}s then retrying lead=${row.leadId}`);
          await sleep(waitMs);
          continue;
        }
        failed += 1;
        console.error(`fail lead=${row.leadId} chatbot=${row.chatbotId}: ${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
    await sleep(150);
  }

  console.log(
    `done: ${dryRun ? 'would_set' : 'set'}=${ok} unchanged=${unchanged} no_image=${skipped} failed=${failed} ` +
      `need_square_icon=${needRedeploy}${redeploy ? ` redeployed=${redeployed}` : ''}`,
  );
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
