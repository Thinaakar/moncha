import { describe, expect, it } from 'vitest';
import type {
  JobRepo,
  JobRunRecord,
  SitePipelineRepo,
  SitePipelineSteps,
  SiteSnapshotListItem,
  SiteSnapshotPatch,
  SiteSnapshotRepo,
} from '../ports';
import { createConsoleLogger } from '../logger';
import { FIXTURE_NOW, siteSnapshotFixture } from './__fixtures__/site-snapshot';
import type { SiteGithubPushOutcome } from './siteGithub';
import { describeSitePipeline, runSitePipelineTick, sitePublishStep, type SitePipelineDeps } from './sitePipeline';
import type { SiteWorkerDeployOutcome } from './siteWorker';

const NOW = FIXTURE_NOW;
const LATER = new Date(NOW.getTime() + 60_000);
const STEPS: SitePipelineSteps = { github: true, worker: true };

function site(over: Partial<SiteSnapshotListItem> = {}): SiteSnapshotListItem {
  return siteSnapshotFixture({ githubStatus: null, githubAttempts: 0, ...over });
}

function job(over: Partial<JobRunRecord> = {}): JobRunRecord {
  return {
    id: 'job1',
    tenantId: 't1',
    type: 'site_snapshot',
    status: 'running',
    attempts: 1,
    maxAttempts: 3,
    runAfter: NOW,
    lockedAt: null,
    lockedBy: null,
    result: { snapshotId: 'snap1' },
    ...over,
  };
}

/** In-memory rows; the pipeline queries follow the same rules as the SQL in PrismaSiteSnapshotRepository. */
function setup(rows: { sites: SiteSnapshotListItem[]; jobs: JobRunRecord[] }) {
  const sites = new Map(rows.sites.map((s) => [s.id, { ...s }]));
  const jobRows = new Map(rows.jobs.map((j) => [j.id, { ...j }]));
  const jobOf = (s: SiteSnapshotListItem) => (s.jobId ? jobRows.get(s.jobId) ?? null : null);

  const pipeline: SitePipelineRepo = {
    currentPublish: async () =>
      [...sites.values()].find((s) => s.status === 'done' && jobOf(s)?.status === 'running' && !jobOf(s)?.lockedAt) ?? null,
    inFlightCopy: async () =>
      [...sites.values()].find(
        (s) =>
          (s.status === 'running' || (s.status === 'pending' && s.attempts > 0)) &&
          ['pending', 'running'].includes(jobOf(s)?.status ?? ''),
      ) ?? null,
    nextToPublish: async (steps) => [...sites.values()].find((s) => s.jobId && sitePublishStep(s, steps)) ?? null,
    countToPublish: async (tenantId, steps) =>
      [...sites.values()].filter((s) => s.tenantId === tenantId && s.jobId && sitePublishStep(s, steps)).length,
    countWaitingCopies: async (tenantId) =>
      [...sites.values()].filter((s) => s.tenantId === tenantId && s.status === 'pending' && s.attempts === 0).length,
  };

  const snapshots = {
    get: async (_t: string, id: string) => sites.get(id) ?? null,
    update: async (_t: string, id: string, patch: SiteSnapshotPatch) => {
      const row = sites.get(id);
      if (row) Object.assign(row, patch);
      return row ?? null;
    },
    claimGithubPush: async (now: Date, _stale: Date, options?: { id?: string }) => {
      const row = options?.id ? sites.get(options.id) : undefined;
      if (!row || row.githubStatus !== 'pending' || (row.githubNextAt && row.githubNextAt > now)) return null;
      Object.assign(row, { githubStatus: 'pushing', githubAttempts: row.githubAttempts + 1 });
      return { ...row };
    },
    claimWorkerDeploy: async (now: Date, _stale: Date, options?: { id?: string }) => {
      const row = options?.id ? sites.get(options.id) : undefined;
      if (!row || row.workerStatus !== 'pending' || (row.workerNextAt && row.workerNextAt > now)) return null;
      Object.assign(row, { workerStatus: 'deploying', workerAttempts: row.workerAttempts + 1 });
      return { ...row };
    },
  } as unknown as SiteSnapshotRepo;

  const jobs = {
    get: async (_t: string, id: string) => jobRows.get(id) ?? null,
    update: async (_t: string, id: string, patch: Partial<JobRunRecord>) => {
      const row = jobRows.get(id);
      if (row) Object.assign(row, patch);
      return row ?? null;
    },
  } as unknown as JobRepo;

  const copies: Array<string | undefined> = [];
  const pushed: string[] = [];
  const deployed: string[] = [];
  let pushResult: (row: SiteSnapshotListItem) => Partial<SiteSnapshotListItem> = (row) => ({
    githubStatus: 'pushed',
    githubRepo: `acme/${row.id}`,
  });
  let deployResult: (row: SiteSnapshotListItem) => Partial<SiteSnapshotListItem> = (row) => ({
    workerStatus: 'deployed',
    workerUrl: `https://${row.id}.workers.dev`,
  });

  const deps: SitePipelineDeps = {
    pipeline,
    snapshots,
    jobs,
    claimCopy: async (jobId) => {
      copies.push(jobId);
      return jobId ? jobRows.get(jobId) ?? null : null;
    },
    runCopy: async () => {},
    push: async (row) => {
      pushed.push(row.id);
      Object.assign(sites.get(row.id)!, pushResult(row));
      return { status: sites.get(row.id)!.githubStatus } as SiteGithubPushOutcome;
    },
    deploy: async (row) => {
      deployed.push(row.id);
      Object.assign(sites.get(row.id)!, deployResult(row));
      return { status: sites.get(row.id)!.workerStatus } as SiteWorkerDeployOutcome;
    },
    logger: createConsoleLogger(),
    now: () => NOW,
  };

  return {
    deps,
    sites,
    jobRows,
    copies,
    pushed,
    deployed,
    failPush: (error: string) => {
      pushResult = () => ({ githubStatus: 'failed', githubError: error });
    },
    failDeploy: (error: string) => {
      deployResult = () => ({ workerStatus: 'failed', workerError: error });
    },
  };
}

