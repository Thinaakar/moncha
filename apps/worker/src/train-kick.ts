/**
 * Starts MonCha training for created bots that are still `knowledgeStatus=pending` (so live sites can leave
 * "Adding chatbot · not started"). Runs a few discovers in parallel; the worker continues the rest.
 *   pnpm --filter @moncha/worker exec tsx src/train-kick.ts [-- --limit 10] [-- --concurrency 3]
 */
import './env';
import { prisma, PrismaLeadBotRepository } from '@moncha/db';
import { createConsoleLogger, runLeadBotTrainTick } from '@moncha/domain';
import { createMonchaInternalClientFromEnv } from '@moncha/integrations';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const client = createMonchaInternalClientFromEnv();
  if (!client) throw new Error('MONCHA_INTERNAL_KEY is not set in apps/worker/.env');

  const limit = Math.max(1, Number(arg('--limit') || 12));
  const concurrency = Math.max(1, Math.min(5, Number(arg('--concurrency') || 3)));
  const bots = new PrismaLeadBotRepository(prisma);
  const logger = createConsoleLogger();
  const deps = { bots, api: client, logger };

  const pending = await prisma.leadBot.findMany({
    where: { status: 'created', chatbotId: { not: null }, knowledgeStatus: 'pending' },
    select: { tenantId: true, leadId: true },
    orderBy: { createdBotAt: 'asc' },
    take: limit,
  });
  console.log(`kicking ${pending.length} pending trainings (concurrency=${concurrency}, ${client.environment})`);

  let ok = 0;
  let failed = 0;
  let i = 0;
  async function worker() {
    while (i < pending.length) {
      const row = pending[i++]!;
      try {
        const tick = await runLeadBotTrainTick(deps, { tenantId: row.tenantId, leadId: row.leadId });
        if (tick.action === 'idle') {
          console.log(`idle lead=${row.leadId}`);
          continue;
        }
        ok += 1;
        console.log(`ok ${ok} lead=${row.leadId} status=${tick.outcome.status}`);
      } catch (error) {
        failed += 1;
        console.error(`fail lead=${row.leadId}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(`done: ok=${ok} failed=${failed}`);
  if (failed) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
