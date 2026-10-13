import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  SITE_REPO_TOPIC,
  SiteGithubError,
  type SiteGithubCheck,
  type SiteGithubFile,
  type SiteGithubPublishResult,
  type SiteGithubPublisher,
  type SiteGithubRepoSpec,
} from '@moncha/domain';

type Env = Record<string, string | undefined>;

export type GitHubSitesConfig = {
  token: string;
  /** User or organization that owns the site repos. */
  owner: string;
  branch: string;
  /** Git remote of a repo; tests point it at a local bare repo. Defaults to https://github.com/{owner}/{name}.git. */
  remoteUrl?: (fullName: string) => string;
};

const API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 30_000;
const GIT_TIMEOUT_MS = 5 * 60_000;
const GIT_AUTHOR = { name: 'MonCha', email: 'sites@moncha.app' };

type RepoData = {
  full_name: string;
  html_url: string;
  description: string | null;
  homepage: string | null;
  topics?: string[];
  size?: number;
};

function safeFilePath(path: string): boolean {
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && part !== '.git');
}

function sameTopics(a: string[] | undefined, b: string[]): boolean {
  return [...(a ?? [])].sort().join(',') === [...b].sort().join(',');
}

/** `retry-after` (seconds, secondary limits) or `x-ratelimit-reset` (epoch seconds, primary limit). */
export function rateLimitRetryAt(headers: Headers, now = Date.now()): Date | undefined {
  const after = Number(headers.get('retry-after'));
  if (Number.isFinite(after) && after > 0) return new Date(now + after * 1000);
  const reset = Number(headers.get('x-ratelimit-reset'));
  if (headers.get('x-ratelimit-remaining') === '0' && Number.isFinite(reset) && reset * 1000 > now) return new Date(reset * 1000);
  return undefined;
}

/**
 * One website, one private repo: creates `{owner}/{name}` when it is missing, then pushes the copy as a single
 * commit with the git CLI (one push per copy, however many images it has). The commit's tree is exactly the
 * copy's files, so files from an older copy that are gone now are removed.
 */
export class GitHubSiteRepoPublisher implements SiteGithubPublisher {
  readonly owner: string;
  readonly branch: string;
  private readonly token: string;
  private readonly remoteUrl: (fullName: string) => string;
  private ownerKind: Promise<{ login: string; type: 'user' | 'org' }> | null = null;

  constructor(config: GitHubSitesConfig) {
    this.owner = config.owner;
    this.branch = config.branch;
    this.token = config.token;
    this.remoteUrl = config.remoteUrl ?? ((fullName) => `https://github.com/${fullName}.git`);
  }

  private async call<T>(method: string, path: string, body: unknown, signal: AbortSignal | undefined): Promise<T> {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
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
    if (response.ok) return data as T;
    const message = String((data as { message?: unknown } | null)?.message ?? response.statusText).slice(0, 160);
    throw this.errorFor(response, method, path, message);
  }

  private errorFor(response: Response, method: string, path: string, message: string): SiteGithubError {
    const { status } = response;
    if (status === 401) return new SiteGithubError('github_bad_token', 'GitHub rejected GITHUB_TOKEN (expired or revoked)');
    if (status === 403 || status === 429) {
      if (status === 429 || response.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(message)) {
        const retryAt = rateLimitRetryAt(response.headers);
        return new SiteGithubError(
          'github_rate_limited',
          `GitHub rate limit reached${retryAt ? ` until ${retryAt.toISOString()}` : ''}: ${message}`,
          true,
          retryAt,
        );
      }
      if (method === 'POST' && path.endsWith('/repos')) {
        return new SiteGithubError(
          'github_cannot_create_repo',
          `Token cannot create repositories for ${this.owner} (needs All repositories + Administration: Read and write): ${message}`,
        );
      }
      return new SiteGithubError('github_forbidden', `Token cannot change ${path.split('/').slice(2, 4).join('/')}: ${message}`);
    }
    if (status === 404) return new SiteGithubError('github_not_found', `${this.owner} not found, or the token cannot see it`);
    if (status === 422) return new SiteGithubError('github_rejected', message);
    if (status >= 500) return new SiteGithubError('github_unavailable', `GitHub error ${status}`);
    return new SiteGithubError(`github_http_${status}`, message);
  }

  /** Repos go to the token's own account (`/user/repos`) or to an organization (`/orgs/{owner}/repos`). */
  private resolveOwner(signal?: AbortSignal): Promise<{ login: string; type: 'user' | 'org' }> {
    this.ownerKind ??= (async () => {
      const user = await this.call<{ login: string }>('GET', '/user', undefined, signal);
      if (user.login.toLowerCase() === this.owner.toLowerCase()) return { login: user.login, type: 'user' as const };
      await this.call('GET', `/orgs/${encodeURIComponent(this.owner)}`, undefined, signal);
      return { login: user.login, type: 'org' as const };
    })();
    this.ownerKind.catch(() => {
      this.ownerKind = null;
    });
    return this.ownerKind;
  }