describe('site pipeline', () => {
  it('pushes, deploys and only then finishes the website as done with its live URL', async () => {
    const t = setup({ sites: [site()], jobs: [job()] });

    expect(await runSitePipelineTick(t.deps)).toMatchObject({ action: 'ran', step: 'github', snapshotId: 'snap1' });
    expect(t.jobRows.get('job1')!.status).toBe('running');

    expect(await runSitePipelineTick(t.deps)).toEqual({ action: 'finished', snapshotId: 'snap1', status: 'done' });
    expect(t.pushed).toEqual(['snap1']);
    expect(t.deployed).toEqual(['snap1']);
    expect(t.jobRows.get('job1')).toMatchObject({
      status: 'done',
      lastError: null,
      finishedAt: NOW,
      result: { snapshotId: 'snap1', liveUrl: 'https://snap1.workers.dev', githubRepo: 'acme/snap1' },
    });
    expect(t.copies).toEqual([]);
  });

  it('waits for the current website to retry instead of starting the next copy', async () => {
    const t = setup({
      sites: [site({ githubStatus: 'pending', githubAttempts: 1, githubNextAt: LATER, githubError: 'github_unavailable: 502' })],
      jobs: [job()],
    });
    expect(await runSitePipelineTick(t.deps)).toEqual({ action: 'waiting', step: 'github', snapshotId: 'snap1', until: LATER });
    expect(t.pushed).toEqual([]);
    expect(t.copies).toEqual([]);
  });

  it('stays on the website while the Cloudflare account is full', async () => {
    const t = setup({
      sites: [
        site({
          githubStatus: 'pushed',
          workerStatus: 'pending',
          workerAttempts: 0,
          workerNextAt: LATER,
          workerError: 'worker_limit_reached: 100 Workers',
        }),
      ],
      jobs: [job()],
    });
    expect(await runSitePipelineTick(t.deps)).toMatchObject({ action: 'waiting', step: 'deploy', until: LATER });
    expect(t.copies).toEqual([]);
  });

  it('fails the website when a step gives up, then moves on to the next copy', async () => {
    const t = setup({ sites: [site()], jobs: [job()] });
    t.failPush('github_unavailable: 502');

    expect(await runSitePipelineTick(t.deps)).toEqual({ action: 'finished', snapshotId: 'snap1', status: 'failed' });
    expect(t.jobRows.get('job1')).toMatchObject({ status: 'failed', lastError: 'GitHub push failed: github_unavailable: 502' });
    expect(t.deployed).toEqual([]);

    expect(await runSitePipelineTick(t.deps)).toEqual({ action: 'idle' });
    expect(t.copies).toEqual([undefined]);
  });

  it('fails the website with the deploy error when the Worker deploy gives up', async () => {
    const t = setup({ sites: [site({ githubStatus: 'pushed', githubRepo: 'acme/snap1' })], jobs: [job()] });
    t.failDeploy('cloudflare_unavailable: 502');
    expect(await runSitePipelineTick(t.deps)).toMatchObject({ action: 'finished', status: 'failed' });
    expect(t.jobRows.get('job1')).toMatchObject({ status: 'failed', lastError: 'Deploy failed: cloudflare_unavailable: 502' });
  });

  it('finishes a website whose step already gave up before a restart', async () => {
    const t = setup({ sites: [site({ githubStatus: 'failed', githubError: 'github_repo_taken: exists' })], jobs: [job()] });
    expect(await runSitePipelineTick(t.deps)).toMatchObject({ action: 'finished', status: 'failed' });
    expect(t.pushed).toEqual([]);
  });

  it('retries a copy that is due by claiming its own job, and waits when it is not', async () => {
    const copy = site({ status: 'pending', attempts: 1, githubStatus: null });
    const waiting = setup({ sites: [copy], jobs: [job({ status: 'pending', runAfter: LATER })] });
    expect(await runSitePipelineTick(waiting.deps)).toEqual({ action: 'waiting', step: 'copy', snapshotId: 'snap1', until: LATER });
    expect(waiting.copies).toEqual([]);

    const due = setup({ sites: [copy], jobs: [job({ status: 'pending', runAfter: NOW })] });
    expect(await runSitePipelineTick(due.deps)).toMatchObject({ action: 'ran', step: 'copy', jobId: 'job1' });
    expect(due.copies).toEqual(['job1']);
  });

  it('publishes an older copy that was never pushed, holding its job as running', async () => {
    const t = setup({ sites: [site()], jobs: [job({ status: 'done', finishedAt: NOW })] });
    expect(await runSitePipelineTick(t.deps)).toMatchObject({ action: 'ran', step: 'github' });
    expect(t.jobRows.get('job1')).toMatchObject({ status: 'running', startedAt: NOW, finishedAt: null, lockedAt: null });
    expect(await runSitePipelineTick(t.deps)).toMatchObject({ action: 'finished', status: 'done' });
    expect(t.jobRows.get('job1')!.status).toBe('done');
  });

  it('starts the next copy only when nothing is left to publish', async () => {
    const t = setup({ sites: [], jobs: [] });
    expect(await runSitePipelineTick(t.deps)).toEqual({ action: 'idle' });
    expect(t.copies).toEqual([undefined]);
  });
});

