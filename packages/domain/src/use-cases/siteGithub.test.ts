import { describe, expect, it } from 'vitest';
import {
  SiteGithubError,
  type SiteGithubFile,
  type SiteGithubPublisher,
  type SiteManifestAsset,
  type SiteSnapshotListItem,
  type SiteSnapshotPatch,
  type SiteSnapshotRepo,
  type SiteStore,
} from '../ports';
import { createConsoleLogger } from '../logger';
import {
  pushSiteSnapshotToGithub,
  requestSiteGithubPush,
  SITE_GITHUB_BACKOFF_MS,
  SITE_GITHUB_MAX_ATTEMPTS,
  siteGithubDomain,
  siteGithubPaths,
  SiteGithubRequestError,
} from './siteGithub';

const NOW = new Date('2026-10-09T10:00:00.000Z');
const enc = new TextEncoder();

function asset(storedPath: string, kind: SiteManifestAsset['kind']): SiteManifestAsset {
  return { id: storedPath, url: `https://ja.edu.sg/${storedPath}`, storedPath, contentType: '', bytes: 1, sha256: '', kind, discoveredBy: ['html'] };
}

const ASSETS = [
  asset('assets/ja.edu.sg/wp-content/theme.css', 'css'),
  asset('assets/ja.edu.sg/wp-includes/jquery.min.js', 'js'),
  asset('assets/ja.edu.sg/wp-content/logo.png', 'image'),
  asset('assets/fonts.gstatic.com/roboto.woff2', 'font'),
];

function snapshot(over: Partial<SiteSnapshotListItem> = {}): SiteSnapshotListItem {
  return {
    id: 'snap1',
    tenantId: 't1',
    leadId: 'lead1',
    jobId: 'job1',
    status: 'done',
    sourceUrl: 'https://www.ja.edu.sg/',
    finalUrl: 'https://www.ja.edu.sg/',
    httpStatus: 200,
    storagePrefix: 'sites/t1/snap1/',
    sourceHash: null,
    sourceBytes: null,
    sourceCharset: 'utf-8',
    assetCount: 4,
    skippedAssetCount: 0,
    totalBytes: 0,
    brand: null,
    llmModel: null,
    llmPromptTokens: null,
    llmCompletionTokens: null,
    warnings: [],
    failureReason: null,
    origin: 'auto',
    crawlJobId: 'crawl1',
    githubStatus: 'pushing',
    githubAttempts: 1,
    githubNextAt: null,
    githubCommitSha: null,
    githubCommitUrl: null,
    githubFolderUrl: null,
    githubError: null,
    githubPushedAt: null,
    createdAt: NOW,
    finishedAt: NOW,
    company: { id: 'c1', name: 'Jurong Academy', domain: 'ja.edu.sg' },
    ...over,
  };
}

function setup(publish: SiteGithubPublisher['publish'], storeFiles?: Record<string, string>) {
  const files: Record<string, string> = storeFiles ?? {
    'sites/t1/snap1/manifest.json': JSON.stringify({ assets: ASSETS }),
    'sites/t1/snap1/index.html': '<html>',
    'sites/t1/snap1/demo.html': '<html>demo',
    'sites/t1/snap1/source.html': '<html>src',
    'sites/t1/snap1/rendered.html': '<html>dom',
    'sites/t1/snap1/brand.json': '{}',
    'sites/t1/snap1/assets/ja.edu.sg/wp-content/theme.css': 'body{}',
    'sites/t1/snap1/assets/ja.edu.sg/wp-includes/jquery.min.js': 'x',
    'sites/t1/snap1/assets/ja.edu.sg/wp-content/logo.png': 'png',
  };
  const store: SiteStore = {
    put: async () => {},
    get: async () => null,
    getBytes: async (key) => (key in files ? enc.encode(files[key]) : null),
  };
  const patches: SiteSnapshotPatch[] = [];
  const snapshots = {
    update: async (_t: string, _id: string, patch: SiteSnapshotPatch) => {
      patches.push(patch);
      return null;
    },
  } as unknown as SiteSnapshotRepo;
  const calls: Array<{ folder: string; files: SiteGithubFile[]; message: string }> = [];
  const publisher: SiteGithubPublisher = {
    repo: 'Thinaakar/moncha-sites',
    branch: 'main',
    publish: async (input) => {
      calls.push(input);
      return publish(input);
    },
  };
  const deps = { snapshots, store, publisher, logger: createConsoleLogger(), now: () => NOW };
  return { deps, patches, calls };
}

const ok: SiteGithubPublisher['publish'] = async () => ({
  commitSha: 'abc123',
  commitUrl: 'https://github.com/Thinaakar/moncha-sites/commit/abc123',
  folderUrl: 'https://github.com/Thinaakar/moncha-sites/tree/main/sites/ja.edu.sg/snap1',
});

