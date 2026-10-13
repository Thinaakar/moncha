import { createHash } from 'node:crypto';
import {
  SITE_REPO_TOPIC,
  SITE_WORKER_COMPATIBILITY_DATE,
  SiteDeployError,
  type SiteWorkerCheck,
  type SiteWorkerDeployResult,
  type SiteWorkerDeployer,
  type SiteWorkerFile,
} from '@moncha/domain';

type Env = Record<string, string | undefined>;

export type CloudflareWorkersConfig = {
  apiToken: string;
  accountId: string;
  /** `{subdomain}.workers.dev`; read from the account when not set. */
  subdomain?: string | null;
  /** Most Workers the account may have; new site Workers stop there. Defaults to Workers Free's 100. */
  maxWorkers?: number;
};

/** Workers Free allows 100 Workers per account; Workers Paid allows 500. */
export const CLOUDFLARE_FREE_WORKER_LIMIT = 100;

const API = 'https://api.cloudflare.com/client/v4';
const REQUEST_TIMEOUT_MS = 30_000;
const UPLOAD_TIMEOUT_MS = 120_000;
/** Tag on every site Worker; a Worker without it is never overwritten. */
const SITE_TAG = SITE_REPO_TOPIC;
const MAIN_MODULE = 'worker.js';
/** Assets are served before the script runs; the script only answers paths that are not files. */
const WORKER_SCRIPT = 'export default { fetch(request, env) { return env.ASSETS.fetch(request); } };\n';
const NAME = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

type Envelope<T> = { success?: boolean; errors?: Array<{ code?: number; message?: string }>; result?: T };

/** Cloudflare's manifest hash: 32 hex chars of SHA-256 over the base64 body plus the extension. */
export function assetHash(base64: string, path: string): string {
  const name = path.split('/').pop() ?? '';
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  return createHash('sha256').update(base64 + ext).digest('hex').slice(0, 32);
}

/**
 * Deploys each website as its own static-assets Worker through the Workers API (no wrangler): upload session,
 * asset buckets, script upload with the completion token, then the workers.dev route.
 */
export class CloudflareSiteWorkerDeployer implements SiteWorkerDeployer {
  private readonly apiToken: string;
  private readonly accountId: string;
  private subdomainValue: string | null;
  private readonly maxWorkers: number;

  constructor(config: CloudflareWorkersConfig) {
    this.apiToken = config.apiToken;
    this.accountId = config.accountId;
    this.subdomainValue = config.subdomain?.trim() || null;
    this.maxWorkers = config.maxWorkers && config.maxWorkers > 0 ? config.maxWorkers : CLOUDFLARE_FREE_WORKER_LIMIT;
  }

