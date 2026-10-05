import { describe, expect, it } from 'vitest';
import type { AuditLogRepo, LeadListItem, LeadRepo, ReviewTaskRecord, ReviewTaskRepo } from '../ports';
import { createSilentLogger } from '../logger';
import { ReviewError, resolveReviewTask, type ReviewDeps } from './reviewTasks';

const T = 'tenant-1';

function setup(opts: { domain?: string | null; staleWrites?: number } = {}) {
  const lead: LeadListItem = {
    id: 'lead-1',
    tenantId: T,
    companyId: 'co-1',
    queue: 'NEEDS_REVIEW',
    assistantVerdict: 'UNCERTAIN',
    assistantVendor: 'intercom',
    qualificationReason: 'low_confidence',
    latestAuditId: 'audit-1',
    version: 3,
    company: { id: 'co-1', tenantId: T, name: 'Acme', domain: opts.domain === undefined ? 'acme.test' : opts.domain },
  };
  const task: ReviewTaskRecord = {
    id: 'rt-1',
    tenantId: T,
    leadId: lead.id,
    auditId: 'audit-1',
    reason: 'low_confidence',
    status: 'open',
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
  let staleWrites = opts.staleWrites ?? 0;
  const logs: Parameters<AuditLogRepo['append']>[0][] = [];
  const reaudits: string[] = [];

  const reviewTasks: ReviewTaskRepo = {
    async open() {
      return { id: task.id };
    },
    async resolve(tenantId, id, data) {
      if (tenantId !== task.tenantId || id !== task.id || task.status !== 'open') return false;
      Object.assign(task, { status: 'resolved', ...data, resolvedAt: new Date() });
      return true;
    },
    async findOpenForLead() {
      return task.status === 'open' ? { id: task.id, reason: task.reason } : null;
    },
    async get(tenantId, id) {
      return tenantId === task.tenantId && id === task.id ? { ...task } : null;
    },
    async list() {
      return { items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 };
    },
  };

  const leads: LeadRepo = {
    async create() {
      throw new Error('unused');
    },
    async findByCompany() {
      return null;
    },
    async get(tenantId, id) {
      return tenantId === T && id === lead.id ? { ...lead } : null;
    },
    async list() {
      throw new Error('unused');
    },
    async applyQualification(_tenantId, _id, patch) {
      if (staleWrites > 0) {
        staleWrites--;
        lead.version++;
        return null;
      }
      if (patch.expectedVersion !== lead.version) return null;
      const { expectedVersion: _v, ...rest } = patch;
      Object.assign(lead, rest, { version: lead.version + 1 });
      return { ...lead };
    },
    async queueCounts() {
      throw new Error('unused');
    },
  };

  const deps: ReviewDeps = {
    reviewTasks,
    leads,
    auditLogs: {
      async append(entry) {
        logs.push(entry);
      },
    },
    async requestReaudit(_tenantId, leadId) {
      reaudits.push(leadId);
      return { id: 'job-1', status: 'pending' };
    },
    logger: createSilentLogger(),
  };

  return { deps, lead, task, logs, reaudits };
}

const base = { tenantId: T, id: 'rt-1', note: 'checked the site by hand', resolvedBy: 'ops@moncha.test' };

describe('resolveReviewTask', () => {
  it('confirm_no_assistant qualifies the lead and resolves the task', async () => {
    const { deps, lead, task, logs } = setup();
    const result = await resolveReviewTask(deps, { ...base, action: 'confirm_no_assistant' });

    expect(result.lead).toMatchObject({ queue: 'QUALIFIED', assistantVerdict: 'NO_ASSISTANT', assistantVendor: null });
    expect(result.job).toBeNull();
    expect(lead.version).toBe(4);
    expect(task).toMatchObject({ status: 'resolved', resolvedBy: base.resolvedBy, resolutionNote: base.note });
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      entityType: 'ReviewTask',
      entityId: 'rt-1',
      action: 'review_resolved',
      actorId: base.resolvedBy,
      before: { queue: 'NEEDS_REVIEW', verdict: 'UNCERTAIN' },
      after: { resolution: 'confirm_no_assistant', queue: 'QUALIFIED', verdict: 'NO_ASSISTANT' },
    });
  });

  it('mark_has_assistant stores the given vendor', async () => {
    const { deps } = setup();
    const result = await resolveReviewTask(deps, { ...base, action: 'mark_has_assistant', vendor: 'tidio' });
    expect(result.lead).toMatchObject({
      queue: 'HAS_ASSISTANT',
      assistantVerdict: 'HAS_ASSISTANT',
      assistantVendor: 'tidio',
      qualificationReason: 'review_marked_has_assistant',
    });
  });

  it('mark_has_assistant keeps the detected vendor when none is given', async () => {
    const { deps } = setup();
    const result = await resolveReviewTask(deps, { ...base, action: 'mark_has_assistant' });
    expect(result.lead.assistantVendor).toBe('intercom');
  });

  it('request_reaudit queues an audit and leaves the lead untouched', async () => {
    const { deps, lead, task, reaudits, logs } = setup();
    const result = await resolveReviewTask(deps, { ...base, action: 'request_reaudit' });
    expect(reaudits).toEqual(['lead-1']);
    expect(result.job).toEqual({ id: 'job-1', status: 'pending' });
    expect(result.lead.queue).toBe('NEEDS_REVIEW');
    expect(lead.version).toBe(3);
    expect(task.status).toBe('resolved');
    expect(logs[0]?.after).toMatchObject({ resolution: 'request_reaudit', jobId: 'job-1' });
  });

  it('request_reaudit without a domain fails before resolving the task', async () => {
    const { deps, task } = setup({ domain: null });
    await expect(resolveReviewTask(deps, { ...base, action: 'request_reaudit' })).rejects.toMatchObject({
      code: 'validation_error',
      status: 400,
    });
    expect(task.status).toBe('open');
  });

  it('rejects a task that is already resolved', async () => {
    const { deps } = setup();
    await resolveReviewTask(deps, { ...base, action: 'confirm_no_assistant' });
    await expect(resolveReviewTask(deps, { ...base, action: 'confirm_no_assistant' })).rejects.toMatchObject({
      code: 'conflict',
      status: 409,
    });
  });

  it('returns not_found for an unknown task or another tenant', async () => {
    const { deps } = setup();
    await expect(resolveReviewTask(deps, { ...base, id: 'nope', action: 'confirm_no_assistant' })).rejects.toBeInstanceOf(
      ReviewError,
    );
    await expect(
      resolveReviewTask(deps, { ...base, tenantId: 'other', action: 'confirm_no_assistant' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('retries when an audit bumps the lead version mid-review', async () => {
    const { deps, lead } = setup({ staleWrites: 1 });
    const result = await resolveReviewTask(deps, { ...base, action: 'confirm_no_assistant' });
    expect(result.lead.queue).toBe('QUALIFIED');
    expect(lead.version).toBe(5);
  });

  it('gives up with conflict after repeated stale writes', async () => {
    const { deps } = setup({ staleWrites: 10 });
    await expect(resolveReviewTask(deps, { ...base, action: 'confirm_no_assistant' })).rejects.toMatchObject({
      code: 'conflict',
    });
  });

  it('requires a non-blank note', async () => {
    const { deps } = setup();
    await expect(resolveReviewTask(deps, { ...base, note: '   ', action: 'confirm_no_assistant' })).rejects.toMatchObject({
      code: 'validation_error',
    });
  });
});
