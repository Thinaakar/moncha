import type { Prisma, PrismaClient } from '@prisma/client';
import type { JobPatch, JobRepo, JobType } from '@moncha/domain';

export class PrismaJobRunRepository implements JobRepo {
  constructor(private db: PrismaClient) {}

  create(tenantId: string, type: JobType, inputJson: unknown) {
    return this.db.jobRun.create({
      data: {
        tenantId,
        type,
        inputJson: inputJson as Prisma.InputJsonValue,
      },
    });
  }

  async update(tenantId: string, id: string, data: JobPatch) {
    const existing = await this.db.jobRun.findFirst({ where: { id, tenantId } });
    if (!existing) return null;
    return this.db.jobRun.update({
      where: { id },
      data: {
        status: data.status,
        error: data.error,
        resultJson: data.resultJson as Prisma.InputJsonValue | undefined,
        startedAt: data.startedAt ?? undefined,
        finishedAt: data.finishedAt ?? undefined,
      },
    });
  }

  get(tenantId: string, id: string) {
    return this.db.jobRun.findFirst({ where: { tenantId, id } });
  }

  list(tenantId: string) {
    return this.db.jobRun.findMany({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
  }
}
