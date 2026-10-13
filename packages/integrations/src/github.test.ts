import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteGithubError, type SiteGithubRepoSpec } from '@moncha/domain';
import { GitHubSiteRepoPublisher, githubSitesConfigFromEnv, rateLimitRetryAt } from './github';

type Call = { method: string; url: string; body: Record<string, unknown> | null; auth: string | null };
type Reply = { status: number; body: unknown; headers?: Record<string, string> };

function mockGitHub(handler: (call: Call) => Reply) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null,
      auth: new Headers(init.headers).get('authorization'),
    };
    calls.push(call);
    const out = handler(call);
    return new Response(JSON.stringify(out.body), { status: out.status, headers: out.headers });
  });
  return calls;
}

const enc = new TextEncoder();
const SPEC: SiteGithubRepoSpec = {
  name: 'ja-edu-sg',
  description: 'Jurong Academy (ja.edu.sg) · Automatic website copy by MonCha',
  homepage: 'https://ja-edu-sg.vinothjv4-tech.workers.dev',
  topics: ['moncha-site', 'auto-copy'],
};
const REPO = {
  full_name: 'Thinaakar/ja-edu-sg',
  html_url: 'https://github.com/Thinaakar/ja-edu-sg',
  description: SPEC.description,
  homepage: SPEC.homepage,
  topics: SPEC.topics,
};

let root: string;
let bare: string;

function git(...args: string[]): string {
  return execFileSync('git', ['--git-dir', bare, ...args], { encoding: 'utf8' }).trim();
}

function publisher() {
  return new GitHubSiteRepoPublisher({ token: 'test-token', owner: 'Thinaakar', branch: 'main', remoteUrl: () => bare });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'moncha-gh-test-'));
  bare = join(root, 'remote.git');
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  rmSync(root, { recursive: true, force: true });
});

