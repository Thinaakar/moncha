import type { Prisma, PrismaClient } from '@prisma/client';
import type { CompanyPatch, CompanyRepo, CompanyWrite, SourceWrite } from '@moncha/domain';

export class PrismaCompanyRepository implements CompanyRepo {
  constructor(private db: PrismaClient) {}

  findByDomain(tenantId: string, domain: string) {
    return this.db.company.findUnique({ where: { tenantId_domain: { tenantId, domain } } });
  }

  create(data: CompanyWrite) {
    return this.db.company.create({ data });
  }

  async update(tenantId: string, id: string, data: CompanyPatch) {
    const existing = await this.db.company.findFirst({ where: { id, tenantId } });
    if (!existing) return null;
    return this.db.company.update({ where: { id }, data });
  }

  async upsertSource(data: SourceWrite) {
    const payload = {
      tenantId: data.tenantId,
      companyId: data.companyId,
      source: data.source,
      externalId: data.externalId,
      rawJson: data.rawJson as Prisma.InputJsonValue | undefined,
    };

    if (!data.externalId) {
      return this.db.sourceRecord.create({ data: payload });
    }

    return this.db.sourceRecord.upsert({
      where: {
        tenantId_source_externalId: {
          tenantId: data.tenantId,
          source: data.source,
          externalId: data.externalId,
        },
      },
      create: payload,
      update: {
        companyId: data.companyId,
        rawJson: payload.rawJson,
      },
    });
  }
}
