import { describe, expect, it } from 'vitest';
import type { ColdEmailPayload, Mailer } from '../ports';
import {
  runColdEmailAutomation,
  sendColdEmailDraft,
  sendColdEmailNow,
  ColdEmailError,
  type ColdEmailAutoCandidate,
  type ColdEmailAutomationSettings,
  type ColdEmailOrigin,
  type ColdEmailRecord,
  type ColdEmailRepo,
} from './coldEmails';

const NOW = new Date('2026-10-17T08:00:00.000Z');
const TEST_INBOX = 'thinaakark2004@gmail.com';

function fakeRepo(ready: ColdEmailAutoCandidate[] = [], usedToday = 0) {
  const rows: ColdEmailRecord[] = [];
  let n = 0;
  const repo: ColdEmailRepo = {
    list: async () => ({ items: rows, total: rows.length, page: 1, pageSize: 25 }),
    get: async (_t, id) => rows.find((r) => r.id === id) ?? null,
    create: async (data) => {
      const row: ColdEmailRecord = {
        id: `ce${++n}`,
        deliveredTo: null,
        resendId: null,
        error: null,
        sentAt: null,
        origin: 'manual',
        createdAt: NOW,
        updatedAt: NOW,
        ...data,
      } as ColdEmailRecord;
      rows.push(row);
      return row;
    },
    update: async (_t, id, patch) => {
      const row = rows.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    },
    listCandidates: async () => ({ items: [], total: 0, page: 1, pageSize: 25 }),
    listAutoReady: async (_t, limit) => ready.slice(0, limit),
    countOriginSince: async (_t, origin: ColdEmailOrigin) => (origin === 'auto' ? usedToday : 0),
  };
  return { repo, rows };
}

function fakeMailer() {
  const sent: ColdEmailPayload[] = [];
  const mailer: Mailer = {
    sendPasswordReset: async () => undefined,
    sendColdEmail: async (email) => {
      sent.push(email);
      return { id: `re_${sent.length}` };
    },
  };
  return { mailer, sent };
}

/** Only the test inbox is allowed, as in development. */
function deps(repo: ColdEmailRepo, mailer: Mailer | null, allow: string[] = [TEST_INBOX]) {
  return {
    coldEmails: repo,
    mailer,
    env: {},
    isAllowed: (to: string) => allow.includes(to.toLowerCase()),
    sendingEnabled: () => true,
    parseAllowlist: () => ({ open: false, emails: new Set(allow) }),
    buildContent: (i: { companyName: string; demoUrl: string }) => ({ subject: `Demo for ${i.companyName}`, text: 't', html: 'h' }),
  };
}

const settings = (over: Partial<ColdEmailAutomationSettings> = {}): ColdEmailAutomationSettings => ({
  tenantId: 't1',
  enabled: true,
  mode: 'draft',
  dailyCap: 20,
  enabledAt: NOW,
  updatedBy: 'ops@example.com',
  updatedAt: NOW,
  ...over,
});

const lead = (i: number, email = `owner${i}@business${i}.sg`): ColdEmailAutoCandidate => ({
  leadId: `lead${i}`,
  companyName: `Business ${i}`,
  companyEmail: email,
  demoUrl: `https://business${i}.workers.dev`,
});

