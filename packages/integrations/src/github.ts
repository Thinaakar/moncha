import { SiteGithubError, type SiteGithubFile, type SiteGithubPublishResult, type SiteGithubPublisher } from '@moncha/domain';

type Env = Record<string, string | undefined>;

export type GitHubSitesConfig = {
  token: string;
  /** `owner/name` */
  repo: string;
  branch: string;
};

const API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;
const BLOB_CONCURRENCY = 4;
/** Times the commit is rebuilt when another push moved the branch in between. */
const REF_RACE_RETRIES = 3;

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function safeFilePath(path: string): boolean {
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..');
}

/** Pushes website copies to a GitHub repo with the Git Data API: one commit per copy. */
export class GitHubSitePublisher implements SiteGithubPublisher {
  readonly repo: string;
  readonly branch: string;
  private readonly token: string;

  constructor(config: GitHubSitesConfig) {
    this.repo = config.repo;
    this.branch = config.branch;
    this.token = config.token;
  }

  private async call<T>(method: string, path: string, body: unknown, signal: AbortSignal | undefined): Promise<{ status: number; data: T }> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${API}/repos/${this.repo}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'moncha-worker',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (error) {
      if (signal?.aborted) throw new SiteGithubError('worker_shutdown', 'worker is stopping');
      const message = error instanceof Error ? error.message : String(error);
      throw new SiteGithubError('github_unreachable', message.slice(0, 160));
    }
    const text = await response.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    if (response.ok) return { status: response.status, data: data as T };
    const message = String((data as { message?: unknown } | null)?.message ?? response.statusText).slice(0, 160);
    throw this.errorFor(response, path, message);
  }

  private errorFor(response: Response, path: string, message: string): SiteGithubError {
    const { status } = response;
    if (status === 401) return new SiteGithubError('github_bad_token', 'GitHub rejected GITHUB_TOKEN (expired or revoked)');
    if (status === 403 || status === 429) {
      if (status === 429 || response.headers.get('x-ratelimit-remaining') === '0') {
        return new SiteGithubError('github_rate_limited', 'GitHub rate limit reached');
      }
      return new SiteGithubError('github_forbidden', `Token cannot write to ${this.repo} (needs Contents: Read and write): ${message}`);
    }
    if (status === 404) {
      return new SiteGithubError('github_not_found', `${this.repo} or branch ${this.branch} not found, or the token cannot see it`);
    }
    if (status === 409 && path.startsWith('/git/ref/')) {
      return new SiteGithubError('github_branch_missing', `${this.repo} is empty; add a README so ${this.branch} exists`);
    }
    if (status === 422) return new SiteGithubError('github_rejected', message);
    if (status >= 500) return new SiteGithubError('github_unavailable', `GitHub error ${status}`);
    return new SiteGithubError(`github_http_${status}`, message);
  }

  private async createBlobs(files: SiteGithubFile[], signal: AbortSignal | undefined): Promise<Map<string, string>> {
    const shas = new Map<string, string>();
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const file = files[next++]!;
        const { data } = await this.call<{ sha: string }>(
          'POST',
          '/git/blobs',
          { content: Buffer.from(file.bytes).toString('base64'), encoding: 'base64' },
          signal,
        );
        shas.set(file.path, data.sha);
      }
    };
    await Promise.all(Array.from({ length: Math.min(BLOB_CONCURRENCY, files.length) }, worker));
    return shas;
  }

  /** Read-only setup check: the token can see the repo, may push, and the branch exists. */
  async check(): Promise<{ repo: string; branch: string; private: boolean | null; canPush: boolean | null; branchHead: string | null; error: string | null }> {
    const base = { repo: this.repo, branch: this.branch };
    try {
      const { data } = await this.call<{ private?: boolean; permissions?: { push?: boolean } }>('GET', '', undefined, undefined);
      const { data: ref } = await this.call<{ object: { sha: string } }>('GET', `/git/ref/heads/${encodePath(this.branch)}`, undefined, undefined);
      return { ...base, private: data.private ?? null, canPush: data.permissions?.push ?? null, branchHead: ref.object.sha, error: null };
    } catch (error) {
      const message = error instanceof SiteGithubError ? `${error.code}: ${error.message}` : String(error);
      return { ...base, private: null, canPush: null, branchHead: null, error: message };
    }
  }

  async publish(input: { folder: string; files: SiteGithubFile[]; message: string; signal?: AbortSignal }): Promise<SiteGithubPublishResult> {
    const { signal } = input;
    const folder = input.folder.replace(/^\/+|\/+$/g, '');
    const files = input.files.filter((f) => safeFilePath(f.path));
    if (!files.length) throw new SiteGithubError('nothing_to_push', 'No code files found for this copy', false);

    const refPath = `/git/ref/heads/${encodePath(this.branch)}`;
    const blobs = await this.createBlobs(files, signal);
    const tree = files.map((f) => ({ path: `${folder}/${f.path}`, mode: '100644', type: 'blob', sha: blobs.get(f.path)! }));

    for (let attempt = 1; ; attempt++) {
      const { data: ref } = await this.call<{ object: { sha: string } }>('GET', refPath, undefined, signal);
      const headSha = ref.object.sha;
      const { data: head } = await this.call<{ tree: { sha: string } }>('GET', `/git/commits/${headSha}`, undefined, signal);
      const { data: newTree } = await this.call<{ sha: string }>('POST', '/git/trees', { base_tree: head.tree.sha, tree }, signal);

      let commitSha = headSha;
      if (newTree.sha !== head.tree.sha) {
        const { data: commit } = await this.call<{ sha: string }>(
          'POST',
          '/git/commits',
          { message: input.message, tree: newTree.sha, parents: [headSha] },
          signal,
        );
        try {
          await this.call('PATCH', `/git/refs/heads/${encodePath(this.branch)}`, { sha: commit.sha, force: false }, signal);
        } catch (error) {
          // 422 "Update is not a fast forward": someone pushed meanwhile; rebuild on the new head.
          if (error instanceof SiteGithubError && error.code === 'github_rejected' && attempt < REF_RACE_RETRIES) continue;
          throw error;
        }
        commitSha = commit.sha;
      }
      return {
        commitSha,
        commitUrl: `https://github.com/${this.repo}/commit/${commitSha}`,
        folderUrl: `https://github.com/${this.repo}/tree/${encodePath(this.branch)}/${encodePath(folder)}`,
      };
    }
  }
}

export function githubSitesConfigFromEnv(env: Env = process.env): GitHubSitesConfig | null {
  const token = env.GITHUB_TOKEN?.trim();
  const repo = env.GITHUB_SITES_REPO?.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const branch = env.GITHUB_SITES_BRANCH?.trim() || 'main';
  if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
  return { token, repo, branch };
}

/** Returns null when GITHUB_TOKEN or GITHUB_SITES_REPO is missing (copies are then not pushed). */
export function createGitHubSitePublisherFromEnv(env: Env = process.env): GitHubSitePublisher | null {
  const config = githubSitesConfigFromEnv(env);
  return config ? new GitHubSitePublisher(config) : null;
}