describe('describeSitePipeline', () => {
  it('shows a paused pipeline while the Cloudflare account is full', async () => {
    const t = setup({
      sites: [
        site({ githubStatus: 'pushed', workerStatus: 'pending', workerAttempts: 0, workerNextAt: LATER, workerError: 'worker_limit_reached: full' }),
        site({ id: 'snap2', jobId: 'job2' }),
      ],
      jobs: [job(), job({ id: 'job2', status: 'done' })],
    });
    const view = await describeSitePipeline({ ...t.deps, steps: STEPS }, { tenantId: 't1' });
    expect(view.current).toMatchObject({ step: 'deploy', state: 'paused', nextAt: LATER, maxAttempts: 3 });
    expect(view.toPublish).toBe(1);
  });

  it('shows a retrying step with its try count and error', async () => {
    const t = setup({
      sites: [site({ githubStatus: 'pending', githubAttempts: 1, githubNextAt: LATER, githubError: 'github_unavailable: 502' })],
      jobs: [job()],
    });
    const view = await describeSitePipeline({ ...t.deps, steps: STEPS }, { tenantId: 't1' });
    expect(view.current).toMatchObject({ step: 'github', state: 'retrying', attempts: 1, error: 'github_unavailable: 502' });
    expect(view.toPublish).toBe(0);
  });

  it("hides another tenant's website", async () => {
    const t = setup({ sites: [site()], jobs: [job()] });
    const view = await describeSitePipeline({ ...t.deps, steps: STEPS }, { tenantId: 't2' });
    expect(view.current).toBeNull();
  });
});