  private async findRepo(fullName: string, signal?: AbortSignal): Promise<RepoData | null> {
    try {
      return await this.call<RepoData>('GET', `/repos/${fullName}`, undefined, signal);
    } catch (error) {
      if (error instanceof SiteGithubError && error.code === 'github_not_found') return null;
      throw error;
    }
  }

  private async ensureRepo(spec: SiteGithubRepoSpec, signal?: AbortSignal): Promise<{ repo: RepoData; created: boolean }> {
    const fullName = `${this.owner}/${spec.name}`;
    const existing = await this.findRepo(fullName, signal);
    if (existing) {
      if (!existing.topics?.includes(SITE_REPO_TOPIC)) {
        throw new SiteGithubError(
          'github_repo_taken',
          `${existing.full_name} already exists and is not a MonCha site repo (no "${SITE_REPO_TOPIC}" topic); it was left untouched`,
          false,
        );
      }
      const homepage = spec.homepage ?? '';
      if ((existing.description ?? '') !== spec.description || (existing.homepage ?? '') !== homepage) {
        await this.call('PATCH', `/repos/${existing.full_name}`, { description: spec.description, homepage }, signal);
      }
      if (!sameTopics(existing.topics, spec.topics)) {
        await this.call('PUT', `/repos/${existing.full_name}/topics`, { names: spec.topics }, signal);
      }
      return { repo: existing, created: false };
    }

    const owner = await this.resolveOwner(signal);
    let repo: RepoData;
    try {
      repo = await this.call<RepoData>(
        'POST',
        owner.type === 'user' ? '/user/repos' : `/orgs/${encodeURIComponent(this.owner)}/repos`,
        {
          name: spec.name,
          description: spec.description,
          homepage: spec.homepage ?? undefined,
          private: true,
          has_issues: false,
          has_projects: false,
          has_wiki: false,
          auto_init: false,
        },
        signal,
      );
    } catch (error) {
      if (error instanceof SiteGithubError && error.code === 'github_rejected' && /already exists/i.test(error.message)) {
        throw new SiteGithubError(
          'github_repo_taken',
          `${fullName} already exists but the token cannot see it; give the token access to All repositories`,
        );
      }
      throw error;
    }
    await this.call('PUT', `/repos/${repo.full_name}/topics`, { names: spec.topics }, signal);
    return { repo, created: true };
  }