describe('runColdEmailAutomation', () => {
  it('does nothing while switched off', async () => {
    const { repo, rows } = fakeRepo([lead(1)]);
    const { mailer, sent } = fakeMailer();
    await runColdEmailAutomation(deps(repo, mailer), settings({ enabled: false }), NOW);
    expect(rows).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('draft mode only creates drafts to the company address, never sends', async () => {
    const { repo, rows } = fakeRepo([lead(1), lead(2)]);
    const { mailer, sent } = fakeMailer();
    const out = await runColdEmailAutomation(deps(repo, mailer), settings(), NOW);
    expect(out).toMatchObject({ drafted: 2, sent: 0 });
    expect(rows.map((r) => [r.status, r.origin, r.toEmail])).toEqual([
      ['draft', 'auto', 'owner1@business1.sg'],
      ['draft', 'auto', 'owner2@business2.sg'],
    ]);
    expect(sent).toEqual([]);
  });

  it('send mode keeps addresses the gate does not allow as drafts', async () => {
    const { repo, rows } = fakeRepo([lead(1), lead(2, TEST_INBOX)]);
    const { mailer, sent } = fakeMailer();
    const out = await runColdEmailAutomation(deps(repo, mailer), settings({ mode: 'send' }), NOW);
    expect(out).toMatchObject({ drafted: 2, sent: 1, heldAsDraft: 1 });
    expect(sent.map((s) => s.to)).toEqual([TEST_INBOX]);
    expect(rows.find((r) => r.toEmail === 'owner1@business1.sg')?.status).toBe('draft');
  });

  it('send mode without a mailer only drafts', async () => {
    const { repo, rows } = fakeRepo([lead(1, TEST_INBOX)]);
    const out = await runColdEmailAutomation(deps(repo, null), settings({ mode: 'send' }), NOW);
    expect(out).toMatchObject({ drafted: 1, sent: 0, heldAsDraft: 1 });
    expect(rows[0]!.status).toBe('draft');
  });

  it("stops at today's cap", async () => {
    const { repo, rows } = fakeRepo([lead(1), lead(2), lead(3)], 19);
    const out = await runColdEmailAutomation(deps(repo, fakeMailer().mailer), settings(), NOW);
    expect(out).toMatchObject({ drafted: 1, remainingToday: 0 });
    expect(rows).toHaveLength(1);
  });
});

describe('sendColdEmailDraft', () => {
  it('refuses a company address the gate does not allow and leaves the draft untouched', async () => {
    const { repo, rows } = fakeRepo();
    const { mailer, sent } = fakeMailer();
    const draft = await repo.create({
      tenantId: 't1',
      leadId: 'lead1',
      companyName: 'Business 1',
      toEmail: 'owner1@business1.sg',
      demoUrl: 'https://business1.workers.dev',
      subject: 'Demo',
      status: 'draft',
      origin: 'auto',
    });
    await expect(sendColdEmailDraft(deps(repo, mailer), { tenantId: 't1', id: draft.id })).rejects.toMatchObject({
      code: 'blocked',
    });
    expect(sent).toEqual([]);
    expect(rows[0]).toMatchObject({ status: 'draft', deliveredTo: null });
  });

  it('sends an allowed draft and records it', async () => {
    const { repo, rows } = fakeRepo();
    const { mailer, sent } = fakeMailer();
    const draft = await repo.create({
      tenantId: 't1',
      leadId: null,
      companyName: 'Business 1',
      toEmail: TEST_INBOX,
      demoUrl: 'https://business1.workers.dev',
      subject: 'Demo',
      status: 'draft',
    });
    await sendColdEmailDraft(deps(repo, mailer), { tenantId: 't1', id: draft.id });
    expect(sent.map((s) => s.to)).toEqual([TEST_INBOX]);
    expect(rows[0]).toMatchObject({ status: 'sent', deliveredTo: TEST_INBOX, resendId: 're_1' });
    await expect(sendColdEmailDraft(deps(repo, mailer), { tenantId: 't1', id: draft.id })).rejects.toBeInstanceOf(ColdEmailError);
  });
});

describe('sendColdEmailNow', () => {
  it('marks a send to a test inbox instead of the company as a test', async () => {
    const { repo, rows } = fakeRepo();
    await sendColdEmailNow(deps(repo, fakeMailer().mailer), {
      tenantId: 't1',
      leadId: 'lead1',
      companyName: 'Business 1',
      toEmail: 'owner1@business1.sg',
      deliverTo: TEST_INBOX,
      demoUrl: 'https://business1.workers.dev',
    });
    expect(rows[0]).toMatchObject({ origin: 'test', toEmail: 'owner1@business1.sg', deliveredTo: TEST_INBOX, status: 'sent' });
  });
});