describe('site GitHub push', () => {
  it('names the folder after the domain without www', () => {
    expect(siteGithubDomain(snapshot())).toBe('ja.edu.sg');
    expect(siteGithubDomain(snapshot({ company: { id: 'c', name: 'x', domain: null } }))).toBe('ja.edu.sg');
    expect(siteGithubDomain(snapshot({ company: { id: 'c', name: 'x', domain: 'WWW.Foo_Bar.com' } }))).toBe('foo-bar.com');
  });

  it('pushes HTML, CSS, JS and the JSON files but no images or fonts', () => {
    const paths = siteGithubPaths({ assets: ASSETS });
    expect(paths).toEqual(
      expect.arrayContaining(['index.html', 'demo.html', 'source.html', 'rendered.html', 'moncha-widget.js', 'brand.json', 'manifest.json']),
    );
    expect(paths).toContain('assets/ja.edu.sg/wp-content/theme.css');
    expect(paths).toContain('assets/ja.edu.sg/wp-includes/jquery.min.js');
    expect(paths.some((p) => p.endsWith('.png') || p.endsWith('.woff2'))).toBe(false);
  });

  it('commits sites/{domain}/{id}/ and records the commit link', async () => {
    const { deps, patches, calls } = setup(ok);
    const outcome = await pushSiteSnapshotToGithub(deps, snapshot());
    expect(outcome.status).toBe('pushed');
    expect(calls[0]!.folder).toBe('sites/ja.edu.sg/snap1');
    // moncha-widget.js is missing from this store, so it is skipped instead of failing the push.
    expect(calls[0]!.files.map((f) => f.path)).toEqual([
      'assets/ja.edu.sg/wp-content/theme.css',
      'assets/ja.edu.sg/wp-includes/jquery.min.js',
      'brand.json',
      'demo.html',
      'index.html',
      'manifest.json',
      'rendered.html',
      'source.html',
    ]);
    expect(calls[0]!.message).toContain('ja.edu.sg (snap1)');
    expect(patches[0]).toMatchObject({
      githubStatus: 'pushed',
      githubCommitUrl: 'https://github.com/Thinaakar/moncha-sites/commit/abc123',
      githubError: null,
      githubPushedAt: NOW,
    });
    expect(patches[0]).not.toHaveProperty('status');
  });

  it('keeps the copy done and schedules a retry with backoff when GitHub fails', async () => {
    const { deps, patches } = setup(async () => {
      throw new SiteGithubError('github_bad_token', 'GitHub rejected GITHUB_TOKEN');
    });
    const outcome = await pushSiteSnapshotToGithub(deps, snapshot({ githubAttempts: 2 }));
    expect(outcome.status).toBe('retry');
    expect(patches[0]).toMatchObject({
      githubStatus: 'pending',
      githubAttempts: 2,
      githubNextAt: new Date(NOW.getTime() + SITE_GITHUB_BACKOFF_MS[1]!),
    });
    expect(patches[0]!.githubError).toContain('github_bad_token');
    expect(patches[0]).not.toHaveProperty('status');
  });

  it('gives up after the last attempt', async () => {
    const { deps, patches } = setup(async () => {
      throw new Error('socket hang up');
    });
    const outcome = await pushSiteSnapshotToGithub(deps, snapshot({ githubAttempts: SITE_GITHUB_MAX_ATTEMPTS }));
    expect(outcome.status).toBe('failed');
    expect(patches[0]).toMatchObject({ githubStatus: 'failed', githubNextAt: null });
  });

  it('gives up at once when the copy files are gone from R2', async () => {
    const { deps, patches, calls } = setup(ok, {});
    const outcome = await pushSiteSnapshotToGithub(deps, snapshot());
    expect(outcome.status).toBe('failed');
    expect(calls).toHaveLength(0);
    expect(patches[0]!.githubError).toContain('copy_files_missing');
  });

  it('gives the attempt back when the worker stops', async () => {
    const controller = new AbortController();
    const { deps, patches } = setup(async () => {
      controller.abort();
      throw new SiteGithubError('worker_shutdown');
    });
    const outcome = await pushSiteSnapshotToGithub(deps, snapshot({ githubAttempts: 3, githubError: 'old' }), controller.signal);
    expect(outcome.status).toBe('retry');
    expect(patches[0]).toMatchObject({ githubStatus: 'pending', githubAttempts: 2, githubError: 'old', githubNextAt: NOW });
  });

  it('maps a push request that cannot run to an error', async () => {
    const snapshots = { requestGithubPush: async () => 'not_done' } as unknown as SiteSnapshotRepo;
    await expect(requestSiteGithubPush({ snapshots }, { tenantId: 't1', id: 'x' })).rejects.toBeInstanceOf(SiteGithubRequestError);
    const queued = { requestGithubPush: async () => 'queued' } as unknown as SiteSnapshotRepo;
    await expect(requestSiteGithubPush({ snapshots: queued }, { tenantId: 't1', id: 'x' })).resolves.toEqual({ queued: true });
  });
});
