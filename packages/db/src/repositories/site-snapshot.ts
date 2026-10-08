import { Prisma, type PrismaClient, type SiteSnapshot } from '@prisma/client';
import type {
  SiteBrand,
  SiteSnapshotListItem,
  SiteSnapshotListQuery,
  SiteSnapshotPatch,
  SiteSnapshotRecord,
  SiteSnapshotRepo,
} from '@moncha/domain';
import { clampPage, clampPageSize, siteStoragePrefix } from '@moncha/domain';
import { mapJob } from './job-run';

const companySelect = { lead: { select: { company: { select: { id: true, name: true, domain: true } } } } } as const;

type RowWithCompany = SiteSnapshot & { lead: { company: { id: string; name: string; domain: string | null } } };

function mapSnapshot(row: SiteSnapshot): SiteSnapshotRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    leadId: row.leadId,
    jobId: row.jobId,
    status: row.status,
    sourceUrl: row.sourceUrl,
    finalUrl: row.finalUrl,
    httpStatus: row.httpStatus,
    storagePrefix: row.storagePrefix,
    sourceHash: row.sourceHash,
    sourceBytes: row.sourceBytes,
    sourceCharset: row.sourceCharset,
    assetCount: row.assetCount,
    skippedAssetCount: row.skippedAssetCount,
    totalBytes: row.totalBytes,
    brand: (row.brand as SiteBrand | null) ?? null,
    llmModel: row.llmModel,
    llmPromptTokens: row.llmPromptTokens,
    llmCompletionTokens: row.llmCompletionTokens,
    warnings: Array.isArray(row.warnings) ? (row.warnings as string[]) : [],
    failureReason: row.failureReason,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
  };
}

function mapListItem(row: RowWithCompany): SiteSnapshotListItem {
  const { lead, ...rest } = row;
  return { ...mapSnapshot(rest), company: lead.company };
}

const jsonOrNull = (value: unknown) => (value === null ? Prisma.JsonNull : (value as Prisma.InputJsonValue));

export class PrismaSiteSnapshotRepository implements SiteSnapshotRepo {
  constructor(private db: PrismaClient) {}

  async createWithJob(input: { tenantId: string; leadId: string; sourceUrl: string; maxAttempts: number }) {
    return this.db.$transaction(async (tx) => {
      const created = await tx.siteSnapshot.create({
        data: { tenantId: input.tenantId, leadId: input.leadId, sourceUrl: input.sourceUrl, storagePrefix: '' },
      });
      const job = await tx.jobRun.create({
        data: {
          tenantId: input.tenantId,
          type: 'site_snapshot',
          payload: { snapshotId: created.id, leadId: input.leadId, url: input.sourceUrl },
          maxAttempts: input.maxAttempts,
          dedupeKey: `site_snapshot:${input.leadId}:${Date.now()}`,
        },
      });
      const snapshot = await tx.siteSnapshot.update({
        where: { id: created.id },
        data: { jobId: job.id, storagePrefix: siteStoragePrefix(input.tenantId, created.id) },
      });
      return { snapshot: mapSnapshot(snapshot), job: mapJob(job) };
    });
  }

  async get(tenantId: string, id: string) {
    const row = await this.db.siteSnapshot.findFirst({ where: { id, tenantId }, include: companySelect });
    return row ? mapListItem(row) : null;
  }

  async update(tenantId: string, id: string, patch: SiteSnapshotPatch) {
    const { brand, warnings, ...rest } = patch;
    const { count } = await this.db.siteSnapshot.updateMany({
      where: { id, tenantId },
      data: {
        ...rest,
        ...(brand !== undefined ? { brand: jsonOrNull(brand) } : {}),
        ...(warnings !== undefined ? { warnings: jsonOrNull(warnings) } : {}),
      },
    });
    if (!count) return null;
    const row = await this.db.siteSnapshot.findUnique({ where: { id } });
    return row ? mapSnapshot(row) : null;
  }

  async findOpenForLead(tenantId: string, leadId: string) {
    const row = await this.db.siteSnapshot.findFirst({
      where: { tenantId, leadId, status: { in: ['pending', 'running'] } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? mapSnapshot(row) : null;
  }

  async listForLead(tenantId: string, leadId: string, limit: number) {
    const rows = await this.db.siteSnapshot.findMany({
      where: { tenantId, leadId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: Math.min(100, Math.max(1, limit)),
    });
    return rows.map(mapSnapshot);
  }

  async list(tenantId: string, query: SiteSnapshotListQuery) {
    const page = clampPage(query.page);
    const pageSize = clampPageSize(query.pageSize);
    const search = query.search?.trim();
    const where: Prisma.SiteSnapshotWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { sourceUrl: { contains: search, mode: 'insensitive' } },
              { lead: { company: { name: { contains: search, mode: 'insensitive' } } } },
              { lead: { company: { domain: { contains: search, mode: 'insensitive' } } } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.db.siteSnapshot.findMany({
        where,
        include: companySelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.siteSnapshot.count({ where }),
    ]);
    return {
      items: rows.map(mapListItem),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }
}
