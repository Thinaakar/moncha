import { describe, expect, it } from 'vitest';
import type { BotSlots, LeadBotItem, LeadBotPatch, LeadBotRepo, Logger, MonchaBotApi } from '../ports';
import {
  botIdempotencyKey,
  botName,
  createLeadBot,
  LEAD_BOT_ACCOUNT_PAUSE_MS,
  LEAD_BOT_NO_SLOTS_WAIT_MS,
  LEAD_BOT_TRAINING_MAX_WAIT_MS,
  pageTitle,
  pickBotTier,
  runLeadBotTick,
  trainingIdempotencyKey,
  trainingUrls,
  trainLeadBot,
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
    knowledgeStatus: 'pending',
    knowledgeAttempts: 0,
    knowledgeNextAt: null,
    knowledgeLockedAt: null,
    websiteUrl: null,
    discoveredUrls: null,
    pagesFetched: null,
    discoveryTruncated: null,
    discoveredAt: null,
    trainingKey: null,
    trainingPayload: null,
    trainingId: null,
    trainingResult: null,
    trainingSubmittedAt: null,
    trainedAt: null,
    widgetPrimaryColor: null,
    widgetConfigBefore: null,
    widgetConfig: null,
    installValues: null,
    widgetConfiguredAt: null,
    domains: null,
    domainsConfiguredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    company: { id: 'c1', name: 'Acme Dental Clinic', domain: 'acme.sg', websiteUrl: 'https://www.acme.sg/' },
    ...over,
  };
}

/** A created bot whose training step was just claimed. */
const trainFixture = (over: Partial<LeadBotItem> = {}) =>
  botFixture({ status: 'created', chatbotId: 'mb-1', knowledgeStatus: 'discovering', knowledgeAttempts: 1, ...over });

function fakeRepo(initial: LeadBotItem, takenNames: string[] = []) {
  let bot = { ...initial };
  const updates: LeadBotPatch[] = [];
  const failedCopies: Array<{ leadId: string; error: string }> = [];
  const repo: LeadBotRepo = {
    queueForWaitingCopies: async () => 0,
    queueForLiveWebsites: async () => 0,
    ensure: async () => bot,
    claimNext: async () => (bot.status === 'pending' ? (bot = { ...bot, status: 'creating', attempts: bot.attempts + 1 }) : null),
    claimNextKnowledge: async () =>
      bot.status === 'created' && bot.knowledgeStatus === 'pending'
        ? (bot = { ...bot, knowledgeStatus: 'discovering', knowledgeAttempts: bot.knowledgeAttempts + 1 })
        : null,
    update: async (_t, _id, patch) => {
      updates.push(patch);
      bot = { ...bot, ...patch };
      return bot;
    },
    getForLead: async () => bot,
    linksByChatbotIds: async () => [],
    domainsForLeads: async () => [],
    list: async () => ({
      items: [bot],
      total: 1,
      page: 1,
      pageSize: 25,
      totalPages: 1,
      counts: { pending: 0, creating: 0, created: 0, failed: 0 },
      knowledgeCounts: { pending: 0, discovering: 0, training: 0, trained: 0, failed: 0 },
    }),
    nameTaken: async (_t, _e, name) => takenNames.includes(name),
    failWaitingCopies: async (_t, leadId, error) => {
      failedCopies.push({ leadId, error });
      return 1;
    },
    failCopiesOfFailedBots: async () => 0,
  };
  return { repo, updates, failedCopies, current: () => bot };
}

type Training = Awaited<ReturnType<MonchaBotApi['training']>>;

