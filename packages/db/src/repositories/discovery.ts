import type { PrismaClient } from '@prisma/client';
import type {
  DiscoveryTargetKey,
  DiscoveryTargetRecord,
  DiscoveryTargetRepo,
  DiscoveryTargetStatus,
  DiscoveryUsageRepo,
} from '@moncha/domain';

const INSERT_CHUNK = 1000;

export class PrismaDiscoveryTargetRepository implements DiscoveryTargetRepo {
  constructor(private db: PrismaClient) {}

  async ensure(key: DiscoveryTargetKey, pairs: Array<{ city: string; keyword: string }>) {
    let inserted = 0;
    for (let i = 0; i < pairs.length; i += INSERT_CHUNK) {
      const chunk = pairs.slice(i, i + INSERT_CHUNK).map((p, j) => ({ ...key, ...p, rank: i + j }));
      const res = await this.db.discoveryTarget.createMany({ data: chunk, skipDuplicates: true });
      inserted += res.count;
    }
    return inserted;
  }

  async nextBatch(
    key: DiscoveryTargetKey,
    limit: number,
    maxAttempts: number,
    filter?: { cities?: string[]; keywords?: string[] },
  ): Promise<DiscoveryTargetRecord[]> {
    return this.db.discoveryTarget.findMany({
      where: {
        ...key,
        OR: [{ status: 'pending' }, { status: 'failed', attempts: { lt: maxAttempts } }],
        ...(filter?.cities ? { city: { in: filter.cities } } : {}),
        ...(filter?.keywords ? { keyword: { in: filter.keywords } } : {}),
      },
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      take: limit,
    });
  }

  async markStarted(id: string) {
    await this.db.discoveryTarget.update({
      where: { id },
      data: { attempts: { increment: 1 }, lastRunAt: new Date() },
    });
  }

  async markDone(id: string, stats: { calls: number; found: number; created: number }) {
    await this.db.discoveryTarget.update({
      where: { id },
      data: { status: 'done', lastError: null, ...stats },
    });
  }

  async markFailed(id: string, error: string, calls: number) {
    await this.db.discoveryTarget.update({
      where: { id },
      data: { status: 'failed', lastError: error.slice(0, 500), calls },
    });
  }

  async counts(key: DiscoveryTargetKey) {
    const rows = await this.db.discoveryTarget.groupBy({ by: ['status'], where: key, _count: { _all: true } });
    const out: Record<DiscoveryTargetStatus, number> = { pending: 0, done: 0, failed: 0 };
    for (const r of rows) out[r.status] = r._count._all;
    return out;
  }

  async reset(key: DiscoveryTargetKey) {
    const res = await this.db.discoveryTarget.updateMany({
      where: key,
      data: { status: 'pending', attempts: 0, lastError: null },
    });
    return res.count;
  }
}

export class PrismaDiscoveryUsageRepository implements DiscoveryUsageRepo {
  constructor(private db: PrismaClient) {}

  async get(tenantId: string, source: string, day: string) {
    const row = await this.db.discoveryUsage.findUnique({
      where: { tenantId_source_day: { tenantId, source, day } },
    });
    return row?.calls ?? 0;
  }

  async add(tenantId: string, source: string, day: string, calls: number) {
    const row = await this.db.discoveryUsage.upsert({
      where: { tenantId_source_day: { tenantId, source, day } },
      create: { tenantId, source, day, calls },
      update: { calls: { increment: calls } },
    });
    return row.calls;
  }
}
