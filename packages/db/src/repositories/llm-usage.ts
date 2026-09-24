import type { PrismaClient } from '@prisma/client';
import type { LlmUsageRepo } from '@moncha/domain';

export class PrismaLlmUsageRepository implements LlmUsageRepo {
  constructor(private db: PrismaClient) {}

  async increment(tenantId: string, day: string, opts: { failed: boolean }) {
    const row = await this.db.llmUsage.upsert({
      where: { tenantId_day: { tenantId, day } },
      create: {
        tenantId,
        day,
        calls: 1,
        failedCalls: opts.failed ? 1 : 0,
      },
      update: {
        calls: { increment: 1 },
        ...(opts.failed ? { failedCalls: { increment: 1 } } : {}),
      },
    });
    return { calls: row.calls, failedCalls: row.failedCalls };
  }

  async get(tenantId: string, day: string) {
    const row = await this.db.llmUsage.findUnique({
      where: { tenantId_day: { tenantId, day } },
    });
    return row ? { calls: row.calls, failedCalls: row.failedCalls } : null;
  }
}
