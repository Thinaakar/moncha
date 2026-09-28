import type { Prisma, PrismaClient } from '@prisma/client';
import type { HostAuditCacheRepo, WebsiteAuditResult } from '@moncha/domain';

function stripArtifacts(result: WebsiteAuditResult): WebsiteAuditResult {
  const { artifacts: _a, ...rest } = result;
  return rest;
}

export class PrismaHostAuditCacheRepository implements HostAuditCacheRepo {
  constructor(private db: PrismaClient) {}

  async get(tenantId: string, host: string, classifierVersion: string) {
    const row = await this.db.hostAuditCache.findUnique({
      where: {
        tenantId_host_classifierVersion: { tenantId, host, classifierVersion },
      },
    });
    if (!row) return null;
    return {
      tenantId: row.tenantId,
      host: row.host,
      classifierVersion: row.classifierVersion,
      result: row.resultJson as unknown as WebsiteAuditResult,
      auditedAt: row.auditedAt,
    };
  }

  async put(input: {
    tenantId: string;
    host: string;
    classifierVersion: string;
    result: WebsiteAuditResult;
  }) {
    const resultJson = stripArtifacts(input.result) as unknown as Prisma.InputJsonValue;
    await this.db.hostAuditCache.upsert({
      where: {
        tenantId_host_classifierVersion: {
          tenantId: input.tenantId,
          host: input.host,
          classifierVersion: input.classifierVersion,
        },
      },
      create: {
        tenantId: input.tenantId,
        host: input.host,
        classifierVersion: input.classifierVersion,
        resultJson,
        auditedAt: new Date(),
      },
      update: {
        resultJson,
        auditedAt: new Date(),
      },
    });
  }
}
