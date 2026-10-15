/**
 * Queues a MonCha demo bot for every lead whose website is already live and has no bot yet. The worker creates them
 * one at a time (bots of leads whose copy waits go first).
 *   pnpm --filter @moncha/worker bots:backfill -- --dry-run   (only counts)
 *   pnpm --filter @moncha/worker bots:backfill [-- --tenant <id>]
 */
import './env';
import { prisma, PrismaLeadBotRepository } from '@moncha/db';
import { createMonchaInternalClientFromEnv } from '@moncha/integrations';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const client = createMonchaInternalClientFromEnv();
  if (!client) throw new Error('MONCHA_INTERNAL_KEY is not set in apps/worker/.env');
  const dryRun = process.argv.includes('--dry-run');
  const tenantId = arg('--tenant');
  const bots = new PrismaLeadBotRepository(prisma);
  const count = await bots.queueForLiveWebsites(client.environment, { tenantId, dryRun });
  console.log(dryRun ? `live websites without a bot: ${count}` : `bots queued (${client.environment}): ${count}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
