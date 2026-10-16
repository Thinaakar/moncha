import type { ColdEmailPayload, Mailer } from '../ports';

export type ColdEmailStatus = 'draft' | 'queued' | 'sent' | 'failed' | 'suppressed';

export type ColdEmailRecord = {
  id: string;
  tenantId: string;
  leadId: string | null;
  companyName: string;
  /** Intended company contact (may differ from the address Resend actually delivered to). */
  toEmail: string;
  /** Address Resend was asked to deliver to (allowlist / override). */
  deliveredTo: string | null;
  demoUrl: string | null;
  subject: string;
  status: ColdEmailStatus;
  resendId: string | null;
  error: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ColdEmailCandidate = {
  leadId: string;
  companyId: string;
  companyName: string;
  companyEmail: string | null;
  domain: string | null;
  demoUrl: string | null;
  botTrained: boolean;
  lastColdEmail: {
    id: string;
    status: ColdEmailStatus;
    sentAt: Date | null;
    createdAt: Date;
  } | null;
};

export type ColdEmailGate = {
  sendingEnabled: boolean;
  allowlist: string[];
  allowlistOpen: boolean;
  resendConfigured: boolean;
  from: string;
};

export interface ColdEmailRepo {
  list(tenantId: string, opts?: { page?: number; pageSize?: number; status?: ColdEmailStatus }): Promise<{
    items: ColdEmailRecord[];
    total: number;
    page: number;
    pageSize: number;
  }>;
  get(tenantId: string, id: string): Promise<ColdEmailRecord | null>;
  create(
    data: Omit<ColdEmailRecord, 'id' | 'createdAt' | 'updatedAt' | 'sentAt' | 'resendId' | 'error' | 'deliveredTo'> & {
      deliveredTo?: string | null;
      resendId?: string | null;
      error?: string | null;
      sentAt?: Date | null;
    },
  ): Promise<ColdEmailRecord>;
  update(
    tenantId: string,
    id: string,
    patch: Partial<Pick<ColdEmailRecord, 'status' | 'resendId' | 'error' | 'sentAt' | 'deliveredTo' | 'subject'>>,
  ): Promise<ColdEmailRecord | null>;
  listCandidates(
    tenantId: string,
    opts?: { page?: number; pageSize?: number; readyOnly?: boolean },
  ): Promise<{ items: ColdEmailCandidate[]; total: number; page: number; pageSize: number }>;
}

export class ColdEmailError extends Error {
  constructor(
    public code: 'not_found' | 'blocked' | 'not_configured' | 'no_demo' | 'validation',
    message: string,
  ) {
    super(message);
    this.name = 'ColdEmailError';
  }
}

export type ColdEmailDeps = {
  coldEmails: ColdEmailRepo;
  mailer: Mailer | null;
  env: Record<string, unknown>;
  isAllowed: (to: string, env: Record<string, unknown>) => boolean;
  sendingEnabled: (env: Record<string, unknown>) => boolean;
  parseAllowlist: (raw: string | undefined | null) => { open: boolean; emails: Set<string> };
  buildContent: (input: { companyName: string; demoUrl: string; note?: string }) => {
    subject: string;
    text: string;
    html: string;
  };
  coldFrom?: string;
};

function asString(env: Record<string, unknown>, key: string): string | undefined {
  const v = env[key];
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function coldEmailGate(deps: Pick<ColdEmailDeps, 'env' | 'mailer' | 'sendingEnabled' | 'parseAllowlist' | 'coldFrom'>): ColdEmailGate {
  const allow = deps.parseAllowlist(asString(deps.env, 'COLD_EMAIL_ALLOWLIST') ?? '');
  return {
    sendingEnabled: deps.sendingEnabled(deps.env),
    allowlist: allow.open ? ['*'] : [...allow.emails],
    allowlistOpen: allow.open,
    resendConfigured: Boolean(deps.mailer),
    from: deps.coldFrom ?? asString(deps.env, 'COLD_EMAIL_FROM') ?? asString(deps.env, 'EMAIL_FROM') ?? 'MonCha <noreply@dev-moncha.com>',
  };
}

export function previewColdEmail(
  deps: Pick<ColdEmailDeps, 'buildContent'>,
  input: { companyName: string; demoUrl: string; note?: string },
) {
  if (!input.demoUrl.trim()) throw new ColdEmailError('validation', 'demoUrl is required');
  return deps.buildContent({
    companyName: input.companyName.trim() || 'there',
    demoUrl: input.demoUrl.trim(),
    note: input.note,
  });
}

/** Create a draft row without calling Resend. */
export async function createColdEmailDraft(
  deps: Pick<ColdEmailDeps, 'coldEmails'>,
  input: {
    tenantId: string;
    leadId?: string | null;
    companyName: string;
    toEmail: string;
    demoUrl: string;
    subject: string;
  },
): Promise<ColdEmailRecord> {
  if (!input.toEmail.trim()) throw new ColdEmailError('validation', 'toEmail is required');
  if (!input.demoUrl.trim()) throw new ColdEmailError('validation', 'demoUrl is required');
  return deps.coldEmails.create({
    tenantId: input.tenantId,
    leadId: input.leadId ?? null,
    companyName: input.companyName.trim() || 'there',
    toEmail: input.toEmail.trim().toLowerCase(),
    demoUrl: input.demoUrl.trim(),
    subject: input.subject.trim() || `We built a MonCha support demo for ${input.companyName}`,
    status: 'draft',
  });
}

/**
 * Send a cold email. Delivery address must pass the allowlist gate.
 * `to` is the Resend recipient (often the allowlisted demo inbox during development).
 * `recordToEmail` is stored as the intended company contact when different.
 */
export async function sendColdEmailNow(
  deps: ColdEmailDeps,
  input: {
    tenantId: string;
    leadId?: string | null;
    companyName: string;
    /** Intended lead/company email (audit). */
    toEmail: string;
    /** Actual Resend recipient — must be allowlisted. */
    deliverTo: string;
    demoUrl: string;
    note?: string;
    subject?: string;
  },
): Promise<ColdEmailRecord> {
  if (!deps.mailer?.sendColdEmail) {
    throw new ColdEmailError('not_configured', 'RESEND_API_KEY is not set');
  }
  const deliverTo = input.deliverTo.trim().toLowerCase();
  if (!deliverTo) throw new ColdEmailError('validation', 'deliverTo is required');
  if (!input.demoUrl.trim()) throw new ColdEmailError('no_demo', 'demoUrl is required');
  if (!deps.isAllowed(deliverTo, deps.env)) {
    throw new ColdEmailError(
      'blocked',
      'Cold email sending is disabled or this address is not on COLD_EMAIL_ALLOWLIST',
    );
  }

  const content = deps.buildContent({
    companyName: input.companyName,
    demoUrl: input.demoUrl,
    note: input.note,
  });
  const subject = input.subject?.trim() || content.subject;
  const intended = (input.toEmail.trim() || deliverTo).toLowerCase();

  const draft = await deps.coldEmails.create({
    tenantId: input.tenantId,
    leadId: input.leadId ?? null,
    companyName: input.companyName.trim() || 'there',
    toEmail: intended,
    demoUrl: input.demoUrl.trim(),
    subject,
    status: 'queued',
    deliveredTo: deliverTo,
  });

  try {
    const payload: ColdEmailPayload = {
      to: deliverTo,
      companyName: input.companyName,
      demoUrl: input.demoUrl,
      note: input.note,
      subject,
    };
    const result = await deps.mailer.sendColdEmail(payload, deps.env);
    const updated = await deps.coldEmails.update(input.tenantId, draft.id, {
      status: 'sent',
      resendId: result.id || null,
      sentAt: new Date(),
      deliveredTo: deliverTo,
      error: null,
    });
    return updated ?? { ...draft, status: 'sent', resendId: result.id || null, sentAt: new Date(), deliveredTo: deliverTo };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = await deps.coldEmails.update(input.tenantId, draft.id, {
      status: message.includes('cold_email_blocked') ? 'suppressed' : 'failed',
      error: message.slice(0, 500),
      deliveredTo: deliverTo,
    });
    if (message.includes('cold_email_blocked')) {
      throw new ColdEmailError('blocked', message);
    }
    throw new ColdEmailError('validation', updated?.error ?? message);
  }
}
