import type { LeadListQuery, LeadQueue } from '@moncha/domain';
import { clampPage, clampPageSize } from '@moncha/domain';
import type { Prisma } from '@prisma/client';

export function leadListWhere(tenantId: string, query: LeadListQuery): Prisma.LeadWhereInput {
  const search = query.search?.trim();
  const country = query.country?.trim();
  const queue = query.queue as LeadQueue | undefined;
  const vendor = query.vendor?.trim();
  const verdict = query.assistantVerdict;

  const where: Prisma.LeadWhereInput = {
    tenantId,
    ...(queue ? { queue } : {}),
    ...(verdict ? { assistantVerdict: verdict } : {}),
    ...(vendor ? { assistantVendor: { equals: vendor, mode: 'insensitive' } } : {}),
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
  };

  if (query.method) {
    // Match leads whose latest audit used this method (latestAuditId points at that row).
    where.websiteAudits = {
      some: {
        method: query.method,
        // correlated via latestAuditId when listing — repo post-filters if needed
      },
    };
  }

  return where;
}

export function leadListPagination(query: LeadListQuery) {
  const page = clampPage(query.page);
  const pageSize = clampPageSize(query.pageSize);
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}
