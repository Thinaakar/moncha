import { describe, expect, it } from 'vitest';
import {
  SiteGithubError,
  type SiteGithubPublisher,
  type SiteManifestAsset,
  type SiteSnapshotPatch,
  type SiteSnapshotRepo,
  type SiteStore,
} from '../ports';
import { createConsoleLogger } from '../logger';
import { FIXTURE_NOW, siteSnapshotFixture } from './__fixtures__/site-snapshot';
import {
  pushSiteSnapshotToGithub,
  requestSiteGithubPush,
  SITE_GITHUB_BACKOFF_MS,
  SITE_GITHUB_MAX_ATTEMPTS,
  SITE_REPO_TOPIC,
  siteGithubDomain,
  siteName,
  siteRepoPaths,
  siteRepoSpec,
  SiteGithubRequestError,
} from './siteGithub';

const NOW = FIXTURE_NOW;
const enc = new TextEncoder();
const dec = new TextDecoder();

function asset(storedPath: string, kind: SiteManifestAsset['kind']): SiteManifestAsset {
  return { id: storedPath, url: `https://ja.edu.sg/${storedPath}`, storedPath, contentType: '', bytes: 1, sha256: '', kind, discoveredBy: ['html'] };
}

const ASSETS = [
  asset('assets/ja.edu.sg/wp-content/theme.css', 'css'),
  asset('assets/ja.edu.sg/wp-includes/jquery.min.js', 'js'),
  asset('assets/ja.edu.sg/wp-content/logo.png', 'image'),
  asset('assets/fonts.gstatic.com/roboto.woff2', 'font'),
];

const snapshot = siteSnapshotFixture;

const STORE_FILES: Record<string, string> = {
  'sites/t1/snap1/manifest.json': JSON.stringify({ assets: ASSETS }),
  'sites/t1/snap1/index.html': '<html>',
  'sites/t1/snap1/source.html': '<html>src',
  'sites/t1/snap1/rendered.html': '<html>dom',
  'sites/t1/snap1/brand.json': '{}',
  'sites/t1/snap1/screenshot-desktop.png': 'png',
  'sites/t1/snap1/assets/ja.edu.sg/wp-content/theme.css': 'body{}',
  'sites/t1/snap1/assets/ja.edu.sg/wp-includes/jquery.min.js': 'x',
  'sites/t1/snap1/assets/ja.edu.sg/wp-content/logo.png': 'png',
};

function setup(publish: SiteGithubPublisher['publish'], storeFiles: Record<string, string> = STORE_FILES) {
  const store: SiteStore = {
    put: async () => {},
    get: async () => null,
    getBytes: async (key) => (key in storeFiles ? enc.encode(storeFiles[key]) : null),
  };
  const patches: SiteSnapshotPatch[] = [];
  const snapshots = {
    update: async (_t: string, _id: string, patch: SiteSnapshotPatch) => {
      patches.push(patch);
      return null;
    },
  } as unknown as SiteSnapshotRepo;
  const calls: Array<Parameters<SiteGithubPublisher['publish']>[0]> = [];
  const publisher: SiteGithubPublisher = {
    owner: 'Thinaakar',
    branch: 'main',
    publish: async (input) => {
      calls.push(input);
      return publish(input);
    },
  };
  const deps = {
    snapshots,
    store,
    publisher,
    logger: createConsoleLogger(),
    liveUrlFor: async (name: string) => `https://${name}.vinothjv4-tech.workers.dev`,
    now: () => NOW,
  };
  return { deps, patches, calls };
}

const ok: SiteGithubPublisher['publish'] = async ({ repo }) => ({
  repo: `Thinaakar/${repo.name}`,
  repoUrl: `https://github.com/Thinaakar/${repo.name}`,
  commitSha: 'abc123',
  commitUrl: `https://github.com/Thinaakar/${repo.name}/commit/abc123`,
  created: true,
});

describe('site names', () => {
  it('uses the domain without www, dots as dashes', () => {
    expect(siteGithubDomain(snapshot())).toBe('ja.edu.sg');
    expect(siteName(snapshot())).toBe('ja-edu-sg');
    expect(siteName(snapshot({ company: { id: 'c', name: 'x', domain: null } }))).toBe('ja-edu-sg');
    expect(siteName(snapshot({ company: { id: 'c', name: 'x', domain: 'WWW.Foo_Bar.co.uk' } }))).toBe('foo-bar-co-uk');
  });

  it('fits one DNS label and never ends with a dash', () => {
    const name = siteName(snapshot({ company: { id: 'c', name: 'x', domain: `${'a'.repeat(62)}.b.com` } }));
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name).toMatch(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/);
  });

  it('falls back to the copy id without a usable domain', () => {
    const name = siteName(snapshot({ id: 'CmAbc123', sourceUrl: 'not a url', finalUrl: null, company: { id: 'c', name: 'x', domain: null } }));
    expect(name).toBe('copy-cmabc123');
  });
});

