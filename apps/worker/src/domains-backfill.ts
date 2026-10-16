/**
 * One-shot: for every created MonCha bot whose lead already has a live Worker URL and no domains yet,
 * PUT /bots/:botId/domains with that hostname and save it on LeadBot.
 *   pnpm --filter @moncha/worker domains:backfill -- --dry-run
 *   pnpm --filter @moncha/worker domains:backfill [-- --tenant <id>] [-- --limit <n>]
 */
import './env';
import { Prisma } from '@prisma/client';
import { prisma, PrismaLeadBotRepository } from '@moncha/db';
import { createConsoleLogger, setChatbotDomainsForLiveUrl } from '@moncha/domain';
import { createMonchaInternalClientFromEnv, MonchaInternalError } from '@moncha/integrations';

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
};

async function candidates(tenantId?: string, limit?: number): Promise<Candidate[]> {
  const bots = await prisma.leadBot.findMany({
    where: {
      status: 'created',
      chatbotId: { not: null },
      domains: { equals: Prisma.DbNull },
      ...(tenantId ? { tenantId } : {}),
      lead: {
        siteSnapshots: {
          some: {
            workerStatus: 'deployed',
            workerUrl: { not: null },
          },
        },
      },
    },
    select: {
      tenantId: true,
      leadId: true,
      chatbotId: true,
      lead: {
        select: {
          siteSnapshots: {
            where: { workerStatus: 'deployed', workerUrl: { not: null } },
            orderBy: [{ workerDeployedAt: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { workerUrl: true },
          },
        },
      },
    },
    ...(limit ? { take: limit } : {}),
    orderBy: { createdAt: 'asc' },
  });

  return bots.flatMap((bot) => {
    const workerUrl = bot.lead.siteSnapshots[0]?.workerUrl;
    if (!bot.chatbotId || !workerUrl) return [];
    return [{ tenantId: bot.tenantId, leadId: bot.leadId, chatbotId: bot.chatbotId, workerUrl }];
  });
}

async function main() {
  const client = createMonchaInternalClientFromEnv();
  if (!client) throw new Error('MONCHA_INTERNAL_KEY is not set in apps/worker/.env');

  const dryRun = process.argv.includes('--dry-run');
  const tenantId = arg('--tenant');
  const limitRaw = arg('--limit');
  const limit = limitRaw ? Math.max(1, Number(limitRaw)) : undefined;
  if (limitRaw && !Number.isFinite(limit)) throw new Error(`--limit must be a number (got ${limitRaw})`);

  const list = await candidates(tenantId, limit);
  console.log(
    dryRun
      ? `would set domains for ${list.length} bot(s) (${client.environment})`
      : `setting domains for ${list.length} bot(s) (${client.environment})`,
  );
  if (dryRun || !list.length) return;

  const bots = new PrismaLeadBotRepository(prisma);
  const logger = createConsoleLogger();
  let ok = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of list) {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const result = await setChatbotDomainsForLiveUrl(
          { bots, api: client, logger },
          { tenantId: row.tenantId, leadId: row.leadId, workerUrl: row.workerUrl },
        );
        if (result) {
          ok += 1;
          console.log(`ok ${ok}/${list.length} lead=${row.leadId} domains=${result.domains.join(',')}`);
        } else {
          skipped += 1;
          console.log(`skip lead=${row.leadId} (no bot or bad url)`);
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
        const message = error instanceof Error ? error.message : String(error);
        console.error(`fail lead=${row.leadId} chatbot=${row.chatbotId}: ${message}`);
        break;
      }
    }
    await sleep(150);
  }

  console.log(`done: ok=${ok} skipped=${skipped} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
