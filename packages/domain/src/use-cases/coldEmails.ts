import type { ColdEmailPayload, Mailer } from '../ports';

export type ColdEmailStatus = 'draft' | 'queued' | 'sent' | 'failed' | 'suppressed';
/** manual (console/API), auto (automation) or test (an allowlisted test inbox, never counts as emailing the lead). */
export type ColdEmailOrigin = 'manual' | 'auto' | 'test';
export type ColdEmailAutomationMode = 'draft' | 'send';

export type ColdEmailAutomationSettings = {
  tenantId: string;
  enabled: boolean;
  mode: ColdEmailAutomationMode;
  dailyCap: number;
  enabledAt: Date | null;
  updatedBy: string | null;
  updatedAt: Date | null;
};

/** A lead whose demo is fully ready and whose business has never been emailed (test sends excluded). */
export type ColdEmailAutoCandidate = {
  leadId: string;
  companyName: string;
  companyEmail: string;
  demoUrl: string;
};

export interface ColdEmailAutomationRepo {
  /** Defaults (off, draft, cap 20) when the tenant has no row yet. */
  get(tenantId: string): Promise<ColdEmailAutomationSettings>;
  update(
    tenantId: string,
    patch: Partial<Pick<ColdEmailAutomationSettings, 'enabled' | 'mode' | 'dailyCap'>>,
    updatedBy: string,
    now: Date,
  ): Promise<ColdEmailAutomationSettings>;
  /** Tenants with automation switched on. */
  listEnabled(): Promise<ColdEmailAutomationSettings[]>;
}

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
  followUpDueDate?: Date | null;
  followUpStatus?: string | null;
  followUpSentAt?: Date | null;
  followUpResendId?: string | null;
  followUpError?: string | null;
  origin: ColdEmailOrigin;
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
  isDevMode: boolean;
  devInboxes: string[];
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
    data: Omit<ColdEmailRecord, 'id' | 'createdAt' | 'updatedAt' | 'sentAt' | 'resendId' | 'error' | 'deliveredTo' | 'origin'> & {
      deliveredTo?: string | null;
      resendId?: string | null;
      error?: string | null;
      sentAt?: Date | null;
      origin?: ColdEmailOrigin;
      followUpDueDate?: Date | null;
      followUpStatus?: string | null;
    },
  ): Promise<ColdEmailRecord>;
  /**
   * Leads ready for an automated email, oldest trained first: bot trained, chatbot installed on the live demo, the
   * bot's domain locked to that demo's host, a company email, and no non-test email to that lead or address yet.
   */
  listAutoReady(tenantId: string, limit: number): Promise<ColdEmailAutoCandidate[]>;
  /** Rows of this origin created at or after `since`. */
  countOriginSince(tenantId: string, origin: ColdEmailOrigin, since: Date): Promise<number>;
  update(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        ColdEmailRecord,
        | 'status'
        | 'resendId'
        | 'error'
        | 'sentAt'
        | 'deliveredTo'
        | 'subject'
        | 'followUpDueDate'
        | 'followUpStatus'
        | 'followUpSentAt'
        | 'followUpResendId'
        | 'followUpError'
      >
    >,
  ): Promise<ColdEmailRecord | null>;
  listDueFollowUps?(tenantId: string, now: Date, limit?: number): Promise<ColdEmailRecord[]>;
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

/** The two approved development inboxes for testing without emailing real customers. */
export const APPROVED_DEV_INBOXES = ['vinothjv4.tech@gmail.com', 'thinaakark2004@gmail.com'] as const;

/**
 * Returns whether cold email is running in development mode (fails closed to true by default).
 * Only returns false if explicitly disabled with COLD_EMAIL_DEV_MODE=false AND NODE_ENV=production.
 */
export function isColdEmailDevMode(env: Record<string, unknown>): boolean {
  const devMode = env.COLD_EMAIL_DEV_MODE;
  if (devMode === 'false' || devMode === false) {
    if (env.NODE_ENV === 'production' && env.COLD_EMAIL_PRODUCTION_CONFIRMED === 'true') {
      return false;
    }
  }
  return true;
}