  /** git with the token in an HTTP header (never in the URL or argv) and no prompts, helpers or line-ending changes. */
  private git(cwd: string, args: string[], signal?: AbortSignal): Promise<{ code: number; stdout: string; stderr: string }> {
    const config: Array<[string, string]> = [
      ['core.autocrlf', 'false'],
      ['core.safecrlf', 'false'],
      ['credential.helper', ''],
      ['user.name', GIT_AUTHOR.name],
      ['user.email', GIT_AUTHOR.email],
      ['http.https://github.com/.extraheader', `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${this.token}`).toString('base64')}`],
    ];
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      GIT_TERMINAL_PROMPT: '0',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_COUNT: String(config.length),
    };
    config.forEach(([key, value], i) => {
      env[`GIT_CONFIG_KEY_${i}`] = key;
      env[`GIT_CONFIG_VALUE_${i}`] = value;
    });
    return new Promise((resolve, reject) => {
      const child = spawn('git', args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      const timer = setTimeout(() => child.kill('SIGKILL'), GIT_TIMEOUT_MS);
      const onAbort = () => child.kill('SIGKILL');
      signal?.addEventListener('abort', onAbort, { once: true });
      child.on('error', (error) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        reject(new SiteGithubError('git_unavailable', `git could not start: ${error.message}`.slice(0, 200)));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        if (signal?.aborted) return reject(new SiteGithubError('worker_shutdown', 'worker is stopping'));
        const scrubbed = this.token.length >= 8 ? stderr.split(this.token).join('***') : stderr;
        resolve({ code: code ?? -1, stdout: stdout.trim(), stderr: scrubbed.trim() });
      });
    });
  }

  private gitError(step: string, stderr: string): SiteGithubError {
    const line = stderr.split('\n').filter(Boolean).slice(-2).join(' ').slice(0, 200);
    if (/authentication failed|could not read username|invalid username or password/i.test(stderr)) {
      return new SiteGithubError('github_bad_token', 'GitHub rejected GITHUB_TOKEN for git');
    }
    if (/permission to .* denied|403|denied to/i.test(stderr)) {
      return new SiteGithubError('github_forbidden', `Token cannot push (needs Contents: Read and write on All repositories): ${line}`);
    }
    if (/repository not found/i.test(stderr)) return new SiteGithubError('github_not_found', `git ${step}: repository not found`);
    return new SiteGithubError('git_failed', `git ${step}: ${line || 'failed'}`);
  }

  private async mustGit(cwd: string, step: string, args: string[], signal?: AbortSignal): Promise<string> {
    const result = await this.git(cwd, args, signal);
    if (result.code !== 0) throw this.gitError(step, result.stderr);
    return result.stdout;
  }

  /** Commits `files` as the whole tree on top of the remote branch (if any) and pushes; returns the head sha. */
  private async pushTree(
    remote: string,
    files: SiteGithubFile[],
    message: string,
    signal?: AbortSignal,
  ): Promise<{ sha: string; changed: boolean }> {
    const root = await mkdtemp(join(tmpdir(), 'moncha-site-'));
    try {
      for (const file of files) {
        const target = join(root, ...file.path.split('/'));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, file.bytes);
      }
      const ref = `refs/heads/${this.branch}`;
      await this.mustGit(root, 'init', ['init', '-q', '-b', this.branch], signal);
      const fetched = await this.git(root, ['fetch', '-q', '--depth=1', '--no-tags', remote, ref], signal);
      const hasParent = fetched.code === 0;
      if (!hasParent && !/couldn't find remote ref|could not find remote ref|does not appear to be a git repository|empty/i.test(fetched.stderr)) {
        throw this.gitError('fetch', fetched.stderr);
      }
      if (hasParent) await this.mustGit(root, 'update-ref', ['update-ref', ref, 'FETCH_HEAD'], signal);
      await this.mustGit(root, 'add', ['add', '-A'], signal);
      if (hasParent) {
        const diff = await this.git(root, ['diff', '--cached', '--quiet', 'HEAD'], signal);
        if (diff.code === 0) return { sha: await this.mustGit(root, 'rev-parse', ['rev-parse', 'HEAD'], signal), changed: false };
      }
      await this.mustGit(root, 'commit', ['commit', '-q', '--no-verify', '-m', message], signal);
      await this.mustGit(root, 'push', ['push', '-q', remote, `HEAD:${ref}`], signal);
      return { sha: await this.mustGit(root, 'rev-parse', ['rev-parse', 'HEAD'], signal), changed: true };
    } finally {
      await rm(root, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async check(): Promise<SiteGithubCheck> {
    const result: SiteGithubCheck = { owner: this.owner, branch: this.branch, login: null, ownerType: null, canRead: false, error: null };
    try {
      const owner = await this.resolveOwner();
      result.login = owner.login;
      result.ownerType = owner.type;
      result.canRead = true;
    } catch (error) {
      result.error = error instanceof SiteGithubError ? `${error.code}: ${error.message}` : String(error);
    }
    return result;
  }

  async publish(input: {
    repo: SiteGithubRepoSpec;
    files: SiteGithubFile[];
    message: string;
    signal?: AbortSignal;
  }): Promise<SiteGithubPublishResult> {
    const { signal } = input;
    if (!/^[A-Za-z0-9._-]{1,100}$/.test(input.repo.name) || input.repo.name.startsWith('.')) {
      throw new SiteGithubError('github_bad_repo_name', `"${input.repo.name}" is not a valid repository name`, false);
    }
    const files = input.files.filter((f) => safeFilePath(f.path));
    if (!files.length) throw new SiteGithubError('nothing_to_push', 'No files found for this copy', false);

    const { repo, created } = await this.ensureRepo(input.repo, signal);
    const { sha } = await this.pushTree(this.remoteUrl(repo.full_name), files, input.message, signal);
    return {
      repo: repo.full_name,
      repoUrl: repo.html_url,
      commitSha: sha,
      commitUrl: `${repo.html_url}/commit/${sha}`,
      created,
    };
  }
}

/** GITHUB_SITES_OWNER, else the owner part of the older GITHUB_SITES_REPO setting (`owner/name`). */
export function githubSitesConfigFromEnv(env: Env = process.env): GitHubSitesConfig | null {
  const token = env.GITHUB_TOKEN?.trim();
  const legacyRepo = env.GITHUB_SITES_REPO?.trim().replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  const owner = env.GITHUB_SITES_OWNER?.trim().replace(/^https:\/\/github\.com\//, '').replace(/\/+$/, '') || legacyRepo?.split('/')[0];
  const branch = env.GITHUB_SITES_BRANCH?.trim() || 'main';
  if (!token || !owner || !/^[A-Za-z0-9-]{1,39}$/.test(owner)) return null;
  return { token, owner, branch };
}

/** Returns null when GITHUB_TOKEN or the owner is missing (copies are then not pushed). */
export function createGitHubSitePublisherFromEnv(env: Env = process.env): GitHubSiteRepoPublisher | null {
  const config = githubSitesConfigFromEnv(env);
  return config ? new GitHubSiteRepoPublisher(config) : null;
}