  private async call<T>(
    method: string,
    path: string,
    init: { json?: unknown; form?: FormData; bearer?: string; timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<{ status: number; result: T }> {
    const timeout = AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${init.bearer ?? this.apiToken}`,
          ...(init.json !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: init.form ?? (init.json !== undefined ? JSON.stringify(init.json) : undefined),
        signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      });
    } catch (error) {
      if (init.signal?.aborted) throw new SiteDeployError('worker_shutdown', 'worker is stopping');
      const message = error instanceof Error ? error.message : String(error);
      throw new SiteDeployError('cloudflare_unreachable', message.slice(0, 160));
    }
    const text = await response.text();
    let data: Envelope<T> | null = null;
    try {
      data = text ? (JSON.parse(text) as Envelope<T>) : null;
    } catch {
      data = null;
    }
    if (response.ok && data?.success !== false) return { status: response.status, result: data?.result as T };
    const first = data?.errors?.[0];
    const message = `${first?.message ?? response.statusText}${first?.code ? ` (code ${first.code})` : ''}`.slice(0, 200);
    throw this.errorFor(response.status, message);
  }

  private errorFor(status: number, message: string): SiteDeployError {
    if (status === 401 || status === 403) {
      return new SiteDeployError(
        'cloudflare_bad_token',
        `Cloudflare rejected CLOUDFLARE_API_TOKEN (needs Workers Scripts: Edit on this account): ${message}`,
      );
    }
    if (status === 404) return new SiteDeployError('cloudflare_not_found', message);
    if (/code 10037\)|(exceeded|reached).*(limit|maximum).*(script|worker)/i.test(message)) {
      return new SiteDeployError('worker_limit_reached', `Cloudflare refused a new Worker: the account is at its Worker limit (${message})`);
    }
    if (status === 429) return new SiteDeployError('cloudflare_rate_limited', 'Cloudflare rate limit reached');
    if (status >= 500) return new SiteDeployError('cloudflare_unavailable', `Cloudflare error ${status}: ${message}`);
    return new SiteDeployError(`cloudflare_http_${status}`, message);
  }

  private scriptPath(name: string): string {
    return `/accounts/${this.accountId}/workers/scripts/${name}`;
  }

  private async subdomain(signal?: AbortSignal): Promise<string | null> {
    if (this.subdomainValue) return this.subdomainValue;
    const { result } = await this.call<{ subdomain?: string }>('GET', `/accounts/${this.accountId}/workers/subdomain`, { signal });
    this.subdomainValue = result?.subdomain?.trim() || null;
    return this.subdomainValue;
  }

  async urlFor(name: string): Promise<string | null> {
    const subdomain = await this.subdomain();
    return subdomain ? `https://${name}.${subdomain}.workers.dev` : null;
  }

  /** A Worker with this name that MonCha did not create (no site tag) is never replaced. True when it exists. */
  private async assertOwned(name: string, signal?: AbortSignal): Promise<boolean> {
    try {
      const { result } = await this.call<{ tags?: string[] | null }>('GET', `${this.scriptPath(name)}/script-settings`, { signal });
      if (!result?.tags?.includes(SITE_TAG)) {
        throw new SiteDeployError('worker_name_taken', `A Worker named ${name} already exists and was not made by MonCha; it was left untouched`, false);
      }
      return true;
    } catch (error) {
      if (error instanceof SiteDeployError && error.code === 'cloudflare_not_found') return false;
      throw error;
    }
  }

  private async listScripts(signal?: AbortSignal): Promise<Array<{ id: string; tags?: string[] | null }>> {
    const { result } = await this.call<Array<{ id: string; tags?: string[] | null }>>(
      'GET',
      `/accounts/${this.accountId}/workers/scripts`,
      { signal },
    );
    return result ?? [];
  }

  async preflight(input: { name: string; signal?: AbortSignal }): Promise<void> {
    const { name, signal } = input;
    if (!NAME.test(name)) throw new SiteDeployError('worker_bad_name', `"${name}" is not a valid Worker name`, false);
    if (await this.assertOwned(name, signal)) return;
    const total = (await this.listScripts(signal)).length;
    if (total >= this.maxWorkers) {
      throw new SiteDeployError(
        'worker_limit_reached',
        `The Cloudflare account already has ${total} of ${this.maxWorkers} Workers, so ${name} cannot get its own Worker. ` +
          'Upgrade to Workers Paid (500 Workers) and set CLOUDFLARE_WORKERS_LIMIT=500 on the worker',
      );
    }
  }

  private async uploadAssets(name: string, files: SiteWorkerFile[], signal?: AbortSignal): Promise<string> {
    const manifest: Record<string, { hash: string; size: number }> = {};
    const byHash = new Map<string, { base64: string; contentType: string }>();
    for (const file of files) {
      const base64 = Buffer.from(file.bytes).toString('base64');
      const hash = assetHash(base64, file.path);
      manifest[file.path] = { hash, size: file.bytes.byteLength };
      byHash.set(hash, { base64, contentType: file.contentType });
    }
    const { result: session } = await this.call<{ jwt: string; buckets?: string[][] }>(
      'POST',
      `${this.scriptPath(name)}/assets-upload-session`,
      { json: { manifest }, signal },
    );
    let completion = session.jwt;
    for (const bucket of session.buckets ?? []) {
      const form = new FormData();
      for (const hash of bucket) {
        const file = byHash.get(hash);
        if (!file) throw new SiteDeployError('cloudflare_bad_bucket', `Cloudflare asked for an unknown file ${hash}`);
        form.append(hash, new Blob([file.base64], { type: file.contentType }), hash);
      }
      const { result } = await this.call<{ jwt?: string } | null>('POST', `/accounts/${this.accountId}/workers/assets/upload?base64=true`, {
        form,
        bearer: session.jwt,
        timeoutMs: UPLOAD_TIMEOUT_MS,
        signal,
      });
      if (result?.jwt) completion = result.jwt;
    }
    return completion;
  }

  async deploy(input: { name: string; files: SiteWorkerFile[]; signal?: AbortSignal }): Promise<SiteWorkerDeployResult> {
    const { name, signal } = input;
    if (!NAME.test(name)) throw new SiteDeployError('worker_bad_name', `"${name}" is not a valid Worker name`, false);
    if (!input.files.length) throw new SiteDeployError('nothing_to_deploy', 'No files found for this copy', false);

    await this.preflight({ name, signal });
    const completion = await this.uploadAssets(name, input.files, signal);

    const metadata = {
      main_module: MAIN_MODULE,
      compatibility_date: SITE_WORKER_COMPATIBILITY_DATE,
      assets: { jwt: completion, config: { html_handling: 'auto-trailing-slash', not_found_handling: 'none' } },
      bindings: [{ type: 'assets', name: 'ASSETS' }],
      tags: [SITE_TAG],
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append(MAIN_MODULE, new Blob([WORKER_SCRIPT], { type: 'application/javascript+module' }), MAIN_MODULE);
    await this.call('PUT', this.scriptPath(name), { form, timeoutMs: UPLOAD_TIMEOUT_MS, signal });
    await this.call('POST', `${this.scriptPath(name)}/subdomain`, { json: { enabled: true, previews_enabled: false }, signal });

    const url = await this.urlFor(name);
    if (!url) {
      throw new SiteDeployError('cloudflare_no_subdomain', 'The Cloudflare account has no workers.dev subdomain; set one in Workers & Pages', false);
    }
    return { name, url };
  }

  async check(): Promise<SiteWorkerCheck> {
    const result: SiteWorkerCheck = {
      subdomain: null,
      canRead: false,
      siteWorkers: null,
      totalWorkers: null,
      workerLimit: this.maxWorkers,
      error: null,
    };
    try {
      result.subdomain = await this.subdomain();
      const scripts = await this.listScripts();
      result.canRead = true;
      result.totalWorkers = scripts.length;
      result.siteWorkers = scripts.filter((s) => s.tags?.includes(SITE_TAG)).length;
    } catch (error) {
      result.error = error instanceof SiteDeployError ? `${error.code}: ${error.message}` : String(error);
    }
    return result;
  }
}

/**
 * CLOUDFLARE_API_TOKEN plus CLOUDFLARE_ACCOUNT_ID (falls back to R2_ACCOUNT_ID, the same account).
 * CLOUDFLARE_WORKERS_LIMIT is the plan's Worker limit (default 100 for Workers Free; 500 on Workers Paid).
 */
export function cloudflareWorkersConfigFromEnv(env: Env = process.env): CloudflareWorkersConfig | null {
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();
  const accountId = (env.CLOUDFLARE_ACCOUNT_ID?.trim() || env.R2_ACCOUNT_ID?.trim()) ?? '';
  if (!apiToken || !/^[a-f0-9]{32}$/i.test(accountId)) return null;
  const limit = Number(env.CLOUDFLARE_WORKERS_LIMIT?.trim());
  return {
    apiToken,
    accountId,
    subdomain: env.CLOUDFLARE_WORKERS_SUBDOMAIN?.trim() || null,
    maxWorkers: Number.isInteger(limit) && limit > 0 ? limit : CLOUDFLARE_FREE_WORKER_LIMIT,
  };
}

/** Returns null without a token and account (copies are then not deployed). */
export function createCloudflareSiteWorkerDeployerFromEnv(env: Env = process.env): CloudflareSiteWorkerDeployer | null {
  const config = cloudflareWorkersConfigFromEnv(env);
  return config ? new CloudflareSiteWorkerDeployer(config) : null;
}
