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
const DEV_INBOX_1 = 'thinaakark2004@gmail.com';
const DEV_INBOX_2 = 'vinothjv4.tech@gmail.com';
const DEV_INBOXES = [DEV_INBOX_1, DEV_INBOX_2];

const PROD_ENV = {
  COLD_EMAIL_DEV_MODE: 'false',
  NODE_ENV: 'production',
  COLD_EMAIL_PRODUCTION_CONFIRMED: 'true',
};

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

function fakeMailer(shouldFail = false) {
  const sent: ColdEmailPayload[] = [];
  const mailer: Mailer = {
    sendPasswordReset: async () => undefined,
    sendColdEmail: async (email) => {
      if (shouldFail) {
        throw new Error('resend_403: domain not verified');
      }
      sent.push(email);
      return { id: `re_${sent.length}` };
    },
  };
  return { mailer, sent };
}

function deps(
  repo: ColdEmailRepo,
  mailer: Mailer | null,
  allow: string[] = DEV_INBOXES,
  env: Record<string, unknown> = {},
) {
  return {
    coldEmails: repo,
    mailer,
    env: {
      COLD_EMAIL_DEV_MODE: 'true',
      COLD_EMAIL_DEV_INBOXES: DEV_INBOXES.join(','),
      ...env,
    },
    isAllowed: (to: string) => allow.includes('*') || allow.includes(to.toLowerCase()),
    sendingEnabled: () => true,
    parseAllowlist: () => ({ open: allow.includes('*'), emails: new Set(allow) }),
    buildContent: (i: { companyName: string; demoUrl: string }) => ({
      subject: `Demo for ${i.companyName}`,
      text: 't',
      html: 'h',
    }),
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

  it('in development mode, automated sending is blocked and all candidates stay drafts', async () => {
    const { repo, rows } = fakeRepo([lead(1), lead(2, DEV_INBOX_1)]);
    const { mailer, sent } = fakeMailer();
    // In dev mode, even with mode: 'send', automated customer sends are blocked
    const out = await runColdEmailAutomation(deps(repo, mailer), settings({ mode: 'send' }), NOW);
    expect(out).toMatchObject({ drafted: 2, sent: 0, heldAsDraft: 2 });
    expect(sent).toEqual([]);
    expect(rows[0]!.status).toBe('draft');
    expect(rows[1]!.status).toBe('draft');
  });

  it('in production mode, send mode sends to allowed addresses and keeps others as drafts', async () => {
    const { repo, rows } = fakeRepo([lead(1), lead(2, 'allowed@business.sg')]);
    const { mailer, sent } = fakeMailer();
    const out = await runColdEmailAutomation(
      deps(repo, mailer, ['allowed@business.sg'], PROD_ENV),
      settings({ mode: 'send' }),
      NOW,
    );
    expect(out).toMatchObject({ drafted: 2, sent: 1, heldAsDraft: 1 });
    expect(sent.map((s) => s.to)).toEqual([['allowed@business.sg']]);
    expect(rows.find((r) => r.toEmail === 'owner1@business1.sg')?.status).toBe('draft');
  });

  it("stops at today's cap", async () => {
    const { repo, rows } = fakeRepo([lead(1), lead(2), lead(3)], 19);
    const out = await runColdEmailAutomation(deps(repo, fakeMailer().mailer), settings(), NOW);
    expect(out).toMatchObject({ drafted: 1, remainingToday: 0 });
    expect(rows).toHaveLength(1);
  });
});

