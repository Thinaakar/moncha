import type { PrismaClient } from '@prisma/client';
import type { WebsiteRepo } from '@moncha/domain';

export class PrismaWebsiteRepository implements WebsiteRepo {
  constructor(private db: PrismaClient) {}

  async upsert(data: {
    tenantId: string;
    companyId: string;
    url: string;
    reachable?: boolean | null;
    finalUrl?: string | null;
    httpStatus?: number | null;
    title?: string | null;
    lastCheckedAt?: Date | null;
  }) {
    const company = await this.db.company.findFirst({
      where: { id: data.companyId, tenantId: data.tenantId },
    });
    if (!company) {
      throw new Error('Company not found for tenant');
    }

    return this.db.website.upsert({
      where: { companyId: data.companyId },
      create: data,
      update: {
        url: data.url,
        reachable: data.reachable,
        finalUrl: data.finalUrl,
        httpStatus: data.httpStatus,
        title: data.title,
        lastCheckedAt: data.lastCheckedAt,
        tenantId: data.tenantId,
      },
    });
  }
}
