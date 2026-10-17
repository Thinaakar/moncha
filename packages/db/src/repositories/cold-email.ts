import type { PrismaClient, ColdEmail as ColdEmailRow, ColdEmailAutomationSettings as AutomationRow } from '@prisma/client';
import type {
  ColdEmailAutoCandidate,
  ColdEmailAutomationMode,
  ColdEmailAutomationRepo,
  ColdEmailAutomationSettings,
  ColdEmailCandidate,
  ColdEmailOrigin,
  ColdEmailRecord,
  ColdEmailRepo,
  ColdEmailStatus,
} from '@moncha/domain';
import { clampPage, clampPageSize } from '@moncha/domain';

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

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
    origin: row.origin as ColdEmailOrigin,
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

  async listAutoReady(tenantId: string, limit: number): Promise<ColdEmailAutoCandidate[]> {
    if (limit <= 0) return [];
    const live = { workerStatus: 'deployed', workerUrl: { not: null } } as const;
    const leads = await this.db.lead.findMany({
      where: {
        tenantId,
        company: { email: { not: null } },
        bot: { status: 'created', knowledgeStatus: 'trained' },
        siteSnapshots: { some: { ...live, chatbotStatus: 'installed' } },
        coldEmails: { none: { origin: { not: 'test' } } },
      },
      select: {
        id: true,
        company: { select: { name: true, email: true } },
        bot: { select: { domains: true } },
        siteSnapshots: {
          where: live,
          orderBy: [{ workerDeployedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: { workerUrl: true, chatbotStatus: true },
        },
      },
      orderBy: { bot: { trainedAt: 'asc' } },
      take: Math.max(limit * 5, 50),
    });

    const ready = leads.flatMap((lead) => {
      const live = lead.siteSnapshots[0];
      const email = lead.company.email?.trim().toLowerCase();
      const host = live?.workerUrl ? hostOf(live.workerUrl) : null;
      const domains = Array.isArray(lead.bot?.domains) ? (lead.bot!.domains as unknown[]).map((d) => String(d).toLowerCase()) : [];
      // The newest live copy must have the chatbot, and the bot must be locked to that copy's host.
      if (!email || !live?.workerUrl || live.chatbotStatus !== 'installed' || !host || !domains.includes(host)) return [];
      return [{ leadId: lead.id, companyName: lead.company.name, companyEmail: email, demoUrl: live.workerUrl }];
    });
    if (!ready.length) return [];

    // Never email the same business address twice, even from another lead.
    const emailed = await this.db.coldEmail.findMany({
      where: { tenantId, origin: { not: 'test' }, toEmail: { in: ready.map((r) => r.companyEmail) } },
      select: { toEmail: true },
    });
    const taken = new Set(emailed.map((e) => e.toEmail.toLowerCase()));
    const out: ColdEmailAutoCandidate[] = [];
    for (const r of ready) {
      if (taken.has(r.companyEmail)) continue;
      taken.add(r.companyEmail);
      out.push(r);
      if (out.length >= limit) break;
    }
    return out;
  }

  countOriginSince(tenantId: string, origin: ColdEmailOrigin, since: Date) {
    return this.db.coldEmail.count({ where: { tenantId, origin, createdAt: { gte: since } } });
  }

  async create(
    data: Omit<ColdEmailRecord, 'id' | 'createdAt' | 'updatedAt' | 'sentAt' | 'resendId' | 'error' | 'deliveredTo' | 'origin'> & {
      deliveredTo?: string | null;
      resendId?: string | null;
      error?: string | null;
      sentAt?: Date | null;
      origin?: ColdEmailOrigin;
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
        origin: data.origin ?? 'manual',
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

function mapSettings(tenantId: string, row: AutomationRow | null): ColdEmailAutomationSettings {
  return {
    tenantId,
    enabled: row?.enabled ?? false,
    mode: (row?.mode === 'send' ? 'send' : 'draft') as ColdEmailAutomationMode,
    dailyCap: row?.dailyCap ?? 20,
    enabledAt: row?.enabledAt ?? null,
    updatedBy: row?.updatedBy ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

export class PrismaColdEmailAutomationRepository implements ColdEmailAutomationRepo {
  constructor(private db: PrismaClient) {}

  async get(tenantId: string) {
    return mapSettings(tenantId, await this.db.coldEmailAutomationSettings.findUnique({ where: { tenantId } }));
  }

  async update(
    tenantId: string,
    patch: Partial<Pick<ColdEmailAutomationSettings, 'enabled' | 'mode' | 'dailyCap'>>,
    updatedBy: string,
    now: Date,
  ) {
    const current = await this.db.coldEmailAutomationSettings.findUnique({ where: { tenantId } });
    const turningOn = patch.enabled === true && !current?.enabled;
    const data = {
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.mode !== undefined ? { mode: patch.mode } : {}),
      ...(patch.dailyCap !== undefined ? { dailyCap: patch.dailyCap } : {}),
      ...(turningOn ? { enabledAt: now } : {}),
      updatedBy,
    };
    const row = await this.db.coldEmailAutomationSettings.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
    });
    return mapSettings(tenantId, row);
  }

  async listEnabled() {
    const rows = await this.db.coldEmailAutomationSettings.findMany({ where: { enabled: true } });
    return rows.map((r) => mapSettings(r.tenantId, r));
  }
}
