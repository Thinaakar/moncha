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
    const calls = mockGitHub(({ method, url }) => {
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
    expect(calls.some((c) => c.url.endsWith('/git/blobs'))).toBe(false);
    const tree = calls.find((c) => c.url.endsWith('/git/trees'))!.body!;
    expect(tree.base_tree).toBe('tree0');
    expect((tree.tree as Array<{ path: string; content: string }>).sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'sites/ja.edu.sg/snap1/assets/ja.edu.sg/app.css', mode: '100644', type: 'blob', content: 'body{}' },
      { path: 'sites/ja.edu.sg/snap1/index.html', mode: '100644', type: 'blob', content: '<html>' },
    ]);
    expect(calls.find((c) => c.url.endsWith('/git/commits'))!.body).toMatchObject({ tree: 'tree1', parents: ['head1'] });
    expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({ sha: 'commit1', force: false });
  });

  it('uploads non-UTF-8 files as blobs and keeps a BOM in inline text', async () => {
    const calls = mockGitHub(({ method, url }) => {
      if (url.endsWith('/git/blobs')) return { status: 201, body: { sha: 'blob1' } };
      if (method === 'GET' && url.endsWith('/git/ref/heads/main')) return { status: 200, body: { object: { sha: 'head1' } } };
      if (url.endsWith('/git/commits/head1')) return { status: 200, body: { tree: { sha: 'tree0' } } };
      if (url.endsWith('/git/trees')) return { status: 201, body: { sha: 'tree1' } };
      if (url.endsWith('/git/commits')) return { status: 201, body: { sha: 'commit1' } };
      return { status: 200, body: {} };
    });
    const shiftJis = new Uint8Array([0x93, 0xfa, 0x96, 0x7b]);
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61]);

    await publisher().publish({
      folder: 'sites/a.jp/s1',
      files: [
        { path: 'source.html', bytes: shiftJis },
        { path: 'brand.json', bytes: bom },
      ],
      message: 'm',
    });

    const blobCalls = calls.filter((c) => c.url.endsWith('/git/blobs'));
    expect(blobCalls).toHaveLength(1);
    expect(Buffer.from(String(blobCalls[0]!.body!.content), 'base64')).toEqual(Buffer.from(shiftJis));
    const entries = calls.find((c) => c.url.endsWith('/git/trees'))!.body!.tree as Array<Record<string, string>>;
    expect(entries.find((e) => e.path.endsWith('source.html'))).toMatchObject({ sha: 'blob1' });
    expect(Buffer.from(entries.find((e) => e.path.endsWith('brand.json'))!.content!, 'utf8')).toEqual(Buffer.from(bom));
  });

  it('splits large inline text over chained tree requests', async () => {
    let trees = 0;
    const calls = mockGitHub(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/git/ref/heads/main')) return { status: 200, body: { object: { sha: 'head1' } } };
      if (url.endsWith('/git/commits/head1')) return { status: 200, body: { tree: { sha: 'tree0' } } };
      if (url.endsWith('/git/trees')) return { status: 201, body: { sha: `tree${++trees}` } };
      if (url.endsWith('/git/commits')) return { status: 201, body: { sha: 'commit1' } };
      return { status: 200, body: {} };
    });
    const text = (n: number) => new TextEncoder().encode('x'.repeat(n));

    await new GitHubSitePublisher({ token: 't', repo: 'Thinaakar/moncha-sites', branch: 'main', inlineTreeMaxBytes: 10 }).publish({
      folder: 'sites/a.com/s1',
      files: [
        { path: 'a.css', bytes: text(6) },
        { path: 'b.css', bytes: text(6) },
        { path: 'c.css', bytes: text(3) },
      ],
      message: 'm',
    });

    const treeBodies = calls.filter((c) => c.url.endsWith('/git/trees')).map((c) => c.body!);
    expect(treeBodies.map((b) => b.base_tree)).toEqual(['tree0', 'tree1']);
    expect(treeBodies.map((b) => (b.tree as unknown[]).length)).toEqual([1, 2]);
    expect(calls.find((c) => c.url.endsWith('/git/commits'))!.body).toMatchObject({ tree: 'tree2' });
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

  it('checks read and write access without moving the branch', async () => {
    const calls = mockGitHub(({ method, url }) => {
      if (method === 'GET' && url.endsWith('/repos/Thinaakar/moncha-sites')) {
        return { status: 200, body: { private: true, permissions: { push: true } } };
      }
      if (method === 'GET' && url.endsWith('/git/ref/heads/main')) return { status: 200, body: { object: { sha: 'head1' } } };
      if (method === 'GET' && url.endsWith('/git/commits/head1')) return { status: 200, body: { tree: { sha: 'tree0' } } };
      if (method === 'POST' && url.endsWith('/git/blobs')) return { status: 201, body: { sha: 'b' } };
      return { status: 500, body: {} };
    });

    expect(await publisher().check()).toEqual({
      repo: 'Thinaakar/moncha-sites',
      branch: 'main',
      private: true,
      canPush: true,
      canRead: true,
      canWrite: true,
      branchHead: 'head1',
      error: null,
    });
    expect(calls.some((c) => c.method === 'PATCH' || c.url.endsWith('/git/commits') || c.url.endsWith('/git/trees'))).toBe(false);
  });

  it('reports a read-only token in the check without leaking it', async () => {
    mockGitHub(({ method, url }) => {
      if (method === 'POST') return { status: 403, body: { message: 'Resource not accessible by personal access token' } };
      if (url.endsWith('/git/ref/heads/main')) return { status: 200, body: { object: { sha: 'head1' } } };
      return { status: 200, body: { private: true, permissions: { push: false } } };
    });

    const check = await publisher().check();
    expect(check).toMatchObject({ canRead: true, canWrite: false, canPush: false });
    expect(check.error).toMatch(/^github_forbidden/);
    expect(JSON.stringify(check)).not.toContain('test-token');
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
