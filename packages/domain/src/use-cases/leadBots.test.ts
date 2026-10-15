import { describe, expect, it } from 'vitest';
import type { BotSlots, LeadBotItem, LeadBotPatch, LeadBotRepo, Logger, MonchaBotApi } from '../ports';
import {
  botIdempotencyKey,
  botName,
  createLeadBot,
  LEAD_BOT_ACCOUNT_PAUSE_MS,
  LEAD_BOT_NO_SLOTS_WAIT_MS,
  pickBotTier,
  runLeadBotTick,
} from './leadBots';

const NOW = new Date('2026-10-15T10:00:00.000Z');
const LEAD = 'clead0000000000000abc12';
const logger: Logger = { info: () => undefined, error: () => undefined };

const slots = (starter: number, growth: number, scale: number): BotSlots => ({
  starter: { allocated: starter, used: 0, available: starter },
  growth: { allocated: growth, used: 0, available: growth },
  scale: { allocated: scale, used: 0, available: scale },
});

function botFixture(over: Partial<LeadBotItem> = {}): LeadBotItem {
  return {
    id: 'bot1',
    tenantId: 't1',
    leadId: LEAD,
    siteSnapshotId: null,
    environment: 'uat',
    status: 'creating',
    name: null,
    planTier: null,
    idempotencyKey: null,
    attempts: 1,
    nextAt: null,
    lockedAt: NOW,
    error: null,
    chatbotId: null,
    monchaTenantId: null,
    connectionId: null,
    config: null,
    createdBotAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    company: { id: 'c1', name: 'Acme Dental Clinic', domain: 'acme.sg' },
    ...over,
  };
}

function fakeRepo(initial: LeadBotItem, takenNames: string[] = []) {
  let bot = { ...initial };
  const updates: LeadBotPatch[] = [];
  const failedCopies: Array<{ leadId: string; error: string }> = [];
  const repo: LeadBotRepo = {
    queueForWaitingCopies: async () => 0,
    queueForLiveWebsites: async () => 0,
    ensure: async () => bot,
    claimNext: async () => (bot.status === 'pending' ? (bot = { ...bot, status: 'creating', attempts: bot.attempts + 1 }) : null),
    update: async (_t, _id, patch) => {
      updates.push(patch);
      bot = { ...bot, ...patch };
      return bot;
    },
    getForLead: async () => bot,
    list: async () => ({ items: [bot], total: 1, page: 1, pageSize: 25, totalPages: 1, counts: { pending: 0, creating: 0, created: 0, failed: 0 } }),
    nameTaken: async (_t, _e, name) => takenNames.includes(name),
    failWaitingCopies: async (_t, leadId, error) => {
      failedCopies.push({ leadId, error });
      return 1;
    },
    failCopiesOfFailedBots: async () => 0,
  };
  return { repo, updates, failedCopies, current: () => bot };
}

function fakeApi(opts: { slots?: BotSlots; create?: () => Promise<unknown> | unknown } = {}) {
  const calls: Array<{ name: string; planTier: string; idempotencyKey: string; language?: string }> = [];
  const api: MonchaBotApi = {
    environment: 'uat',
    slots: async () => opts.slots ?? slots(3000, 500, 500),
    createBot: async (input) => {
      calls.push(input);
      const response = opts.create ? await opts.create() : { data: { bot_id: 'mb-1', customer_tenant_id: 'mt-1', connection_id: 'mc-1', plan_tier: input.planTier } };
      return { botId: 'mb-1', tenantId: 'mt-1', connectionId: 'mc-1', planTier: input.planTier, response };
    },
  };
  return { api, calls };
}

const apiError = (code: string, status: number | null, retryAt?: Date) => Object.assign(new Error(code), { code, status, retryAt });

describe('pickBotTier', () => {
  it('takes the tier with the most available slots, ties to the cheaper tier', () => {
    expect(pickBotTier(slots(3000, 500, 500))).toBe('starter');
    expect(pickBotTier(slots(100, 500, 200))).toBe('growth');
    expect(pickBotTier(slots(10, 10, 50))).toBe('scale');
    expect(pickBotTier(slots(5, 5, 5))).toBe('starter');
    expect(pickBotTier(slots(0, 7, 7))).toBe('growth');
    expect(pickBotTier(slots(0, 0, 0))).toBeNull();
  });
});

