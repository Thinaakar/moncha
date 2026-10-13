import { describe, expect, it } from 'vitest';
import {
  SiteDeployError,
  type SiteManifestAsset,
  type SiteSnapshotPatch,
  type SiteSnapshotRepo,
  type SiteStore,
  type SiteWorkerDeployer,
} from '../ports';
import { createConsoleLogger } from '../logger';
import { FIXTURE_NOW, siteSnapshotFixture as snapshot } from './__fixtures__/site-snapshot';
import {
  deploySiteSnapshotToWorker,
  requestSiteWorkerDeploy,
  SITE_WORKER_BACKOFF_MS,
  SITE_WORKER_LIMIT_WAIT_MS,
  SITE_WORKER_MAX_ATTEMPTS,
  siteWorkerPaths,
  SiteWorkerRequestError,
} from './siteWorker';

const NOW = FIXTURE_NOW;
const enc = new TextEncoder();

function asset(storedPath: string, contentType: string): SiteManifestAsset {
  return { id: storedPath, url: `https://ja.edu.sg/${storedPath}`, storedPath, contentType, bytes: 1, sha256: '', kind: 'other', discoveredBy: ['html'] };
}

const ASSETS = [asset('assets/ja.edu.sg/app.css', 'text/css'), asset('assets/ja.edu.sg/logo.png', 'image/png'), asset('assets/ja.edu.sg/logo.png', 'image/png')];

function setup(deploy: SiteWorkerDeployer['deploy'], files: Record<string, string> | null = null) {
  const stored = files ?? {
    'sites/t1/snap1/manifest.json': JSON.stringify({ assets: ASSETS }),
    'sites/t1/snap1/index.html': '<html>',
    'sites/t1/snap1/assets/ja.edu.sg/app.css': 'body{}',
    'sites/t1/snap1/assets/ja.edu.sg/logo.png': 'png',
  };
  const store: SiteStore = {
    put: async () => {},
    get: async () => null,
    getBytes: async (key) => (key in stored ? enc.encode(stored[key]) : null),
  };
  const patches: SiteSnapshotPatch[] = [];
  const snapshots = {
    update: async (_t: string, _id: string, patch: SiteSnapshotPatch) => {
      patches.push(patch);
      return null;
    },
  } as unknown as SiteSnapshotRepo;
  const calls: Array<Parameters<SiteWorkerDeployer['deploy']>[0]> = [];
  const deployer: SiteWorkerDeployer = {
    urlFor: async (name) => `https://${name}.vinothjv4-tech.workers.dev`,
    deploy: async (input) => {
      calls.push(input);
      return deploy(input);
    },
  };
  return { deps: { snapshots, store, deployer, logger: createConsoleLogger(), now: () => NOW }, patches, calls };
}

const ok: SiteWorkerDeployer['deploy'] = async ({ name }) => ({ name, url: `https://${name}.vinothjv4-tech.workers.dev` });

