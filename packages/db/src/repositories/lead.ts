import type { PrismaClient } from '@prisma/client';
import type {
  LeadCreate,
  LeadListQuery,
  LeadQualificationPatch,
  LeadRepo,
  QueueCounts,
} from '@moncha/domain';
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

  create(data: LeadCreate) {
    return this.db.lead.create({
      data: {
        tenantId: data.tenantId,
        companyId: data.companyId,
        queue: data.queue,
        assistantVerdict: data.assistantVerdict ?? undefined,
        qualificationReason: data.qualificationReason ?? undefined,
      },
    });
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
    let items = await this.db.lead.findMany({
      where,
      include: leadInclude,
      skip,
      take: query.method ? take * 3 : take,
      orderBy: { createdAt: 'desc' },
    });

    if (query.method) {
      items = items
        .filter((lead) => {
          if (!lead.latestAuditId) return false;
          // method filter is approximate via websiteAudits.some; tighten to latestAuditId
          return true;
        })
        .slice(0, take);
    }

    const total = await this.db.lead.count({ where });
    return {
      items,
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async applyQualification(tenantId: string, leadId: string, data: LeadQualificationPatch) {
    const existing = await this.db.lead.findFirst({
      where: { id: leadId, tenantId, version: data.expectedVersion },
    });
    if (!existing) return null;

    return this.db.lead.update({
      where: { id: leadId },
      data: {
        queue: data.queue,
        assistantVerdict: data.assistantVerdict,
        assistantVendor: data.assistantVendor ?? null,
        qualificationReason: data.qualificationReason,
        ...(data.latestAuditId !== undefined ? { latestAuditId: data.latestAuditId } : {}),
        version: { increment: 1 },
      },
    });
  }

  async queueCounts(tenantId: string): Promise<QueueCounts> {
    const groups = await this.db.lead.groupBy({
      by: ['queue'],
      where: { tenantId },
      _count: { _all: true },
    });
    const counts: QueueCounts = {
      PENDING_AUDIT: 0,
      QUALIFIED: 0,
      HAS_ASSISTANT: 0,
      NO_WEBSITE: 0,
      NEEDS_REVIEW: 0,
      INACTIVE: 0,
      openReviewTasks: 0,
    };
    for (const row of groups) {
      counts[row.queue] = row._count._all;
    }
    counts.openReviewTasks = await this.db.reviewTask.count({
      where: { tenantId, status: 'open' },
    });
    return counts;
  }
}
