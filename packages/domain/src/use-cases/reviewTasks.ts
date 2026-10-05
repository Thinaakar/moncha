import type {
  AssistantVerdict,
  AuditLogRepo,
  LeadQueue,
  LeadRecord,
  LeadRepo,
  Logger,
  ReviewAction,
  ReviewTaskListQuery,
  ReviewTaskListResult,
  ReviewTaskRepo,
} from '../ports';

export type ReviewErrorCode = 'validation_error' | 'not_found' | 'conflict';

const STATUS_BY_CODE: Record<ReviewErrorCode, number> = { validation_error: 400, not_found: 404, conflict: 409 };

/** Carries an HTTP-style code/status so API routes can map it without knowing the use case. */
export class ReviewError extends Error {
  readonly status: number;
  constructor(
    readonly code: ReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ReviewError';
    this.status = STATUS_BY_CODE[code];
  }
}

export type ReauditJob = { id: string; status: string; deduped?: boolean };

export type ReviewDeps = {
  reviewTasks: ReviewTaskRepo;
  leads: LeadRepo;
  auditLogs: AuditLogRepo;
  /** Queues a forced website audit for the lead (or returns the one already queued). */
  requestReaudit: (tenantId: string, leadId: string) => Promise<ReauditJob>;
  logger?: Logger;
};

export type ResolveReviewInput = {
  tenantId: string;
  id: string;
  action: ReviewAction;
  note: string;
  vendor?: string;
  resolvedBy: string;
};

export type ResolveReviewResult = {
  review: { id: string; status: 'resolved'; action: ReviewAction; resolvedBy: string; resolutionNote: string };
  lead: {
    id: string;
    queue: LeadQueue;
    assistantVerdict: AssistantVerdict | null;
    assistantVendor: string | null;
    qualificationReason: string | null;
  };
  job: ReauditJob | null;
};

type LeadDecision = {
  queue: LeadQueue;
  assistantVerdict: AssistantVerdict;
  assistantVendor: string | null;
  qualificationReason: string;
};

const MAX_LEAD_UPDATE_ATTEMPTS = 3;

export function listReviewTasks(
  deps: Pick<ReviewDeps, 'reviewTasks'>,
  input: { tenantId: string } & ReviewTaskListQuery,
): Promise<ReviewTaskListResult> {
  const { tenantId, ...query } = input;
  return deps.reviewTasks.list(tenantId, query);
}

function decisionFor(action: Exclude<ReviewAction, 'request_reaudit'>, lead: LeadRecord, vendor?: string): LeadDecision {
  if (action === 'confirm_no_assistant') {
    return {
      queue: 'QUALIFIED',
      assistantVerdict: 'NO_ASSISTANT',
      assistantVendor: null,
      qualificationReason: 'review_confirmed_no_assistant',
    };
  }
  return {
    queue: 'HAS_ASSISTANT',
    assistantVerdict: 'HAS_ASSISTANT',
    assistantVendor: vendor ?? lead.assistantVendor ?? null,
    qualificationReason: 'review_marked_has_assistant',
  };
}

/** The reviewer's decision wins over a concurrent audit write, so retry on a stale lead version. */
async function applyDecision(deps: ReviewDeps, tenantId: string, lead: LeadRecord, decision: LeadDecision) {
  let current: LeadRecord | null = lead;
  for (let attempt = 0; attempt < MAX_LEAD_UPDATE_ATTEMPTS && current; attempt++) {
    const updated = await deps.leads.applyQualification(tenantId, current.id, {
      ...decision,
      expectedVersion: current.version,
    });
    if (updated) return updated;
    current = await deps.leads.get(tenantId, lead.id);
  }
  throw new ReviewError('conflict', 'Lead kept changing while applying the review; try again');
}

const leadView = (lead: LeadRecord): ResolveReviewResult['lead'] => ({
  id: lead.id,
  queue: lead.queue,
  assistantVerdict: lead.assistantVerdict ?? null,
  assistantVendor: lead.assistantVendor ?? null,
  qualificationReason: lead.qualificationReason ?? null,
});

export async function resolveReviewTask(deps: ReviewDeps, input: ResolveReviewInput): Promise<ResolveReviewResult> {
  const { tenantId, id, action } = input;
  const note = input.note.trim();
  if (!note) throw new ReviewError('validation_error', 'A note is required');

  const task = await deps.reviewTasks.get(tenantId, id);
  if (!task) throw new ReviewError('not_found', 'Review task not found');
  if (task.status !== 'open') throw new ReviewError('conflict', 'Review task is already resolved');

  const lead = await deps.leads.get(tenantId, task.leadId);
  if (!lead) throw new ReviewError('not_found', 'Lead for this review task not found');
  if (action === 'request_reaudit' && !lead.company.domain) {
    throw new ReviewError('validation_error', 'Lead has no website domain to re-audit');
  }

  const claimed = await deps.reviewTasks.resolve(tenantId, id, { resolvedBy: input.resolvedBy, resolutionNote: note });
  if (!claimed) throw new ReviewError('conflict', 'Review task is already resolved');

  let after: LeadRecord = lead;
  let job: ReauditJob | null = null;
  if (action === 'request_reaudit') {
    job = await deps.requestReaudit(tenantId, lead.id);
  } else {
    after = await applyDecision(deps, tenantId, lead, decisionFor(action, lead, input.vendor));
  }

  await deps.auditLogs.append({
    tenantId,
    leadId: lead.id,
    entityType: 'ReviewTask',
    entityId: task.id,
    action: 'review_resolved',
    actorId: input.resolvedBy,
    note,
    before: { queue: lead.queue, verdict: lead.assistantVerdict ?? null, vendor: lead.assistantVendor ?? null },
    after: {
      resolution: action,
      queue: after.queue,
      verdict: after.assistantVerdict ?? null,
      vendor: after.assistantVendor ?? null,
      reason: task.reason,
      auditId: task.auditId,
      ...(job ? { jobId: job.id } : {}),
    },
  });

  deps.logger?.info('review_resolved', { tenantId, reviewTaskId: task.id, leadId: lead.id, action });

  return {
    review: { id: task.id, status: 'resolved', action, resolvedBy: input.resolvedBy, resolutionNote: note },
    lead: leadView(after),
    job,
  };
}
