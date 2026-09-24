import type { PrismaClient } from '@prisma/client';
import type { WebsiteRepo, WebsiteUpsert } from '@moncha/domain';

export class PrismaWebsiteRepository implements WebsiteRepo {
  constructor(private db: PrismaClient) {}

  async upsert(data: WebsiteUpsert) {
    const company = await this.db.company.findFirst({
      where: { id: data.companyId, tenantId: data.tenantId },
    });
    if (!company) {
      throw new Error('Company not found for tenant');
    }

    return this.db.website.upsert({
      where: { companyId: data.companyId },
      create: {
        tenantId: data.tenantId,
        companyId: data.companyId,
        url: data.url,
        status: data.status ?? 'UNCHECKED',
        canonicalUrl: data.canonicalUrl ?? undefined,
        language: data.language ?? undefined,
        finalUrl: data.finalUrl ?? undefined,
        httpStatus: data.httpStatus ?? undefined,
        title: data.title ?? undefined,
        latestAuditId: data.latestAuditId ?? undefined,
        lastCheckedAt: data.lastCheckedAt ?? undefined,
      },
      update: {
        url: data.url,
        status: data.status,
        canonicalUrl: data.canonicalUrl,
        language: data.language,
        finalUrl: data.finalUrl,
        httpStatus: data.httpStatus,
        title: data.title,
        latestAuditId: data.latestAuditId,
        lastCheckedAt: data.lastCheckedAt,
        tenantId: data.tenantId,
      },
    });
  }

  getByCompany(tenantId: string, companyId: string) {
    return this.db.website.findFirst({ where: { tenantId, companyId } });
  }

  async applyAuditPointers(
    tenantId: string,
    websiteId: string,
    data: {
      status: WebsiteUpsert['status'] & string;
      canonicalUrl?: string | null;
      language?: string | null;
      finalUrl?: string | null;
      httpStatus?: number | null;
      title?: string | null;
      latestAuditId: string;
      lastCheckedAt: Date;
    },
  ) {
    const existing = await this.db.website.findFirst({ where: { id: websiteId, tenantId } });
    if (!existing) return null;
    return this.db.website.update({
      where: { id: websiteId },
      data: {
        status: data.status as never,
        canonicalUrl: data.canonicalUrl,
        language: data.language,
        finalUrl: data.finalUrl,
        httpStatus: data.httpStatus,
        title: data.title,
        latestAuditId: data.latestAuditId,
        lastCheckedAt: data.lastCheckedAt,
      },
    });
  }
}
