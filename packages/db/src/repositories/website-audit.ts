import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  PersistAuditInput,
  WebsiteAuditRecord,
  WebsiteAuditRepo,
  WebsiteAuditResult,
} from '@moncha/domain';

function mapAudit(
  row: {
    id: string;
    tenantId: string;
    websiteId: string;
    leadId: string;
    method: WebsiteAuditResult['method'];
    renderRan: boolean;
    llmRan: boolean;
    verdict: WebsiteAuditResult['verdict'];
    kind: WebsiteAuditResult['kind'];
    vendor: string | null;
    confidence: number;
    classifierVersion: string;
    contentHash: string | null;
    failureReason: string | null;
    httpStatus: number | null;
    finalUrl: string | null;
    llmModel: string | null;
    llmPromptVersion: string | null;
    llmResult: unknown;
    llmPromptTokens: number | null;
    llmCompletionTokens: number | null;
    auditedAt: Date;
  },
  websiteStatus: WebsiteAuditResult['websiteStatus'],
  evidence: WebsiteAuditResult['evidence'] = [],
  channels: WebsiteAuditResult['channels'] = [],
): WebsiteAuditRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    websiteId: row.websiteId,
    leadId: row.leadId,
    websiteStatus,
    method: row.method,
    renderRan: row.renderRan,
    llmRan: row.llmRan,
    verdict: row.verdict,
    kind: row.kind,
    vendor: row.vendor ?? undefined,
    confidence: row.confidence,
    classifierVersion: row.classifierVersion,
    contentHash: row.contentHash ?? undefined,
    failureReason: row.failureReason ?? undefined,
    httpStatus: row.httpStatus ?? undefined,
    finalUrl: row.finalUrl ?? undefined,
    llmModel: row.llmModel ?? undefined,
    llmPromptVersion: row.llmPromptVersion ?? undefined,
    llmResult: row.llmResult ?? undefined,
    llmPromptTokens: row.llmPromptTokens ?? undefined,
    llmCompletionTokens: row.llmCompletionTokens ?? undefined,
    auditedAt: row.auditedAt,
    evidence,
    channels,
  };
}

export class PrismaWebsiteAuditRepository implements WebsiteAuditRepo {
  constructor(private db: PrismaClient) {}

  async create(data: PersistAuditInput): Promise<WebsiteAuditRecord> {
    const { result } = data;
    const audit = await this.db.$transaction(async (tx) => {
      const created = await tx.websiteAudit.create({
        data: {
          tenantId: data.tenantId,
          websiteId: data.websiteId,
          leadId: data.leadId,
          method: result.method,
          renderRan: result.renderRan,
          llmRan: result.llmRan,
          verdict: result.verdict,
          kind: result.kind,
          vendor: result.vendor,
          confidence: result.confidence,
          classifierVersion: result.classifierVersion,
          contentHash: result.contentHash,
          failureReason: result.failureReason,
          httpStatus: result.httpStatus,
          finalUrl: result.finalUrl,
          llmModel: result.llmModel,
          llmPromptVersion: result.llmPromptVersion,
          llmResult: result.llmResult as Prisma.InputJsonValue | undefined,
          llmPromptTokens: result.llmPromptTokens,
          llmCompletionTokens: result.llmCompletionTokens,
          auditedAt: result.auditedAt,
          evidenceItems: {
            create: result.evidence.map((item) => ({
              tenantId: data.tenantId,
              type: item.type,
              url: item.url,
              selector: item.selector,
              excerpt: item.excerpt,
              vendor: item.vendor,
              sourcePage: item.sourcePage,
              objectUri: item.objectUri,
              contentHash: item.contentHash,
            })),
          },
          detectedChannels: {
            create: result.channels.map((item) => ({
              tenantId: data.tenantId,
              type: item.type,
              url: item.url,
              selector: item.selector,
              sourcePage: item.sourcePage,
            })),
          },
        },
        include: { evidenceItems: true, detectedChannels: true },
      });
      return created;
    });

    return mapAudit(
      audit,
      result.websiteStatus,
      audit.evidenceItems.map((e) => ({
        type: e.type,
        url: e.url ?? undefined,
        selector: e.selector ?? undefined,
        excerpt: e.excerpt ?? undefined,
        vendor: e.vendor ?? undefined,
        sourcePage: e.sourcePage ?? undefined,
        objectUri: e.objectUri ?? undefined,
        contentHash: e.contentHash ?? undefined,
      })),
      audit.detectedChannels.map((c) => ({
        type: c.type,
        url: c.url,
        selector: c.selector ?? undefined,
        sourcePage: c.sourcePage ?? undefined,
      })),
    );
  }

  async get(tenantId: string, id: string) {
    const row = await this.db.websiteAudit.findFirst({
      where: { id, tenantId },
      include: { evidenceItems: true, detectedChannels: true, website: true },
    });
    if (!row) return null;
    return mapAudit(
      row,
      row.website.status,
      row.evidenceItems.map((e) => ({
        type: e.type,
        url: e.url ?? undefined,
        selector: e.selector ?? undefined,
        excerpt: e.excerpt ?? undefined,
        vendor: e.vendor ?? undefined,
        sourcePage: e.sourcePage ?? undefined,
        objectUri: e.objectUri ?? undefined,
        contentHash: e.contentHash ?? undefined,
      })),
      row.detectedChannels.map((c) => ({
        type: c.type,
        url: c.url,
        selector: c.selector ?? undefined,
        sourcePage: c.sourcePage ?? undefined,
      })),
    );
  }

  async latestForLead(tenantId: string, leadId: string) {
    const row = await this.db.websiteAudit.findFirst({
      where: { tenantId, leadId },
      orderBy: { auditedAt: 'desc' },
      include: { evidenceItems: true, detectedChannels: true, website: true },
    });
    if (!row) return null;
    return mapAudit(
      row,
      row.website.status,
      row.evidenceItems.map((e) => ({
        type: e.type,
        url: e.url ?? undefined,
        selector: e.selector ?? undefined,
        excerpt: e.excerpt ?? undefined,
        vendor: e.vendor ?? undefined,
        sourcePage: e.sourcePage ?? undefined,
        objectUri: e.objectUri ?? undefined,
        contentHash: e.contentHash ?? undefined,
      })),
      row.detectedChannels.map((c) => ({
        type: c.type,
        url: c.url,
        selector: c.selector ?? undefined,
        sourcePage: c.sourcePage ?? undefined,
      })),
    );
  }
}
