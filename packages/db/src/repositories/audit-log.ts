import type { Prisma, PrismaClient } from '@prisma/client';
import type { AuditLogRepo } from '@moncha/domain';

export class PrismaAuditLogRepository implements AuditLogRepo {
  constructor(private db: PrismaClient) {}

  async append(data: {
    tenantId: string;
    leadId?: string;
    entityType: string;
    entityId: string;
    action: string;
    actorId?: string;
    note?: string;
    before?: unknown;
    after?: unknown;
  }) {
    await this.db.auditLog.create({
      data: {
        tenantId: data.tenantId,
        leadId: data.leadId,
        entityType: data.entityType,
        entityId: data.entityId,
        action: data.action,
        actorId: data.actorId,
        note: data.note,
        before: data.before as Prisma.InputJsonValue | undefined,
        after: data.after as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