describe('site Worker deploy', () => {
  it('serves index.html at the root and every asset once, with its content type', () => {
    expect(siteWorkerPaths({ assets: ASSETS })).toEqual([
      { key: 'index.html', path: '/index.html', contentType: 'text/html' },
      { key: 'assets/ja.edu.sg/app.css', path: '/assets/ja.edu.sg/app.css', contentType: 'text/css' },
      { key: 'assets/ja.edu.sg/logo.png', path: '/assets/ja.edu.sg/logo.png', contentType: 'image/png' },
    ]);
  });

  it('deploys the site as a Worker named after the website and records the URL', async () => {
    const { deps, patches, calls } = setup(ok);
    const outcome = await deploySiteSnapshotToWorker(deps, snapshot({ workerStatus: 'deploying', workerAttempts: 1 }));
    expect(outcome).toMatchObject({ status: 'deployed', name: 'ja-edu-sg', url: 'https://ja-edu-sg.vinothjv4-tech.workers.dev', files: 3 });
    expect(calls[0]!.name).toBe('ja-edu-sg');
    expect(calls[0]!.files.map((f) => f.path)).toEqual(['/index.html', '/assets/ja.edu.sg/app.css', '/assets/ja.edu.sg/logo.png']);
    expect(patches[0]).toMatchObject({
      workerStatus: 'deployed',
      workerName: 'ja-edu-sg',
      workerUrl: 'https://ja-edu-sg.vinothjv4-tech.workers.dev',
      workerError: null,
      workerDeployedAt: NOW,
    });
    expect(patches[0]).not.toHaveProperty('status');
  });

  it('retries with backoff when Cloudflare fails', async () => {
    const { deps, patches } = setup(async () => {
      throw new SiteDeployError('cloudflare_unavailable', 'Cloudflare error 502');
    });
    const outcome = await deploySiteSnapshotToWorker(deps, snapshot({ workerStatus: 'deploying', workerAttempts: 1 }));
    expect(outcome.status).toBe('retry');
    expect(patches[0]).toMatchObject({
      workerStatus: 'pending',
      workerAttempts: 1,
      workerNextAt: new Date(NOW.getTime() + SITE_WORKER_BACKOFF_MS[0]!),
    });
    expect(patches[0]!.workerError).toContain('cloudflare_unavailable');
  });

  it('gives up at once when the Worker name belongs to something else', async () => {
    const { deps, patches } = setup(async () => {
      throw new SiteDeployError('worker_name_taken', 'taken', false);
    });
    const outcome = await deploySiteSnapshotToWorker(deps, snapshot({ workerStatus: 'deploying', workerAttempts: 1 }));
    expect(outcome.status).toBe('failed');
    expect(patches[0]).toMatchObject({ workerStatus: 'failed', workerNextAt: null });
  });

  it('gives up after the last attempt', async () => {
    const { deps, patches } = setup(async () => {
      throw new Error('socket hang up');
    });
    const outcome = await deploySiteSnapshotToWorker(deps, snapshot({ workerStatus: 'deploying', workerAttempts: SITE_WORKER_MAX_ATTEMPTS }));
    expect(outcome.status).toBe('failed');
  });

  it('waits without using a try when the account has no room for another Worker', async () => {
    const { deps, patches, calls } = setup(ok);
    const reads: string[] = [];
    const getBytes = deps.store.getBytes;
    deps.store.getBytes = async (key) => {
      reads.push(key);
      return getBytes(key);
    };
    deps.deployer.preflight = async () => {
      throw new SiteDeployError('worker_limit_reached', 'The Cloudflare account already has 100 of 100 Workers');
    };
    const outcome = await deploySiteSnapshotToWorker(deps, snapshot({ workerStatus: 'deploying', workerAttempts: 2 }));
    expect(outcome).toMatchObject({ status: 'limit_reached', retryAt: new Date(NOW.getTime() + SITE_WORKER_LIMIT_WAIT_MS) });
    expect(patches[0]).toMatchObject({ workerStatus: 'pending', workerAttempts: 1, workerLockedAt: null });
    expect(patches[0]!.workerError).toContain('worker_limit_reached');
    expect(reads).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('gives up at once when the copy files are gone from R2', async () => {
    const { deps, patches, calls } = setup(ok, {});
    const outcome = await deploySiteSnapshotToWorker(deps, snapshot({ workerStatus: 'deploying', workerAttempts: 1 }));
    expect(outcome.status).toBe('failed');
    expect(calls).toHaveLength(0);
    expect(patches[0]!.workerError).toContain('copy_files_missing');
  });

  it('maps a deploy request that cannot run to an error', async () => {
    const busy = { requestWorkerDeploy: async () => 'busy' } as unknown as SiteSnapshotRepo;
    await expect(requestSiteWorkerDeploy({ snapshots: busy }, { tenantId: 't1', id: 'x' })).rejects.toBeInstanceOf(SiteWorkerRequestError);
    const queued = { requestWorkerDeploy: async () => 'queued' } as unknown as SiteSnapshotRepo;
    await expect(requestSiteWorkerDeploy({ snapshots: queued }, { tenantId: 't1', id: 'x' })).resolves.toEqual({ queued: true });
  });
});