/**
 * Returns the approved development inboxes from env or defaults to APPROVED_DEV_INBOXES.
 * Validates each email; fails closed if any email is invalid.
 */
export function getColdEmailDevInboxes(env: Record<string, unknown>): string[] {
  const raw = typeof env.COLD_EMAIL_DEV_INBOXES === 'string' ? env.COLD_EMAIL_DEV_INBOXES.trim() : '';
  if (!raw) {
    return [...APPROVED_DEV_INBOXES];
  }
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) {
    return [...APPROVED_DEV_INBOXES];
  }
  for (const email of parts) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ColdEmailError('validation', `Invalid dev inbox configuration: "${email}"`);
    }
  }
  return parts;
}

export function coldEmailGate(deps: Pick<ColdEmailDeps, 'env' | 'mailer' | 'sendingEnabled' | 'parseAllowlist' | 'coldFrom'>): ColdEmailGate {
  const allow = deps.parseAllowlist(asString(deps.env, 'COLD_EMAIL_ALLOWLIST') ?? '');
  const devMode = isColdEmailDevMode(deps.env);
  let devInboxes: string[] = [];
  try {
    devInboxes = getColdEmailDevInboxes(deps.env);
  } catch {
    devInboxes = [...APPROVED_DEV_INBOXES];
  }
  return {
    sendingEnabled: devMode ? true : deps.sendingEnabled(deps.env),
    allowlist: allow.open ? ['*'] : [...allow.emails],
    allowlistOpen: allow.open,
    resendConfigured: Boolean(deps.mailer),
    from: deps.coldFrom ?? asString(deps.env, 'COLD_EMAIL_FROM') ?? asString(deps.env, 'EMAIL_FROM') ?? 'Moncha <support@jobteacher.pro>',
    isDevMode: devMode,
    devInboxes,
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
 * In development mode, deliverTo must be exclusively approved development inboxes.
 * `toEmail` is preserved as the intended company contact.
 */
export async function sendColdEmailNow(
  deps: ColdEmailDeps,
  input: {
    tenantId: string;
    leadId?: string | null;
    companyName: string;
    /** Intended lead/company email (audit). */
    toEmail: string;
    /** Actual Resend recipient(s) — string or array of emails. */
    deliverTo: string | string[];
    demoUrl: string;
    note?: string;
    subject?: string;
    /** Defaults to `test` when in dev mode or deliverTo is not the intended address, else `manual`. */
    origin?: ColdEmailOrigin;
  },
): Promise<ColdEmailRecord> {
  if (!deps.mailer?.sendColdEmail) {
    throw new ColdEmailError('not_configured', 'RESEND_API_KEY is not set');
  }

  const rawList = Array.isArray(input.deliverTo) ? input.deliverTo : (input.deliverTo ?? '').split(',');
  const deliverList = rawList.map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!deliverList.length) throw new ColdEmailError('validation', 'deliverTo is required');
  if (!input.demoUrl.trim()) throw new ColdEmailError('no_demo', 'demoUrl is required');

  const devMode = isColdEmailDevMode(deps.env);
  const devInboxes = getColdEmailDevInboxes(deps.env);

  if (devMode) {
    for (const to of deliverList) {
      if (!devInboxes.includes(to)) {
        throw new ColdEmailError(
          'blocked',
          `Customer email delivery is disabled in development mode. Recipient "${to}" is not an approved development inbox.`,
        );
      }
    }
  } else {
    for (const to of deliverList) {
      if (!deps.isAllowed(to, deps.env)) {
        throw new ColdEmailError(
          'blocked',
          `Cold email sending is disabled or address "${to}" is not on COLD_EMAIL_ALLOWLIST`,
        );
      }
    }
  }

  const content = deps.buildContent({
    companyName: input.companyName,
    demoUrl: input.demoUrl,
    note: input.note,
  });
  const subject = input.subject?.trim() || content.subject;
  const intended = (input.toEmail.trim() || deliverList[0]!).toLowerCase();
  const deliveredToStr = deliverList.join(', ');

  const draft = await deps.coldEmails.create({
    tenantId: input.tenantId,
    leadId: input.leadId ?? null,
    companyName: input.companyName.trim() || 'there',
    toEmail: intended,
    demoUrl: input.demoUrl.trim(),
    subject,
    status: 'queued',
    deliveredTo: deliveredToStr,
    origin: input.origin ?? (devMode || deliverList.some((d) => d !== intended) ? 'test' : 'manual'),
  });

  try {
    const payload: ColdEmailPayload = {
      to: deliverList,
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
      deliveredTo: deliveredToStr,
      error: null,
    });
    return updated ?? { ...draft, status: 'sent', resendId: result.id || null, sentAt: new Date(), deliveredTo: deliveredToStr };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const updated = await deps.coldEmails.update(input.tenantId, draft.id, {
      status: message.includes('cold_email_blocked') ? 'suppressed' : 'failed',
      error: message.slice(0, 500),
      deliveredTo: deliveredToStr,
    });
    if (message.includes('cold_email_blocked')) {
      throw new ColdEmailError('blocked', message);
    }
    throw new ColdEmailError('validation', updated?.error ?? message);
  }
}