describe('site repo', () => {
  it('puts the website under public/ and the copy data under moncha/', () => {
    const paths = siteRepoPaths({ assets: ASSETS });
    expect(paths).toEqual(
      expect.arrayContaining([
        { key: 'index.html', path: 'public/index.html' },
        { key: 'assets/ja.edu.sg/wp-content/logo.png', path: 'public/assets/ja.edu.sg/wp-content/logo.png' },
        { key: 'brand.json', path: 'moncha/brand.json' },
        { key: 'manifest.json', path: 'moncha/manifest.json' },
        { key: 'source.html', path: 'moncha/source.html' },
      ]),
    );
    expect(paths.some((p) => p.key.startsWith('screenshot') || p.key === 'rendered.html')).toBe(false);
  });

  it('marks automatic and manual copies in the description and topics', () => {
    expect(siteRepoSpec(snapshot(), null)).toMatchObject({
      name: 'ja-edu-sg',
      description: 'Jurong Academy (ja.edu.sg) · Automatic website copy by MonCha',
      topics: [SITE_REPO_TOPIC, 'auto-copy'],
    });
    expect(siteRepoSpec(snapshot({ origin: 'manual' }), 'https://x.dev').topics).toEqual([SITE_REPO_TOPIC, 'manual-copy']);
  });

  it('pushes the whole website with a README and wrangler.jsonc, and records the repo', async () => {
    const { deps, patches, calls } = setup(ok);
    const outcome = await pushSiteSnapshotToGithub(deps, snapshot());
    expect(outcome).toMatchObject({ status: 'pushed', repo: 'Thinaakar/ja-edu-sg' });
    const call = calls[0]!;
    expect(call.repo.name).toBe('ja-edu-sg');
    expect(call.repo.homepage).toBe('https://ja-edu-sg.vinothjv4-tech.workers.dev');
    expect(call.files.map((f) => f.path)).toEqual([
      'moncha/brand.json',
      'moncha/manifest.json',
      'moncha/source.html',
      'public/assets/ja.edu.sg/wp-content/logo.png',
      'public/assets/ja.edu.sg/wp-content/theme.css',
      'public/assets/ja.edu.sg/wp-includes/jquery.min.js',
      'public/index.html',
      'README.md',
      'wrangler.jsonc',
    ].sort((a, b) => a.localeCompare(b)));
    const readme = dec.decode(call.files.find((f) => f.path === 'README.md')!.bytes);
    expect(readme).toContain('# Jurong Academy');
    expect(readme).toContain('[ja-edu-sg.vinothjv4-tech.workers.dev](https://ja-edu-sg.vinothjv4-tech.workers.dev)');
    expect(readme).toContain('Automatic (copied by the copy automation');
    const wrangler = JSON.parse(dec.decode(call.files.find((f) => f.path === 'wrangler.jsonc')!.bytes));
    expect(wrangler).toMatchObject({ name: 'ja-edu-sg', assets: { directory: './public' } });
    expect(call.message).toContain('Copy type: Automatic');
    expect(patches[0]).toMatchObject({
      githubStatus: 'pushed',
      githubRepo: 'Thinaakar/ja-edu-sg',
      githubFolderUrl: 'https://github.com/Thinaakar/ja-edu-sg',
      githubCommitUrl: 'https://github.com/Thinaakar/ja-edu-sg/commit/abc123',
      githubError: null,
      githubPushedAt: NOW,
    });
    expect(patches[0]).not.toHaveProperty('status');
  });

  it('prefers the deployed Worker URL for the repo homepage', async () => {
    const { deps, calls } = setup(ok);
    await pushSiteSnapshotToGithub(deps, snapshot({ workerUrl: 'https://ja-edu-sg.other.workers.dev' }));
    expect(calls[0]!.repo.homepage).toBe('https://ja-edu-sg.other.workers.dev');
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

  it('gives up at once on an error that a retry cannot fix', async () => {
    const { deps, patches } = setup(async () => {
      throw new SiteGithubError('github_repo_taken', 'exists', false);
    });
    const outcome = await pushSiteSnapshotToGithub(deps, snapshot());
    expect(outcome.status).toBe('failed');
    expect(patches[0]).toMatchObject({ githubStatus: 'failed', githubNextAt: null });
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
