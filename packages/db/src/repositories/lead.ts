import type { PrismaClient } from '@prisma/client';
import type { LeadListQuery, LeadRepo, LeadStatus } from '@moncha/domain';
import { leadListPagination, leadListWhere } from '../lead-query';

const leadInclude = {
  company: {
    include: {
      website: true,
      sourceRecords: true,
    },
  },
} as const;

export class PrismaLeadRepository implements LeadRepo {
  constructor(private db: PrismaClient) {}

  create(data: { tenantId: string; companyId: string; status: LeadStatus }) {
    return this.db.lead.create({ data });
  }

  findByCompany(tenantId: string, companyId: string) {
    return this.db.lead.findUnique({ where: { tenantId_companyId: { tenantId, companyId } } });
  }

  get(tenantId: string, id: string) {
    return this.db.lead.findFirst({ where: { id, tenantId }, include: leadInclude });
  }

  async list(tenantId: string, query: LeadListQuery) {
    const where = leadListWhere(tenantId, query);
    const { page, pageSize, skip, take } = leadListPagination(query);
    const [items, total] = await Promise.all([
      this.db.lead.findMany({
        where,
        include: leadInclude,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.lead.count({ where }),
    ]);
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }
}