/**
 * Sends a saved draft. If deliverToOverride is provided, delivers to those recipients while
 * preserving the draft's original toEmail.
 * In development mode, delivery recipients must be approved dev inboxes.
 */
export async function sendColdEmailDraft(
  deps: ColdEmailDeps,
  input: { tenantId: string; id: string; deliverToOverride?: string | string[] },
): Promise<ColdEmailRecord> {
  const row = await deps.coldEmails.get(input.tenantId, input.id);
  if (!row) throw new ColdEmailError('not_found', 'Cold email not found');
  if (row.status !== 'draft' && row.status !== 'failed') {
    throw new ColdEmailError('validation', `Only drafts and failed emails can be sent (this one is ${row.status})`);
  }
  if (!row.demoUrl) throw new ColdEmailError('no_demo', 'This draft has no demo URL');
  if (!deps.mailer?.sendColdEmail) throw new ColdEmailError('not_configured', 'RESEND_API_KEY is not set');

  const devMode = isColdEmailDevMode(deps.env);
  const devInboxes = getColdEmailDevInboxes(deps.env);

  let deliverList: string[];
  if (input.deliverToOverride) {
    const raw = Array.isArray(input.deliverToOverride) ? input.deliverToOverride : input.deliverToOverride.split(',');
    deliverList = raw.map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (!deliverList.length) throw new ColdEmailError('validation', 'deliverToOverride is empty');
  } else {
    deliverList = [row.toEmail.trim().toLowerCase()];
  }

  if (devMode) {
    for (const to of deliverList) {
      if (!devInboxes.includes(to)) {
        throw new ColdEmailError(
          'blocked',
          `Customer email delivery is disabled in development mode. Recipient "${to}" is not an approved development inbox.`,
        );
      }
    }
  } else {
    for (const to of deliverList) {
      if (!deps.isAllowed(to, deps.env)) {
        throw new ColdEmailError(
          'blocked',
          `Sending to ${to} is not allowed (COLD_EMAIL_SENDING_ENABLED / COLD_EMAIL_ALLOWLIST)`,
        );
      }
    }
  }

  const deliveredToStr = deliverList.join(', ');
  try {
    const result = await deps.mailer.sendColdEmail(
      { to: deliverList, companyName: row.companyName, demoUrl: row.demoUrl, subject: row.subject },
      deps.env,
    );
    const sent = await deps.coldEmails.update(input.tenantId, row.id, {
      status: 'sent',
      resendId: result.id || null,
      sentAt: new Date(),
      deliveredTo: deliveredToStr,
      error: null,
    });
    return sent ?? { ...row, status: 'sent', resendId: result.id || null, sentAt: new Date(), deliveredTo: deliveredToStr };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await deps.coldEmails.update(input.tenantId, row.id, { status: 'failed', error: message, deliveredTo: deliveredToStr });
    throw new ColdEmailError(message.includes('cold_email_blocked') ? 'blocked' : 'validation', message);
  }
}

