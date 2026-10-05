import type { Prisma, PrismaClient } from '@prisma/client';
import type { ReviewTaskListQuery, ReviewTaskRepo } from '@moncha/domain';
import { clampPage, clampPageSize } from '@moncha/domain';

const listInclude = {
  lead: { include: { company: { include: { website: true } } } },
  audit: {
    select: {
      id: true,
      method: true,
      verdict: true,
      kind: true,
      vendor: true,
      confidence: true,
      classifierVersion: true,
      failureReason: true,
      finalUrl: true,
      auditedAt: true,
    },
  },
} as const;

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
    const { count } = await this.db.reviewTask.updateMany({
      where: { id, tenantId, status: 'open' },
      data: {
        status: 'resolved',
        resolvedBy: data.resolvedBy,
        resolutionNote: data.resolutionNote,
        resolvedAt: new Date(),
      },
    });
    return count > 0;
  }

  async findOpenForLead(tenantId: string, leadId: string) {
    const row = await this.db.reviewTask.findFirst({
      where: { tenantId, leadId, status: 'open' },
    });
    return row ? { id: row.id, reason: row.reason } : null;
  }

  get(tenantId: string, id: string) {
    return this.db.reviewTask.findFirst({ where: { id, tenantId } });
  }

  async list(tenantId: string, query: ReviewTaskListQuery) {
    const search = query.search?.trim();
    const country = query.country?.trim();
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);
    const where: Prisma.ReviewTaskWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(search || country
        ? {
            lead: {
              company: {
                ...(country ? { country } : {}),
                ...(search
                  ? {
                      OR: [
                        { name: { contains: search, mode: 'insensitive' } },
                        { domain: { contains: search, mode: 'insensitive' } },
                      ],
                    }
                  : {}),
              },
            },
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.db.reviewTask.findMany({
        where,
        include: listInclude,
        skip: (page - 1) * pageSize,
        take: pageSize,
        // Open tasks work as a FIFO queue; history reads newest first.
        orderBy: query.status === 'open' ? [{ createdAt: 'asc' }, { id: 'asc' }] : [{ createdAt: 'desc' }, { id: 'desc' }],
      }),
      this.db.reviewTask.count({ where }),
    ]);
    return { items, total, page, pageSize, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
  }
}
