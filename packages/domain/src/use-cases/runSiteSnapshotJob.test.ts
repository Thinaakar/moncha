import { describe, expect, it } from 'vitest';
import {
  BrandExtractionError,
  SiteCaptureError,
  type BrandExtractor,
  type JobPatch,
  type JobRepo,
  type JobRunRecord,
  type LeadListItem,
  type LeadRepo,
  type LlmUsageRepo,
  type SiteCaptureResult,
  type SiteCapturer,
  type SiteSnapshotListItem,
  type SiteSnapshotPatch,
  type SiteSnapshotRepo,
  type SiteStore,
} from '../ports';
import { runSiteSnapshotJob, type SiteSnapshotJobDeps } from './runSiteSnapshotJob';
import { queueSiteSnapshot, SiteSnapshotRequestError } from './siteSnapshots';

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);
const silent = { info: () => undefined, error: () => undefined };

function captureResult(): SiteCaptureResult {
  const source = enc('<html><head></head><body><img src="https://cdn.x.com/logo.png"></body></html>');
  return {
    sourceUrl: 'https://x.com',
    finalUrl: 'https://x.com/',
    httpStatus: 200,
    redirects: [],
    source: { bytes: source, sha256: 'abc', charset: 'utf-8', charsetSource: 'header' },
    renderedHtml: '<html><body>rendered</body></html>',
    indexHtml: enc('<html><head></head><body><img src="assets/cdn.x.com/logo.png"></body></html>'),
    files: [{ path: 'assets/cdn.x.com/logo.png', bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' }],
    screenshots: { desktop: new Uint8Array([9]), mobile: new Uint8Array([8]), desktopViewport: new Uint8Array([7]) },
    evidence: {
      title: 'X Clinic',
      description: null,
      lang: 'en',
      visibleText: 'X Clinic',
      meta: {},
      jsonLd: [],
      links: { tel: ['+6012345678'], mailto: [], whatsapp: [], social: [] },
      colors: [{ value: '#123456', usage: 'button-background', count: 3 }],
      fonts: [],
      logoCandidates: [{ assetId: 'a_logo', url: 'https://cdn.x.com/logo.png', inHeader: true, source: 'img' }],
      sourceTextLength: 10,
      renderedTextLength: 10,
    },
    manifest: {
      version: 1,
      sourceUrl: 'https://x.com',
      finalUrl: 'https://x.com/',
      redirects: [],
      capturedAt: '2026-10-08T00:00:00.000Z',
      source: { bytes: source.byteLength, sha256: 'abc', charset: 'utf-8', charsetSource: 'header' },
      assets: [
        {
          id: 'a_logo',
          url: 'https://cdn.x.com/logo.png',
          storedPath: 'assets/cdn.x.com/logo.png',
          contentType: 'image/png',
          bytes: 3,
          sha256: 'def',
          kind: 'image',
          discoveredBy: ['html'],
        },
      ],
      skipped: [{ url: 'https://www.googletagmanager.com/gtm.js', reason: 'tracking' }],
      rewrites: { index: 1, css: 0, unresolved: 0 },
      exceptions: [],
      limits: { maxAssets: 400, maxFileBytes: 1, maxTotalBytes: 1 },
    },
    warnings: [],
  };
}

function setup(over: Partial<SiteSnapshotJobDeps> = {}, jobOver: Partial<JobRunRecord> = {}) {
  const snapshot: SiteSnapshotListItem = {
    id: 'snap1',
    tenantId: 't1',
    leadId: 'lead1',
    jobId: 'job1',
    status: 'pending',
    sourceUrl: 'https://x.com',
    finalUrl: null,
    httpStatus: null,
    storagePrefix: 'sites/t1/snap1/',
    sourceHash: null,
    sourceBytes: null,
    sourceCharset: null,
    assetCount: 0,
    skippedAssetCount: 0,
    totalBytes: 0,
    brand: null,
    llmModel: null,
    llmPromptTokens: null,
    llmCompletionTokens: null,
    warnings: [],
    failureReason: null,
    createdAt: new Date(),
    finishedAt: null,
    company: { id: 'c1', name: 'X Clinic Sdn Bhd', domain: 'x.com' },
  };
  const jobPatches: JobPatch[] = [];
  const snapPatches: SiteSnapshotPatch[] = [];
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  const jobs: JobRepo = {
    create: async () => {
      throw new Error('unused');
    },
    update: async (_t, _id, patch) => {
      jobPatches.push(patch);
      return null;
    },
    get: async () => null,
  };
  const snapshots: SiteSnapshotRepo = {
    createWithJob: async () => {
      throw new Error('unused');
    },
    get: async () => snapshot,
    update: async (_t, _id, patch) => {
      snapPatches.push(patch);
      Object.assign(snapshot, patch);
      return snapshot;
    },
    findOpenForLead: async () => null,
    listForLead: async () => [],
    list: async () => ({ items: [], total: 0, page: 1, pageSize: 25, totalPages: 0 }),
  };
  const leads = {
    get: async () =>
      ({
        id: 'lead1',
        tenantId: 't1',
        companyId: 'c1',
        queue: 'QUALIFIED',
        version: 1,
        company: { id: 'c1', tenantId: 't1', name: 'X Clinic Sdn Bhd', domain: 'x.com', phone: '+6012345678', country: 'MY' },
      }) as LeadListItem,
  } as unknown as LeadRepo;
  const store: SiteStore = {
    put: async (key, bytes, contentType) => {
      objects.set(key, { bytes, contentType });
    },
    get: async () => null,
    getBytes: async (key) => objects.get(key)?.bytes ?? null,
  };
  const capturer: SiteCapturer = { capture: async () => captureResult() };
  const brandExtractor: BrandExtractor = {
    extract: async (input) => {
      await input.budget?.allow();
      await input.budget?.record(false);
      return {
        brand: {
          businessName: 'X Clinic',
          logo: { assetId: 'a_logo' },
          colors: { primary: '#123456', secondary: null, accent: null, background: null, text: null },
          fonts: { heading: null, body: null },
          contact: { phones: ['+6012345678'], emails: [], address: null, whatsapp: null },
          services: [],
          hours: [],
          hoursText: null,
          socialLinks: [],
          language: 'en',
          tone: null,
          chatbot: { greeting: 'Hello from X!', faqs: [] },
          confidence: 0.9,
          notes: null,
          source: 'llm',
        },
        model: 'google/gemini-3.5-flash',
        usage: { promptTokens: 1000, completionTokens: 200 },
        warnings: [],
      };
    },
  };
  const usage = { calls: 0 };
  const llmUsage: LlmUsageRepo = {
    get: async () => ({ calls: usage.calls, failedCalls: 0 }),
    increment: async () => {
      usage.calls += 1;
      return { calls: usage.calls, failedCalls: 0 };
    },
  };
  const deps: SiteSnapshotJobDeps = {
    jobs,
    snapshots,
    leads,
    capturer,
    brandExtractor,
    store,
    llmUsage,
    maxLlmCallsPerDay: 10,
    widgetJs: '/* widget */',
    logger: silent,
    ...over,
  };
  const job: JobRunRecord = {
    id: 'job1',
    tenantId: 't1',
    type: 'site_snapshot',
    status: 'running',
    payload: { snapshotId: 'snap1', leadId: 'lead1', url: 'https://x.com' },
    attempts: 1,
    maxAttempts: 2,
    runAfter: new Date(),
    ...jobOver,
  };
  return { deps, job, snapshot, jobPatches, snapPatches, objects, usage };
}

describe('runSiteSnapshotJob', () => {
  it('uploads every file under the snapshot prefix and marks both rows done', async () => {
    const s = setup();
    const outcome = await runSiteSnapshotJob(s.deps, { job: s.job });
    expect(outcome.status).toBe('done');
    expect([...s.objects.keys()].sort()).toEqual(
      [
        'assets/cdn.x.com/logo.png',
        'brand.json',
        'demo.html',
        'index.html',
        'manifest.json',
        'moncha-widget.js',
        'rendered.html',
        'screenshot-desktop.png',
        'screenshot-mobile.png',
        'source.html',
      ].map((k) => `sites/t1/snap1/${k}`),
    );
    const index = dec(s.objects.get('sites/t1/snap1/index.html')!.bytes);
    const demo = dec(s.objects.get('sites/t1/snap1/demo.html')!.bytes);
    expect(index).not.toContain('data-moncha-demo');
    expect(demo).toContain('data-moncha-demo');
    expect(demo).toContain('"logoPath":"assets/cdn.x.com/logo.png"');
    expect(Buffer.from(s.objects.get('sites/t1/snap1/source.html')!.bytes).equals(Buffer.from(captureResult().source.bytes))).toBe(true);
    const manifest = JSON.parse(dec(s.objects.get('sites/t1/snap1/manifest.json')!.bytes));
    expect(manifest.snapshotId).toBe('snap1');
    expect(s.snapshot).toMatchObject({
      status: 'done',
      assetCount: 1,
      skippedAssetCount: 1,
      llmModel: 'google/gemini-3.5-flash',
      llmPromptTokens: 1000,
      sourceCharset: 'utf-8',
    });
    expect(s.jobPatches.at(-1)).toMatchObject({ status: 'done', lockedAt: null });
    expect(s.usage.calls).toBe(1);
  });

  it('falls back to an evidence brand when the LLM budget is used up', async () => {
    const s = setup({
      brandExtractor: {
        extract: async () => {
          throw new BrandExtractionError('budget_exhausted');
        },
      },
    });
    const outcome = await runSiteSnapshotJob(s.deps, { job: s.job });
    expect(outcome).toMatchObject({ status: 'done', brandSource: 'evidence' });
    expect(s.snapshot.warnings).toContain('llm_skipped:budget_exhausted');
    expect(s.snapshot.brand?.colors.primary).toBe('#123456');
    expect(s.snapshot.llmModel).toBeNull();
  });

  it('uses the evidence brand when no LLM is configured', async () => {
    const s = setup({ brandExtractor: null });
    await runSiteSnapshotJob(s.deps, { job: s.job });
    expect(s.snapshot.warnings).toContain('llm_skipped:not_configured');
    expect(s.snapshot.brand?.source).toBe('evidence');
  });

  it('requeues a transient failure with the same snapshot', async () => {
    const s = setup({ capturer: { capture: async () => Promise.reject(new SiteCaptureError('render_failed')) } });
    const outcome = await runSiteSnapshotJob(s.deps, { job: s.job });
    expect(outcome).toMatchObject({ status: 'retry', reason: 'render_failed' });
    expect(s.snapshot.status).toBe('pending');
    expect(s.jobPatches.at(-1)).toMatchObject({ status: 'pending', lastError: 'render_failed' });
  });

  it('fails permanently on robots or after the last attempt', async () => {
    const robots = setup({ capturer: { capture: async () => Promise.reject(new SiteCaptureError('robots_disallowed')) } });
    expect(await runSiteSnapshotJob(robots.deps, { job: robots.job })).toMatchObject({ status: 'failed', reason: 'robots_disallowed' });
    expect(robots.snapshot).toMatchObject({ status: 'failed', failureReason: 'robots_disallowed' });

    const last = setup({ capturer: { capture: async () => Promise.reject(new Error('boom')) } }, { attempts: 2 });
    expect(await runSiteSnapshotJob(last.deps, { job: last.job })).toMatchObject({ status: 'failed' });
    expect(last.jobPatches.at(-1)).toMatchObject({ status: 'failed' });
  });

  it('times out a capture that runs too long', async () => {
    const s = setup(
      {
        capturer: {
          capture: ({ signal }) =>
            new Promise((_, reject) => signal?.addEventListener('abort', () => reject(new SiteCaptureError('timeout')))),
        },
      },
      { attempts: 2 },
    );
    const outcome = await runSiteSnapshotJob(s.deps, { job: s.job, timeoutMs: 20 });
    expect(outcome).toMatchObject({ status: 'failed', reason: 'timeout' });
  });

  it('skips a snapshot that is already done', async () => {
    const s = setup();
    s.snapshot.status = 'done';
    expect(await runSiteSnapshotJob(s.deps, { job: s.job })).toEqual({ status: 'skipped', snapshotId: 'snap1' });
    expect(s.objects.size).toBe(0);
  });
});

describe('queueSiteSnapshot', () => {
  const lead = (website: { url: string } | null, domain: string | null = null) =>
    ({ id: 'l1', company: { id: 'c1', name: 'X', domain, website } }) as unknown as LeadListItem;

  it('rejects leads without a website', async () => {
    const deps = { leads: { get: async () => lead(null) } as unknown as LeadRepo, snapshots: {} as SiteSnapshotRepo };
    await expect(queueSiteSnapshot(deps, { tenantId: 't', leadId: 'l1' })).rejects.toBeInstanceOf(SiteSnapshotRequestError);
  });

  it('returns the open snapshot instead of queueing another', async () => {
    const open = { id: 'snapOpen' };
    const deps = {
      leads: { get: async () => lead({ url: 'x.com' }) } as unknown as LeadRepo,
      snapshots: { findOpenForLead: async () => open } as unknown as SiteSnapshotRepo,
    };
    expect(await queueSiteSnapshot(deps, { tenantId: 't', leadId: 'l1' })).toEqual({ snapshot: open, job: null, deduped: true });
  });

  it('creates the snapshot and job with a normalized URL', async () => {
    let created: unknown;
    const deps = {
      leads: { get: async () => lead(null, 'clinic.my') } as unknown as LeadRepo,
      snapshots: {
        findOpenForLead: async () => null,
        createWithJob: async (input: unknown) => {
          created = input;
          return { snapshot: { id: 's' }, job: { id: 'j' } };
        },
      } as unknown as SiteSnapshotRepo,
    };
    const result = await queueSiteSnapshot(deps, { tenantId: 't', leadId: 'l1' });
    expect(result.deduped).toBe(false);
    expect(created).toEqual({ tenantId: 't', leadId: 'l1', sourceUrl: 'https://clinic.my/', maxAttempts: 2 });
  });
});