/** Automated emails per tick, so one pass never takes long or floods. */
export const COLD_EMAIL_AUTOMATION_BATCH = 10;
export const COLD_EMAIL_AUTOMATION_MAX_DAILY_CAP = 500;

export type ColdEmailAutomationOutcome = {
  tenantId: string;
  drafted: number;
  sent: number;
  /** `send` mode, but the address is not allowed: left as a draft. */
  heldAsDraft: number;
  failed: number;
  remainingToday: number;
};

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/**
 * One automation pass for a tenant: for each ready lead (see listAutoReady), within today's cap, a draft addressed to
 * the company. In `send` mode the draft is also sent, but only when the gate allows that address; anything else stays a
 * draft for approval. In development mode, automated sending is disabled; drafts are held for safety. Off (`enabled: false`) does nothing.
 */
export async function runColdEmailAutomation(
  deps: ColdEmailDeps & { logger?: { info(event: string, data?: Record<string, unknown>): void; error(event: string, data?: Record<string, unknown>): void } },
  settings: ColdEmailAutomationSettings,
  now: Date = new Date(),
): Promise<ColdEmailAutomationOutcome> {
  const outcome: ColdEmailAutomationOutcome = { tenantId: settings.tenantId, drafted: 0, sent: 0, heldAsDraft: 0, failed: 0, remainingToday: 0 };
  if (!settings.enabled) return outcome;
  const cap = Math.max(0, Math.min(COLD_EMAIL_AUTOMATION_MAX_DAILY_CAP, settings.dailyCap));
  const used = await deps.coldEmails.countOriginSince(settings.tenantId, 'auto', startOfUtcDay(now));
  const room = Math.max(0, cap - used);
  outcome.remainingToday = room;
  if (!room) return outcome;

  const devMode = isColdEmailDevMode(deps.env);
  const ready = await deps.coldEmails.listAutoReady(settings.tenantId, Math.min(room, COLD_EMAIL_AUTOMATION_BATCH));
  for (const lead of ready) {
    const content = deps.buildContent({ companyName: lead.companyName, demoUrl: lead.demoUrl });
    const draft = await deps.coldEmails.create({
      tenantId: settings.tenantId,
      leadId: lead.leadId,
      companyName: lead.companyName,
      toEmail: lead.companyEmail.trim().toLowerCase(),
      demoUrl: lead.demoUrl,
      subject: content.subject,
      status: 'draft',
      origin: 'auto',
    });
    outcome.drafted += 1;
    outcome.remainingToday -= 1;
    if (settings.mode !== 'send') continue;

    // In development mode, automated sends to customers are strictly blocked
    if (devMode) {
      outcome.heldAsDraft += 1;
      deps.logger?.info('cold_email_automation_held_in_dev_mode', {
        tenantId: settings.tenantId,
        leadId: lead.leadId,
        reason: 'Automated customer sends are disabled in development mode',
      });
      continue;
    }

    if (!deps.mailer?.sendColdEmail || !deps.isAllowed(draft.toEmail, deps.env)) {
      outcome.heldAsDraft += 1;
      continue;
    }
    try {
      await sendColdEmailDraft(deps, { tenantId: settings.tenantId, id: draft.id });
      outcome.sent += 1;
    } catch (err) {
      outcome.failed += 1;
      deps.logger?.error('cold_email_automation_send_failed', {
        tenantId: settings.tenantId,
        leadId: lead.leadId,
        error: (err instanceof Error ? err.message : String(err)).slice(0, 300),
      });
    }
  }
  if (outcome.drafted) deps.logger?.info('cold_email_automation', { ...outcome, mode: settings.mode });
  return outcome;
}
