import type { PrismaClient, ColdEmail as ColdEmailRow } from '@prisma/client';
import type {
  ColdEmailCandidate,
  ColdEmailRecord,
  ColdEmailRepo,
  ColdEmailStatus,
} from '@moncha/domain';
import { clampPage, clampPageSize } from '@moncha/domain';

function mapRow(row: ColdEmailRow): ColdEmailRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    leadId: row.leadId,
    companyName: row.companyName,
    toEmail: row.toEmail,
    deliveredTo: row.deliveredTo,
    demoUrl: row.demoUrl,
    subject: row.subject,
    status: row.status as ColdEmailStatus,
    resendId: row.resendId,
    error: row.error,
    sentAt: row.sentAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaColdEmailRepository implements ColdEmailRepo {
  constructor(private db: PrismaClient) {}

  async list(tenantId: string, opts?: { page?: number; pageSize?: number; status?: ColdEmailStatus }) {
    const page = clampPage(opts?.page);
    const pageSize = clampPageSize(opts?.pageSize);
    const where = {
      tenantId,
      ...(opts?.status ? { status: opts.status } : {}),
    };
    const [total, rows] = await Promise.all([
      this.db.coldEmail.count({ where }),
      this.db.coldEmail.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { items: rows.map(mapRow), total, page, pageSize };
  }

  async get(tenantId: string, id: string) {
    const row = await this.db.coldEmail.findFirst({ where: { id, tenantId } });
    return row ? mapRow(row) : null;
  }

  async create(
    data: Omit<ColdEmailRecord, 'id' | 'createdAt' | 'updatedAt' | 'sentAt' | 'resendId' | 'error' | 'deliveredTo'> & {
      deliveredTo?: string | null;
      resendId?: string | null;
      error?: string | null;
      sentAt?: Date | null;
    },
  ) {
    const row = await this.db.coldEmail.create({
      data: {
        tenantId: data.tenantId,
        leadId: data.leadId,
        companyName: data.companyName,
        toEmail: data.toEmail,
        deliveredTo: data.deliveredTo ?? null,
        demoUrl: data.demoUrl,
        subject: data.subject,
        status: data.status,
        resendId: data.resendId ?? null,
        error: data.error ?? null,
        sentAt: data.sentAt ?? null,
      },
    });
    return mapRow(row);
  }

  async update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<ColdEmailRecord, 'status' | 'resendId' | 'error' | 'sentAt' | 'deliveredTo' | 'subject'>>,
  ) {
    const existing = await this.db.coldEmail.findFirst({ where: { id, tenantId } });
    if (!existing) return null;
    const row = await this.db.coldEmail.update({
      where: { id },
      data: {
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.resendId !== undefined ? { resendId: patch.resendId } : {}),
        ...(patch.error !== undefined ? { error: patch.error } : {}),
        ...(patch.sentAt !== undefined ? { sentAt: patch.sentAt } : {}),
        ...(patch.deliveredTo !== undefined ? { deliveredTo: patch.deliveredTo } : {}),
        ...(patch.subject !== undefined ? { subject: patch.subject } : {}),
      },
    });
    return mapRow(row);
  }

  async listCandidates(tenantId: string, opts?: { page?: number; pageSize?: number; readyOnly?: boolean }) {
    const page = clampPage(opts?.page);
    const pageSize = clampPageSize(opts?.pageSize);

    // Prefer qualified leads that have a company email and a deployed Worker demo URL.
    const leads = await this.db.lead.findMany({
      where: {
        tenantId,
        ...(opts?.readyOnly
          ? {
              company: { email: { not: null } },
              siteSnapshots: { some: { workerStatus: 'deployed', workerUrl: { not: null } } },
            }
          : {}),
      },
      include: {
        company: { select: { id: true, name: true, email: true, domain: true } },
        bot: { select: { knowledgeStatus: true } },
        siteSnapshots: {
          where: { workerStatus: 'deployed', workerUrl: { not: null } },
          orderBy: { workerDeployedAt: 'desc' },
          take: 1,
          select: { workerUrl: true },
        },
        coldEmails: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, status: true, sentAt: true, createdAt: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });

    const total = await this.db.lead.count({
      where: {
        tenantId,
        ...(opts?.readyOnly
          ? {
              company: { email: { not: null } },
              siteSnapshots: { some: { workerStatus: 'deployed', workerUrl: { not: null } } },
            }
          : {}),
      },
    });

    const items: ColdEmailCandidate[] = leads.map((lead) => ({
      leadId: lead.id,
      companyId: lead.company.id,
      companyName: lead.company.name,
      companyEmail: lead.company.email,
      domain: lead.company.domain,
      demoUrl: lead.siteSnapshots[0]?.workerUrl ?? null,
      botTrained: lead.bot?.knowledgeStatus === 'trained',
      lastColdEmail: lead.coldEmails[0]
        ? {
            id: lead.coldEmails[0].id,
            status: lead.coldEmails[0].status as ColdEmailStatus,
            sentAt: lead.coldEmails[0].sentAt,
            createdAt: lead.coldEmails[0].createdAt,
          }
        : null,
    }));

    return { items, total, page, pageSize };
  }
}
