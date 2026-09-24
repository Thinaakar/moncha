import type { PrismaClient } from '@prisma/client';
import type { ReviewTaskRepo } from '@moncha/domain';

export class PrismaReviewTaskRepository implements ReviewTaskRepo {
  constructor(private db: PrismaClient) {}

  async open(data: { tenantId: string; leadId: string; auditId: string; reason: string }) {
    const existing = await this.findOpenForLead(data.tenantId, data.leadId);
    if (existing) return existing;
    const created = await this.db.reviewTask.create({
      data: {
        tenantId: data.tenantId,
        leadId: data.leadId,
        auditId: data.auditId,
        reason: data.reason,
        status: 'open',
      },
    });
    return { id: created.id };
  }

  async resolve(tenantId: string, id: string, data: { resolvedBy: string; resolutionNote: string }) {
    await this.db.reviewTask.updateMany({
      where: { id, tenantId, status: 'open' },
      data: {
        status: 'resolved',
        resolvedBy: data.resolvedBy,
        resolutionNote: data.resolutionNote,
        resolvedAt: new Date(),
      },
    });
  }

  async findOpenForLead(tenantId: string, leadId: string) {
    const row = await this.db.reviewTask.findFirst({
      where: { tenantId, leadId, status: 'open' },
    });
    return row ? { id: row.id, reason: row.reason } : null;
  }
}