describe('botName and botIdempotencyKey', () => {
  it('uses the company name, at most 30 characters, with a lead reference when asked', () => {
    expect(botName({ name: '  Acme   Dental  ', domain: null }, LEAD)).toBe('Acme Dental');
    expect(botName({ name: 'A'.repeat(40), domain: null }, LEAD)).toHaveLength(30);
    expect(botName({ name: '', domain: 'acme.sg' }, LEAD)).toBe('acme.sg');
    const withRef = botName({ name: 'Popeyes Louisiana Kitchen Bedok Mall', domain: null }, LEAD, true);
    expect(withRef.length).toBeLessThanOrEqual(30);
    expect(withRef).toMatch(/ Labc12$/);
  });

  it('gives each new request body the next key version', () => {
    expect(botIdempotencyKey(LEAD, null)).toBe(`lead-${LEAD}-bot-v1`);
    expect(botIdempotencyKey(LEAD, `lead-${LEAD}-bot-v1`)).toBe(`lead-${LEAD}-bot-v2`);
  });
});

describe('createLeadBot', () => {
  it('picks the tier, saves name/tier/key before sending, then stores the IDs and full response', async () => {
    const { repo, updates, current } = fakeRepo(botFixture());
    const { api, calls } = fakeApi({ slots: slots(100, 500, 200) });
    const outcome = await createLeadBot({ bots: repo, api, logger, now: () => NOW }, botFixture());

    expect(outcome).toMatchObject({ status: 'created', chatbotId: 'mb-1', planTier: 'growth', name: 'Acme Dental Clinic' });
    expect(updates[0]).toEqual({ name: 'Acme Dental Clinic', planTier: 'growth', idempotencyKey: `lead-${LEAD}-bot-v1` });
    expect(calls[0]).toMatchObject({ name: 'Acme Dental Clinic', planTier: 'growth', language: 'en', idempotencyKey: `lead-${LEAD}-bot-v1` });
    expect(current()).toMatchObject({
      status: 'created',
      chatbotId: 'mb-1',
      monchaTenantId: 'mt-1',
      connectionId: 'mc-1',
      planTier: 'growth',
      error: null,
      createdBotAt: NOW,
    });
    expect(current().config).toEqual({ data: { bot_id: 'mb-1', customer_tenant_id: 'mt-1', connection_id: 'mc-1', plan_tier: 'growth' } });
  });

  it('adds a lead reference when another lead already uses the name', async () => {
    const { repo } = fakeRepo(botFixture(), ['Acme Dental Clinic']);
    const { api, calls } = fakeApi();
    await createLeadBot({ bots: repo, api, logger, now: () => NOW }, botFixture());
    expect(calls[0]!.name).toBe('Acme Dental Clinic Labc12');
  });

  it('retries with the same saved request after a transient error', async () => {
    const saved = botFixture({ name: 'Acme', planTier: 'starter', idempotencyKey: `lead-${LEAD}-bot-v1`, attempts: 2 });
    const { repo, current } = fakeRepo(saved);
    const { api, calls } = fakeApi({ create: () => Promise.reject(apiError('http_503', 503)) });
    const outcome = await createLeadBot({ bots: repo, api, logger, now: () => NOW }, saved);
    expect(outcome.status).toBe('retry');
    expect(calls[0]).toMatchObject({ name: 'Acme', planTier: 'starter', idempotencyKey: `lead-${LEAD}-bot-v1` });
    expect(current()).toMatchObject({ status: 'pending', idempotencyKey: `lead-${LEAD}-bot-v1`, error: 'http_503: http_503' });
    expect(current().nextAt!.getTime()).toBe(NOW.getTime() + 5 * 60_000);
  });

  it('after the third failed try records the error, fails the waiting copy and moves on', async () => {
    const third = botFixture({ name: 'Acme', planTier: 'starter', idempotencyKey: `lead-${LEAD}-bot-v1`, attempts: 3 });
    const { repo, current, failedCopies } = fakeRepo(third);
    const { api } = fakeApi({ create: () => Promise.reject(apiError('validation_failed', 400)) });
    const outcome = await createLeadBot({ bots: repo, api, logger, now: () => NOW }, third);
    expect(outcome).toMatchObject({ status: 'failed', copiesFailed: 1 });
    expect(current()).toMatchObject({ status: 'failed', nextAt: null, error: 'validation_failed: validation_failed' });
    expect(failedCopies).toEqual([{ leadId: LEAD, error: 'Bot creation failed after 3 attempts: validation_failed: validation_failed' }]);
  });

  it('pauses without using a try on account errors, rate limits and full tiers', async () => {
    const account = fakeRepo(botFixture({ attempts: 1 }));
    const out1 = await createLeadBot(
      { bots: account.repo, api: fakeApi({ create: () => Promise.reject(apiError('invalid_internal_credentials', 401)) }).api, logger, now: () => NOW },
      botFixture({ attempts: 1 }),
    );
    expect(out1.status).toBe('paused');
    expect(account.current()).toMatchObject({ status: 'pending', attempts: 0 });
    expect(account.current().nextAt!.getTime()).toBe(NOW.getTime() + LEAD_BOT_ACCOUNT_PAUSE_MS);

    const retryAt = new Date(NOW.getTime() + 30_000);
    const limited = fakeRepo(botFixture());
    const out2 = await createLeadBot(
      { bots: limited.repo, api: fakeApi({ create: () => Promise.reject(apiError('rate_limit_exceeded', 429, retryAt)) }).api, logger, now: () => NOW },
      botFixture(),
    );
    expect(out2).toMatchObject({ status: 'paused', until: retryAt });

    const full = fakeRepo(botFixture());
    const fullApi = fakeApi({ slots: slots(0, 0, 0) });
    const out3 = await createLeadBot({ bots: full.repo, api: fullApi.api, logger, now: () => NOW }, botFixture());
    expect(out3.status).toBe('paused');
    expect(fullApi.calls).toHaveLength(0);
    expect(full.current().nextAt!.getTime()).toBe(NOW.getTime() + LEAD_BOT_NO_SLOTS_WAIT_MS);
  });

  it('on bot_name_taken retries at once with a lead reference and a new key', async () => {
    const saved = botFixture({ name: 'Acme', planTier: 'starter', idempotencyKey: `lead-${LEAD}-bot-v1` });
    const { repo, current } = fakeRepo(saved);
    await createLeadBot({ bots: repo, api: fakeApi({ create: () => Promise.reject(apiError('bot_name_taken', 409)) }).api, logger, now: () => NOW }, saved);
    expect(current()).toMatchObject({ status: 'pending', name: 'Acme Dental Clinic Labc12', idempotencyKey: `lead-${LEAD}-bot-v2`, nextAt: NOW });
  });

  it('on slot_unavailable picks the tier again on the next try', async () => {
    const saved = botFixture({ name: 'Acme', planTier: 'starter', idempotencyKey: `lead-${LEAD}-bot-v1` });
    const { repo, current } = fakeRepo(saved);
    await createLeadBot({ bots: repo, api: fakeApi({ create: () => Promise.reject(apiError('slot_unavailable', 409)) }).api, logger, now: () => NOW }, saved);
    expect(current()).toMatchObject({ status: 'pending', planTier: null, idempotencyKey: `lead-${LEAD}-bot-v1` });

    const { api, calls } = fakeApi({ slots: slots(0, 9, 0) });
    await createLeadBot({ bots: repo, api, logger, now: () => NOW }, { ...current(), status: 'creating', attempts: 2 });
    expect(calls[0]).toMatchObject({ planTier: 'growth', idempotencyKey: `lead-${LEAD}-bot-v2` });
  });
});

describe('runLeadBotTick', () => {
  it('is idle when no bot is due', async () => {
    const { repo } = fakeRepo(botFixture({ status: 'created' }));
    expect(await runLeadBotTick({ bots: repo, api: fakeApi().api, logger, now: () => NOW })).toEqual({ action: 'idle', queued: 0, copiesFailed: 0 });
  });

  it('claims and creates the next pending bot', async () => {
    const { repo } = fakeRepo(botFixture({ status: 'pending', attempts: 0 }));
    const tick = await runLeadBotTick({ bots: repo, api: fakeApi().api, logger, now: () => NOW });
    expect(tick).toMatchObject({ action: 'ran', outcome: { status: 'created', planTier: 'starter' } });
  });
});
