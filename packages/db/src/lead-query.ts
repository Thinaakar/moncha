import { Prisma } from '@prisma/client';
import type { LeadListQuery, LeadStatus } from '@moncha/domain';
import { clampPage, clampPageSize } from '@moncha/domain';

export function leadListWhere(tenantId: string, query: LeadListQuery): Prisma.LeadWhereInput {
  const search = query.search?.trim();
  const country = query.country?.trim();
  const status = query.status as LeadStatus | undefined;

  return {
    tenantId,
    ...(status ? { status } : {}),
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