describe('GitHubSiteRepoPublisher', { timeout: 30_000 }, () => {
  it('creates a private repo with topics, then pushes every file as one commit', async () => {
    const calls = mockGitHub(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/repos/Thinaakar/ja-edu-sg')) return { status: 404, body: { message: 'Not Found' } };
      if (method === 'GET' && url.endsWith('/user')) return { status: 200, body: { login: 'Thinaakar' } };
      if (method === 'POST' && url.endsWith('/user/repos')) return { status: 201, body: { ...REPO, topics: [] } };
      if (method === 'PUT' && url.endsWith('/topics')) return { status: 200, body: {} };
      return { status: 500, body: {} };
    });
    const crlf = enc.encode('<html>\r\n<body></body>\r\n</html>');
    const result = await publisher().publish({
      repo: SPEC,
      files: [
        { path: 'public/index.html', bytes: crlf },
        { path: 'public/assets/logo.png', bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]) },
        { path: 'README.md', bytes: enc.encode('# Jurong Academy\n') },
      ],
      message: 'Website copy of ja.edu.sg',
    });

    expect(result).toMatchObject({ repo: 'Thinaakar/ja-edu-sg', repoUrl: 'https://github.com/Thinaakar/ja-edu-sg', created: true });
    expect(result.commitUrl).toBe(`https://github.com/Thinaakar/ja-edu-sg/commit/${result.commitSha}`);
    expect(git('rev-parse', 'main')).toBe(result.commitSha);
    expect(git('ls-tree', '-r', '--name-only', 'main').split('\n').sort()).toEqual(['README.md', 'public/assets/logo.png', 'public/index.html']);
    expect(execFileSync('git', ['--git-dir', bare, 'show', 'main:public/index.html']).equals(Buffer.from(crlf))).toBe(true);
    expect(git('log', '-1', '--format=%an <%ae>|%s', 'main')).toBe('MonCha <sites@moncha.app>|Website copy of ja.edu.sg');

    const create = calls.find((c) => c.method === 'POST')!;
    expect(create.body).toMatchObject({ name: 'ja-edu-sg', private: true, description: SPEC.description, homepage: SPEC.homepage });
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ names: ['moncha-site', 'auto-copy'] });
    expect(calls.every((c) => c.auth === 'Bearer test-token')).toBe(true);
  });

  it('commits a newer copy on top, removes files that are gone and skips an identical push', async () => {
    mockGitHub(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/repos/Thinaakar/ja-edu-sg')) return { status: 200, body: REPO };
      return { status: 500, body: {} };
    });
    const first = await publisher().publish({
      repo: SPEC,
      files: [
        { path: 'public/index.html', bytes: enc.encode('v1') },
        { path: 'public/old.css', bytes: enc.encode('a{}') },
      ],
      message: 'first',
    });
    const files = [{ path: 'public/index.html', bytes: enc.encode('v2') }];
    const second = await publisher().publish({ repo: SPEC, files, message: 'second' });
    const third = await publisher().publish({ repo: SPEC, files, message: 'third' });

    expect(first.created).toBe(false);
    expect(second.commitSha).not.toBe(first.commitSha);
    expect(git('rev-parse', `${second.commitSha}^`)).toBe(first.commitSha);
    expect(git('ls-tree', '-r', '--name-only', 'main')).toBe('public/index.html');
    expect(third.commitSha).toBe(second.commitSha);
    expect(git('rev-list', '--count', 'main')).toBe('2');
  });

  it('updates the description, homepage and topics of an existing site repo', async () => {
    const calls = mockGitHub(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/repos/Thinaakar/ja-edu-sg')) {
        return { status: 200, body: { ...REPO, homepage: null, topics: ['moncha-site', 'manual-copy'] } };
      }
      return { status: 200, body: {} };
    });
    await publisher().publish({ repo: SPEC, files: [{ path: 'public/index.html', bytes: enc.encode('x') }], message: 'm' });
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ description: SPEC.description, homepage: SPEC.homepage });
    expect(calls.find((c) => c.method === 'PUT')!.body).toEqual({ names: ['moncha-site', 'auto-copy'] });
  });

  it('never touches a repo that is not a MonCha site repo', async () => {
    mockGitHub(({ method }) => (method === 'GET' ? { status: 200, body: { ...REPO, topics: ['personal'] } } : { status: 500, body: {} }));
    const error = await publisher()
      .publish({ repo: SPEC, files: [{ path: 'public/index.html', bytes: enc.encode('x') }], message: 'm' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SiteGithubError);
    expect(error).toMatchObject({ code: 'github_repo_taken', retryable: false });
    expect(() => git('rev-parse', 'main')).toThrow();
  });

  it('explains a token that cannot create repositories', async () => {
    mockGitHub(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/user')) return { status: 200, body: { login: 'Thinaakar' } };
      if (method === 'GET') return { status: 404, body: { message: 'Not Found' } };
      return { status: 403, body: { message: 'Resource not accessible by personal access token' } };
    });
    const error = await publisher()
      .publish({ repo: SPEC, files: [{ path: 'public/index.html', bytes: enc.encode('x') }], message: 'm' })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'github_cannot_create_repo' });
    expect((error as Error).message).toContain('Administration');
  });

  it('creates repos for an organization owner under /orgs', async () => {
    const calls = mockGitHub(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/repos/acme/ja-edu-sg')) return { status: 404, body: {} };
      if (method === 'GET' && url.endsWith('/user')) return { status: 200, body: { login: 'someone' } };
      if (method === 'GET' && url.endsWith('/orgs/acme')) return { status: 200, body: {} };
      if (method === 'POST') return { status: 201, body: { ...REPO, full_name: 'acme/ja-edu-sg', html_url: 'https://github.com/acme/ja-edu-sg' } };
      return { status: 200, body: {} };
    });
    const org = new GitHubSiteRepoPublisher({ token: 't', owner: 'acme', branch: 'main', remoteUrl: () => bare });
    const result = await org.publish({ repo: SPEC, files: [{ path: 'index.html', bytes: enc.encode('x') }], message: 'm' });
    expect(result.repo).toBe('acme/ja-edu-sg');
    expect(calls.find((c) => c.method === 'POST')!.url).toMatch(/\/orgs\/acme\/repos$/);
  });

  it('rejects unsafe paths and invalid repo names', async () => {
    mockGitHub(() => ({ status: 500, body: {} }));
    await expect(
      publisher().publish({ repo: SPEC, files: [{ path: '../escape', bytes: enc.encode('x') }], message: 'm' }),
    ).rejects.toMatchObject({ code: 'nothing_to_push' });
    await expect(
      publisher().publish({ repo: { ...SPEC, name: 'bad name' }, files: [{ path: 'a', bytes: enc.encode('x') }], message: 'm' }),
    ).rejects.toMatchObject({ code: 'github_bad_repo_name' });
  });

  it('reports the token login and owner type in check()', async () => {
    mockGitHub(({ url }) => (url.endsWith('/user') ? { status: 200, body: { login: 'Thinaakar' } } : { status: 500, body: {} }));
    expect(await publisher().check()).toEqual({
      owner: 'Thinaakar',
      branch: 'main',
      login: 'Thinaakar',
      ownerType: 'user',
      canRead: true,
      error: null,
    });
  });
});

describe('rateLimitRetryAt', () => {
  const now = Date.UTC(2026, 9, 13, 12, 0, 0);
  it('reads retry-after (secondary limits) and x-ratelimit-reset (primary limit)', () => {
    expect(rateLimitRetryAt(new Headers({ 'retry-after': '60' }), now)).toEqual(new Date(now + 60_000));
    const reset = String(now / 1000 + 900);
    expect(rateLimitRetryAt(new Headers({ 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': reset }), now)).toEqual(
      new Date(now + 900_000),
    );
    expect(rateLimitRetryAt(new Headers({ 'x-ratelimit-remaining': '12', 'x-ratelimit-reset': reset }), now)).toBeUndefined();
    expect(rateLimitRetryAt(new Headers(), now)).toBeUndefined();
  });
});

describe('githubSitesConfigFromEnv', () => {
  it('uses GITHUB_SITES_OWNER, else the owner of GITHUB_SITES_REPO', () => {
    expect(githubSitesConfigFromEnv({ GITHUB_TOKEN: 't', GITHUB_SITES_OWNER: 'acme' })).toEqual({ token: 't', owner: 'acme', branch: 'main' });
    expect(githubSitesConfigFromEnv({ GITHUB_TOKEN: 't', GITHUB_SITES_REPO: 'https://github.com/Thinaakar/moncha-sites.git' })).toEqual({
      token: 't',
      owner: 'Thinaakar',
      branch: 'main',
    });
    expect(githubSitesConfigFromEnv({ GITHUB_SITES_OWNER: 'acme' })).toBeNull();
    expect(githubSitesConfigFromEnv({ GITHUB_TOKEN: 't' })).toBeNull();
  });
});
