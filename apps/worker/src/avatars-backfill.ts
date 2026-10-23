/**
 * One-shot: for every live website copy with the chatbot installed, set the bot's profile picture (botIconUrl)
 * and the floating launcher bubble (launcherIconUrl) to the website's favicon (at least 48 px), else its logo,
 * as its Worker serves it. New deploys do this automatically; this covers copies deployed before that.
 *   pnpm --filter @moncha/worker avatars:backfill -- --dry-run [--limit <n>]
 *   pnpm --filter @moncha/worker avatars:backfill [-- --tenant <id>] [-- --limit <n>] [-- --lead <id>]
 */
import './env';
import { prisma, PrismaLeadBotRepository } from '@moncha/db';
import {
  chatbotAvatarAsset,
  chatbotIconSizes,
  createConsoleLogger,
  liveAssetUrl,
  readSiteManifest,
  setChatbotAvatarForLiveUrl,
  type SiteBrand,
} from '@moncha/domain';
import { createMonchaInternalClientFromEnv, createR2SiteStoreFromEnv, MonchaInternalError } from '@moncha/integrations';

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
            select: { workerUrl: true, storagePrefix: true, brand: true },
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
  const limitRaw = arg('--limit');
  const limit = limitRaw ? Math.max(1, Number(limitRaw)) : undefined;
  if (limitRaw && !Number.isFinite(limit)) throw new Error(`--limit must be a number (got ${limitRaw})`);

  const list = await candidates({ tenantId: arg('--tenant'), leadId: arg('--lead'), limit });
  console.log(`${dryRun ? 'would set' : 'setting'} avatars for ${list.length} live chatbot(s) (${client.environment})`);
  if (!list.length) return;

  const bots = new PrismaLeadBotRepository(prisma);
  const logger = createConsoleLogger();
  const missing = () => new Error('manifest.json is not in R2');
  let ok = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

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
      const sizes = await chatbotIconSizes(manifest, readAsset);
      const asset = chatbotAvatarAsset(manifest, row.brand, sizes);
      const url = asset ? liveAssetUrl(row.workerUrl, asset.storedPath) : null;
      const size = asset ? sizes.get(asset.id) : undefined;
      if (url) ok += 1;
      else skipped += 1;
      console.log(
        `${url ? 'would set' : 'no image'} lead=${row.leadId}${url ? ` ${asset!.kind === 'icon' ? 'favicon' : 'logo'}${size ? ` ${size.width}x${size.height}` : ''} ${url}` : ''}`,
      );
      continue;
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await setChatbotAvatarForLiveUrl(
          { bots, api: client, logger },
          { tenantId: row.tenantId, leadId: row.leadId, workerUrl: row.workerUrl, manifest, brand: row.brand, readAsset },
        );
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

  console.log(`done: ${dryRun ? 'would_set' : 'set'}=${ok} unchanged=${unchanged} no_image=${skipped} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