function fakeApi(
  opts: {
    slots?: BotSlots;
    create?: () => Promise<unknown> | unknown;
    discover?: () => Promise<string[]> | string[];
    ingest?: () => Promise<unknown> | unknown;
    training?: () => Promise<Partial<Training>> | Partial<Training>;
  } = {},
) {
  const calls: Array<{ name: string; planTier: string; idempotencyKey: string; language?: string }> = [];
  const discovers: Array<{ botId: string; url: string; maxPages?: number }> = [];
  const ingests: Array<{ botId: string; documents: unknown[]; idempotencyKey: string }> = [];
  const api: MonchaBotApi = {
    environment: 'uat',
    slots: async () => opts.slots ?? slots(3000, 500, 500),
    createBot: async (input) => {
      calls.push(input);
      const response = opts.create ? await opts.create() : { data: { bot_id: 'mb-1', customer_tenant_id: 'mt-1', connection_id: 'mc-1', plan_tier: input.planTier } };
      return { botId: 'mb-1', tenantId: 'mt-1', connectionId: 'mc-1', planTier: input.planTier, response };
    },
    discover: async ({ botId, url, maxPages }) => {
      discovers.push({ botId, url, maxPages });
      const urls = opts.discover ? await opts.discover() : [url, `${url}services`];
      return { urls, pagesFetched: urls.length, truncated: false, response: { urls } };
    },
    ingestBulk: async ({ botId, documents, idempotencyKey }) => {
      ingests.push({ botId, documents, idempotencyKey });
      if (opts.ingest) await opts.ingest();
      const response = { data: { training_id: 'tr-1', status: 'queued', total: documents.length } };
      return { trainingId: 'tr-1', status: 'queued', total: documents.length, response };
    },
    training: async () => {
      const t = opts.training ? await opts.training() : {};
      return { status: 'processing', total: 2, ready: 0, failed: 0, pollAfterSeconds: 5, response: { status: t.status ?? 'processing' }, ...t };
    },
  };
  return { api, calls, discovers, ingests };
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

describe('pageTitle, trainingUrls and trainingIdempotencyKey', () => {
  const company = { name: 'Acme  Dental', domain: 'acme.sg' };

  it('names each page after the company and its path', () => {
    expect(pageTitle(company, 'https://acme.sg/')).toBe('Acme Dental - Home');
    expect(pageTitle(company, 'https://acme.sg/services')).toBe('Acme Dental - services');
    expect(pageTitle(company, 'https://acme.sg/services/dental-implants/')).toBe('Acme Dental - services / dental implants');
    expect(pageTitle(company, 'https://acme.sg/about_us.html?x=1')).toBe('Acme Dental - about us');
    expect(pageTitle(company, 'https://acme.sg/%E5%85%B3%E4%BA%8E')).toBe('Acme Dental - 关于');
    expect(pageTitle({ name: '', domain: null }, 'https://acme.sg/a')).toBe('acme.sg - a');
    expect(pageTitle({ name: 'A'.repeat(400), domain: null }, 'https://acme.sg/')).toHaveLength(300);
  });

  it('keeps unique http(s) URLs without fragments, at most 100, else the website', () => {
    expect(trainingUrls(['https://acme.sg/', 'https://acme.sg/#top', 'mailto:a@acme.sg', 'nope', 'https://acme.sg/a'], 'https://acme.sg/')).toEqual([
      'https://acme.sg/',
      'https://acme.sg/a',
    ]);
    expect(trainingUrls([], 'https://acme.sg/')).toEqual(['https://acme.sg/']);
    expect(trainingUrls(Array.from({ length: 150 }, (_, i) => `https://acme.sg/p${i}`), 'https://acme.sg/')).toHaveLength(100);
  });

  it('gives each new training body the next key version', () => {
    expect(trainingIdempotencyKey(LEAD, null)).toBe(`lead-${LEAD}-train-v1`);
    expect(trainingIdempotencyKey(LEAD, `lead-${LEAD}-train-v2`)).toBe(`lead-${LEAD}-train-v3`);
  });
});

describe('trainLeadBot', () => {
  const deps = (repo: LeadBotRepo, api: MonchaBotApi) => ({ bots: repo, api, logger, now: () => NOW });

  it('discovers the website (max 100 pages), saves body and key before sending, then submits the training', async () => {
    const { repo, updates, current } = fakeRepo(trainFixture());
    const { api, discovers, ingests } = fakeApi();
    const outcome = await trainLeadBot(deps(repo, api), trainFixture());

    expect(discovers).toEqual([{ botId: 'mb-1', url: 'https://www.acme.sg/', maxPages: 100 }]);
    const documents = [
      { title: 'Acme Dental Clinic - Home', url: 'https://www.acme.sg/', source_type: 'url' },
      { title: 'Acme Dental Clinic - services', url: 'https://www.acme.sg/services', source_type: 'url' },
    ];
    expect(updates[0]).toMatchObject({
      websiteUrl: 'https://www.acme.sg/',
      discoveredUrls: ['https://www.acme.sg/', 'https://www.acme.sg/services'],
      trainingPayload: { documents },
      trainingKey: `lead-${LEAD}-train-v1`,
    });
    expect(ingests).toEqual([{ botId: 'mb-1', documents, idempotencyKey: `lead-${LEAD}-train-v1` }]);
    expect(outcome).toMatchObject({ status: 'submitted', trainingId: 'tr-1', documents: 2 });
    expect(current()).toMatchObject({ knowledgeStatus: 'training', trainingId: 'tr-1', trainingSubmittedAt: NOW, knowledgeLockedAt: null });
    expect(current().knowledgeNextAt!.getTime()).toBe(NOW.getTime() + 5_000);
  });

  it('polls while training runs, then stores success in error', async () => {
    const training = trainFixture({ knowledgeStatus: 'training', trainingId: 'tr-1', trainingSubmittedAt: NOW });
    const running = fakeRepo(training);
    const out1 = await trainLeadBot(deps(running.repo, fakeApi({ training: () => ({ status: 'processing', pollAfterSeconds: 8 }) }).api), training);
    expect(out1).toMatchObject({ status: 'training', trainingStatus: 'processing' });
    expect(running.current().knowledgeNextAt!.getTime()).toBe(NOW.getTime() + 8_000);

    const done = fakeRepo(training);
    const out2 = await trainLeadBot(deps(done.repo, fakeApi({ training: () => ({ status: 'completed', total: 2, ready: 2 }) }).api), training);
    expect(out2).toMatchObject({ status: 'trained', ready: 2 });
    expect(done.current()).toMatchObject({ knowledgeStatus: 'trained', error: 'success', trainedAt: NOW, knowledgeNextAt: null });

    const partial = fakeRepo(training);
    await trainLeadBot(deps(partial.repo, fakeApi({ training: () => ({ status: 'partial_failure', total: 10, ready: 8, failed: 2 }) }).api), training);
    expect(partial.current()).toMatchObject({ knowledgeStatus: 'trained', error: 'success: 2 of 10 pages failed to train' });
  });

  it('retries a failed training with a new discovery, and after the third try fails the copy and moves on', async () => {
    const second = trainFixture({ knowledgeStatus: 'training', knowledgeAttempts: 1, trainingId: 'tr-1', trainingKey: `lead-${LEAD}-train-v1`, trainingPayload: { documents: [] } });
    const retry = fakeRepo(second);
    const out1 = await trainLeadBot(deps(retry.repo, fakeApi({ training: () => ({ status: 'failed', total: 2, failed: 2 }) }).api), second);
    expect(out1.status).toBe('retry');
    expect(retry.current()).toMatchObject({ knowledgeStatus: 'pending', trainingPayload: null, trainingId: null, trainingKey: `lead-${LEAD}-train-v1` });

    const third = { ...second, knowledgeAttempts: 3 };
    const last = fakeRepo(third);
    const out2 = await trainLeadBot(deps(last.repo, fakeApi({ training: () => ({ status: 'failed', total: 2, failed: 2 }) }).api), third);
    expect(out2).toMatchObject({ status: 'failed', copiesFailed: 1 });
    expect(last.current()).toMatchObject({ knowledgeStatus: 'failed', error: 'training_failed: 2 pages failed to train' });
    expect(last.failedCopies).toEqual([{ leadId: LEAD, error: 'Bot training failed after 3 attempts: training_failed: 2 pages failed to train' }]);
  });

  it('resends the same saved request after a transient submit error', async () => {
    const payload = { documents: [{ title: 'Acme - Home', url: 'https://www.acme.sg/', source_type: 'url' as const }] };
    const saved = trainFixture({ trainingPayload: payload, trainingKey: `lead-${LEAD}-train-v1` });
    const { repo, current } = fakeRepo(saved);
    const { api, discovers, ingests } = fakeApi({ ingest: () => Promise.reject(apiError('http_503', 503)) });
    const outcome = await trainLeadBot(deps(repo, api), saved);
    expect(discovers).toHaveLength(0);
    expect(ingests[0]).toMatchObject({ idempotencyKey: `lead-${LEAD}-train-v1`, documents: payload.documents });
    expect(outcome.status).toBe('retry');
    expect(current()).toMatchObject({ knowledgeStatus: 'pending', trainingPayload: payload, error: 'http_503: http_503' });
    expect(current().knowledgeNextAt!.getTime()).toBe(NOW.getTime() + 60_000);
  });

  it('fails at once when the page quota is used up or the lead has no website', async () => {
    const quota = fakeRepo(trainFixture());
    const out1 = await trainLeadBot(deps(quota.repo, fakeApi({ ingest: () => Promise.reject(apiError('kb_pages_limit', 409)) }).api), trainFixture());
    expect(out1.status).toBe('failed');
    expect(quota.failedCopies[0]!.error).toBe('Bot training failed: kb_pages_limit: kb_pages_limit');

    const noSite = trainFixture({ company: { id: 'c1', name: 'Acme', domain: null, websiteUrl: null } });
    const none = fakeRepo(noSite);
    expect((await trainLeadBot(deps(none.repo, fakeApi().api), noSite)).status).toBe('failed');
    expect(none.current().error).toMatch(/^no_website/);
  });

  it('pauses without using a try on account errors', async () => {
    const account = fakeRepo(trainFixture());
    const out1 = await trainLeadBot(
      deps(account.repo, fakeApi({ discover: () => Promise.reject(apiError('vendor_subscription_required', 402)) }).api),
      trainFixture(),
    );
    expect(out1.status).toBe('paused');
    expect(account.current()).toMatchObject({ knowledgeStatus: 'pending', knowledgeAttempts: 0 });
    expect(account.current().knowledgeNextAt!.getTime()).toBe(NOW.getTime() + LEAD_BOT_ACCOUNT_PAUSE_MS);
  });

  it("uses one of the bot's tries when MonCha cannot discover its website, so other bots keep training", async () => {
    const refused = () => Promise.reject(apiError('discovery_unavailable', 503));
    const first = fakeRepo(trainFixture());
    const out1 = await trainLeadBot(deps(first.repo, fakeApi({ discover: refused }).api), trainFixture());
    expect(out1).toMatchObject({ status: 'retry', error: expect.stringMatching(/^discovery_unavailable/) });
    expect(first.current()).toMatchObject({ knowledgeStatus: 'pending', knowledgeAttempts: 1 });

    const last = trainFixture({ knowledgeAttempts: 3 });
    const third = fakeRepo(last);
    expect((await trainLeadBot(deps(third.repo, fakeApi({ discover: refused }).api), last)).status).toBe('failed');
    expect(third.current().knowledgeStatus).toBe('failed');
  });

  it('counts a training MonCha leaves processing for 6 hours as trained when pages are ready', async () => {
    const stuck = fakeRepo(trainFixture());
    const old = trainFixture({
      knowledgeStatus: 'training',
      trainingId: 'tr-1',
      trainingSubmittedAt: new Date(NOW.getTime() - LEAD_BOT_TRAINING_MAX_WAIT_MS),
    });
    const processing = () => ({ status: 'processing', total: 100, ready: 98, failed: 0 });
    expect((await trainLeadBot(deps(stuck.repo, fakeApi({ training: processing }).api), old)).status).toBe('trained');
    expect(stuck.current()).toMatchObject({
      knowledgeStatus: 'trained',
      error: 'success: 98 of 100 pages trained; MonCha was still processing the rest after 6h',
    });

    const recent = trainFixture({ knowledgeStatus: 'training', trainingId: 'tr-1', trainingSubmittedAt: NOW });
    const fresh = fakeRepo(recent);
    expect((await trainLeadBot(deps(fresh.repo, fakeApi({ training: processing }).api), recent)).status).toBe('training');
    const nothingReady = fakeRepo(old);
    const none = () => ({ status: 'processing', total: 100, ready: 0, failed: 0 });
    expect((await trainLeadBot(deps(nothingReady.repo, fakeApi({ training: none }).api), old)).status).toBe('training');
  });
});