describe('sendColdEmailDraft', () => {
  it('rejects sending directly to customer email in development mode', async () => {
    const { repo, rows } = fakeRepo();
    const { mailer, sent } = fakeMailer();
    const draft = await repo.create({
      tenantId: 't1',
      leadId: 'lead1',
      companyName: 'Real Customer Co',
      toEmail: 'customer@realclient.com',
      demoUrl: 'https://realclient.workers.dev',
      subject: 'Demo for Real Customer Co',
      status: 'draft',
      origin: 'auto',
    });

    await expect(
      sendColdEmailDraft(deps(repo, mailer), { tenantId: 't1', id: draft.id }),
    ).rejects.toMatchObject({
      code: 'blocked',
    });
    expect(sent).toEqual([]);
    // Customer address and draft state untouched
    expect(rows[0]).toMatchObject({ status: 'draft', toEmail: 'customer@realclient.com', deliveredTo: null });
  });

  it('allows deliverToOverride to send draft test to dev inboxes while preserving customer email', async () => {
    const { repo, rows } = fakeRepo();
    const { mailer, sent } = fakeMailer();
    const draft = await repo.create({
      tenantId: 't1',
      leadId: 'lead1',
      companyName: 'Real Customer Co',
      toEmail: 'customer@realclient.com',
      demoUrl: 'https://realclient.workers.dev',
      subject: 'Demo for Real Customer Co',
      status: 'draft',
      origin: 'auto',
    });

    const result = await sendColdEmailDraft(deps(repo, mailer), {
      tenantId: 't1',
      id: draft.id,
      deliverToOverride: [DEV_INBOX_1, DEV_INBOX_2],
    });

    expect(result.status).toBe('sent');
    expect(result.toEmail).toBe('customer@realclient.com'); // Preserved!
    expect(result.deliveredTo).toBe(`${DEV_INBOX_1}, ${DEV_INBOX_2}`);
    expect(sent[0]!.to).toEqual([DEV_INBOX_1, DEV_INBOX_2]);
    expect(rows[0]!.toEmail).toBe('customer@realclient.com');
  });

  it('rejects unapproved override address in development mode', async () => {
    const { repo } = fakeRepo();
    const { mailer } = fakeMailer();
    const draft = await repo.create({
      tenantId: 't1',
      leadId: 'lead1',
      companyName: 'Acme',
      toEmail: DEV_INBOX_1,
      demoUrl: 'https://acme.workers.dev',
      subject: 'Demo',
      status: 'draft',
    });

    await expect(
      sendColdEmailDraft(deps(repo, mailer), {
        tenantId: 't1',
        id: draft.id,
        deliverToOverride: 'malicious@outside.com',
      }),
    ).rejects.toMatchObject({ code: 'blocked' });
  });

  it('does not create false success state when Resend returns an error', async () => {
    const { repo, rows } = fakeRepo();
    const { mailer } = fakeMailer(true); // Fails
    const draft = await repo.create({
      tenantId: 't1',
      leadId: 'lead1',
      companyName: 'Acme',
      toEmail: 'customer@realclient.com',
      demoUrl: 'https://acme.workers.dev',
      subject: 'Demo',
      status: 'draft',
    });

    await expect(
      sendColdEmailDraft(deps(repo, mailer), {
        tenantId: 't1',
        id: draft.id,
        deliverToOverride: DEV_INBOX_1,
      }),
    ).rejects.toThrow();

    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.error).toContain('resend_403');
  });
});

describe('sendColdEmailNow', () => {
  it('sends to single dev inbox, preserving intended customer email and marking origin as test', async () => {
    const { repo, rows } = fakeRepo();
    const { mailer, sent } = fakeMailer();
    await sendColdEmailNow(deps(repo, mailer), {
      tenantId: 't1',
      leadId: 'lead1',
      companyName: 'Business 1',
      toEmail: 'owner1@business1.sg',
      deliverTo: DEV_INBOX_1,
      demoUrl: 'https://business1.workers.dev',
    });

    expect(rows[0]).toMatchObject({
      origin: 'test',
      toEmail: 'owner1@business1.sg',
      deliveredTo: DEV_INBOX_1,
      status: 'sent',
    });
    expect(sent[0]!.to).toEqual([DEV_INBOX_1]);
  });

  it('sends to multiple developer inboxes simultaneously', async () => {
    const { repo, rows } = fakeRepo();
    const { mailer, sent } = fakeMailer();
    await sendColdEmailNow(deps(repo, mailer), {
      tenantId: 't1',
      leadId: 'lead1',
      companyName: 'Business 1',
      toEmail: 'owner1@business1.sg',
      deliverTo: [DEV_INBOX_1, DEV_INBOX_2],
      demoUrl: 'https://business1.workers.dev',
    });

    expect(rows[0]).toMatchObject({
      origin: 'test',
      toEmail: 'owner1@business1.sg',
      deliveredTo: `${DEV_INBOX_1}, ${DEV_INBOX_2}`,
      status: 'sent',
    });
    expect(sent[0]!.to).toEqual([DEV_INBOX_1, DEV_INBOX_2]);
  });

  it('rejects sending to customer email directly in development mode', async () => {
    const { repo } = fakeRepo();
    const { mailer } = fakeMailer();
    await expect(
      sendColdEmailNow(deps(repo, mailer), {
        tenantId: 't1',
        leadId: 'lead1',
        companyName: 'Business 1',
        toEmail: 'owner1@business1.sg',
        deliverTo: 'owner1@business1.sg', // Direct customer send attempt
        demoUrl: 'https://business1.workers.dev',
      }),
    ).rejects.toMatchObject({ code: 'blocked' });
  });

  it('fails closed when dev inbox configuration is invalid', async () => {
    const { repo } = fakeRepo();
    const { mailer } = fakeMailer();
    await expect(
      sendColdEmailNow(
        deps(repo, mailer, DEV_INBOXES, {
          COLD_EMAIL_DEV_MODE: 'true',
          COLD_EMAIL_DEV_INBOXES: 'not-a-valid-email',
        }),
        {
          tenantId: 't1',
          companyName: 'Business 1',
          toEmail: 'owner1@business1.sg',
          deliverTo: DEV_INBOX_1,
          demoUrl: 'https://business1.workers.dev',
        },
      ),
    ).rejects.toMatchObject({ code: 'validation' });
  });
});
