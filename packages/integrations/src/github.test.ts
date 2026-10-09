import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteGithubError } from '@moncha/domain';
import { GitHubSitePublisher, githubSitesConfigFromEnv } from './github';

type Call = { method: string; url: string; body: Record<string, unknown> | null; auth: string | null };

function mockGitHub(handler: (call: Call) => { status: number; body: unknown; headers?: Record<string, string> }) {
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

const files = [
  { path: 'index.html', bytes: new TextEncoder().encode('<html>') },
  { path: 'assets/ja.edu.sg/app.css', bytes: new TextEncoder().encode('body{}') },
];

function publisher() {
  return new GitHubSitePublisher({ token: 'test-token', repo: 'Thinaakar/moncha-sites', branch: 'main' });
}

afterEach(() => vi.unstubAllGlobals());

describe('GitHubSitePublisher', () => {
  it('makes one commit with every file under the folder and moves the branch', async () => {
    let blob = 0;
    const calls = mockGitHub(({ method, url }) => {
      if (url.endsWith('/git/blobs')) return { status: 201, body: { sha: `blob${++blob}` } };
      if (method === 'GET' && url.endsWith('/git/ref/heads/main')) return { status: 200, body: { object: { sha: 'head1' } } };
      if (url.endsWith('/git/commits/head1')) return { status: 200, body: { tree: { sha: 'tree0' } } };
      if (url.endsWith('/git/trees')) return { status: 201, body: { sha: 'tree1' } };
      if (url.endsWith('/git/commits')) return { status: 201, body: { sha: 'commit1' } };
      if (method === 'PATCH') return { status: 200, body: {} };
      return { status: 500, body: {} };
    });

    const result = await publisher().publish({ folder: 'sites/ja.edu.sg/snap1', files, message: 'Website copy' });

    expect(result).toEqual({
      commitSha: 'commit1',
      commitUrl: 'https://github.com/Thinaakar/moncha-sites/commit/commit1',
      folderUrl: 'https://github.com/Thinaakar/moncha-sites/tree/main/sites/ja.edu.sg/snap1',
    });
    expect(calls.every((c) => c.auth === 'Bearer test-token')).toBe(true);
    const tree = calls.find((c) => c.url.endsWith('/git/trees'))!.body!;
    expect(tree.base_tree).toBe('tree0');
    expect((tree.tree as Array<{ path: string }>).map((e) => e.path).sort()).toEqual([
      'sites/ja.edu.sg/snap1/assets/ja.edu.sg/app.css',
      'sites/ja.edu.sg/snap1/index.html',
    ]);
    expect(calls.find((c) => c.url.endsWith('/git/commits'))!.body).toMatchObject({ tree: 'tree1', parents: ['head1'] });
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ sha: 'commit1', force: false });
  });

  it('rebuilds the commit on the new head when another push won the race', async () => {
    let heads = 0;
    let patches = 0;
    mockGitHub(({ method, url }) => {
      if (url.endsWith('/git/blobs')) return { status: 201, body: { sha: 'b' } };
      if (method === 'GET' && url.includes('/git/ref/heads/')) return { status: 200, body: { object: { sha: `head${++heads}` } } };
      if (url.includes('/git/commits/head')) return { status: 200, body: { tree: { sha: 'tree0' } } };
      if (url.endsWith('/git/trees')) return { status: 201, body: { sha: 'tree1' } };
      if (url.endsWith('/git/commits')) return { status: 201, body: { sha: `commit${heads}` } };
      if (method === 'PATCH') {
        patches++;
        return patches === 1 ? { status: 422, body: { message: 'Update is not a fast forward' } } : { status: 200, body: {} };
      }
      return { status: 500, body: {} };
    });

    const result = await publisher().publish({ folder: 'sites/a.com/s1', files, message: 'm' });
    expect(result.commitSha).toBe('commit2');
    expect(patches).toBe(2);
  });

  it('reports a bad token without leaking it', async () => {
    mockGitHub(() => ({ status: 401, body: { message: 'Bad credentials' } }));
    const error = await publisher()
      .publish({ folder: 'sites/a.com/s1', files, message: 'm' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SiteGithubError);
    expect((error as SiteGithubError).code).toBe('github_bad_token');
    expect((error as Error).message).not.toContain('test-token');
  });

  it('explains an empty repo', async () => {
    mockGitHub(({ url }) =>
      url.endsWith('/git/blobs') ? { status: 201, body: { sha: 'b' } } : { status: 409, body: { message: 'Git Repository is empty.' } },
    );
    const error = (await publisher()
      .publish({ folder: 'sites/a.com/s1', files, message: 'm' })
      .catch((e: unknown) => e)) as SiteGithubError;
    expect(error.code).toBe('github_branch_missing');
  });

  it('reads its settings from env and skips when they are missing', () => {
    expect(githubSitesConfigFromEnv({})).toBeNull();
    expect(githubSitesConfigFromEnv({ GITHUB_TOKEN: 'x' })).toBeNull();
    expect(githubSitesConfigFromEnv({ GITHUB_TOKEN: 'x', GITHUB_SITES_REPO: 'not a repo' })).toBeNull();
    expect(githubSitesConfigFromEnv({ GITHUB_TOKEN: 'x', GITHUB_SITES_REPO: 'https://github.com/Thinaakar/moncha-sites.git' })).toEqual({
      token: 'x',
      repo: 'Thinaakar/moncha-sites',
      branch: 'main',
    });
  });
});
