import { afterEach, describe, expect, it, vi } from 'vitest';
import { SiteDeployError } from '@moncha/domain';
import { CloudflareSiteWorkerDeployer, assetHash, cloudflareWorkersConfigFromEnv } from './cloudflare-workers';

type Call = { method: string; path: string; auth: string | null; json: unknown; form: FormData | null };
type Reply = { status: number; body: unknown };

const ACCOUNT = '0123456789abcdef0123456789abcdef';

function mockCloudflare(handler: (call: Call) => Reply) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const body = init.body;
    const call: Call = {
      method: init.method ?? 'GET',
      path: url.replace('https://api.cloudflare.com/client/v4', ''),
      auth: new Headers(init.headers).get('authorization'),
      json: typeof body === 'string' ? JSON.parse(body) : null,
      form: body instanceof FormData ? body : null,
    };
    calls.push(call);
    const out = handler(call);
    return new Response(JSON.stringify(out.body), { status: out.status });
  });
  return calls;
}

const enc = new TextEncoder();
const FILES = [
  { path: '/index.html', bytes: enc.encode('<html>'), contentType: 'text/html' },
  { path: '/assets/app.css', bytes: enc.encode('body{}'), contentType: 'text/css' },
];

function deployer() {
  return new CloudflareSiteWorkerDeployer({ apiToken: 'cf-token', accountId: ACCOUNT, subdomain: 'vinothjv4-tech' });
}

afterEach(() => vi.unstubAllGlobals());

describe('CloudflareSiteWorkerDeployer', () => {
  it('uploads the assets, deploys a tagged Worker and turns on workers.dev', async () => {
    const indexHash = assetHash(Buffer.from('<html>').toString('base64'), '/index.html');
    const cssHash = assetHash(Buffer.from('body{}').toString('base64'), '/assets/app.css');
    const calls = mockCloudflare(({ method, path }) => {
      if (path.endsWith('/script-settings')) return { status: 404, body: { success: false, errors: [{ code: 10007, message: 'not found' }] } };
      if (path.endsWith('/assets-upload-session')) {
        return { status: 200, body: { success: true, result: { jwt: 'upload-jwt', buckets: [[indexHash], [cssHash]] } } };
      }
      if (path.includes('/workers/assets/upload')) {
        return { status: 201, body: { success: true, result: method === 'POST' && calls.filter((c) => c.path.includes('/assets/upload')).length === 2 ? { jwt: 'done-jwt' } : null } };
      }
      return { status: 200, body: { success: true, result: {} } };
    });

    const result = await deployer().deploy({ name: 'ja-edu-sg', files: FILES });

    expect(result).toEqual({ name: 'ja-edu-sg', url: 'https://ja-edu-sg.vinothjv4-tech.workers.dev' });
    const session = calls.find((c) => c.path.endsWith('/assets-upload-session'))!;
    expect(session.path).toBe(`/accounts/${ACCOUNT}/workers/scripts/ja-edu-sg/assets-upload-session`);
    expect(session.json).toEqual({
      manifest: { '/index.html': { hash: indexHash, size: 6 }, '/assets/app.css': { hash: cssHash, size: 6 } },
    });
    const uploads = calls.filter((c) => c.path.includes('/workers/assets/upload'));
    expect(uploads).toHaveLength(2);
    expect(uploads.every((c) => c.path.endsWith('?base64=true') && c.auth === 'Bearer upload-jwt')).toBe(true);
    const part = uploads[0]!.form!.get(indexHash) as Blob;
    expect(part.type).toBe('text/html');
    expect(await part.text()).toBe(Buffer.from('<html>').toString('base64'));

    const put = calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe(`/accounts/${ACCOUNT}/workers/scripts/ja-edu-sg`);
    expect(put.auth).toBe('Bearer cf-token');
    const metadata = JSON.parse(await (put.form!.get('metadata') as Blob).text());
    expect(metadata).toMatchObject({
      main_module: 'worker.js',
      assets: { jwt: 'done-jwt', config: { html_handling: 'auto-trailing-slash' } },
      bindings: [{ type: 'assets', name: 'ASSETS' }],
      tags: ['moncha-site'],
    });
    expect(await (put.form!.get('worker.js') as Blob).text()).toContain('env.ASSETS.fetch');
    expect(calls.at(-1)).toMatchObject({ method: 'POST', path: `/accounts/${ACCOUNT}/workers/scripts/ja-edu-sg/subdomain`, json: { enabled: true, previews_enabled: false } });
  });

  it('skips the upload when Cloudflare already has every file', async () => {
    const calls = mockCloudflare(({ path }) => {
      if (path.endsWith('/script-settings')) return { status: 200, body: { success: true, result: { tags: ['moncha-site'] } } };
      if (path.endsWith('/assets-upload-session')) return { status: 200, body: { success: true, result: { jwt: 'done-jwt', buckets: [] } } };
      return { status: 200, body: { success: true, result: {} } };
    });
    await deployer().deploy({ name: 'ja-edu-sg', files: FILES });
    expect(calls.some((c) => c.path.includes('/workers/assets/upload'))).toBe(false);
    const put = calls.find((c) => c.method === 'PUT')!;
    expect(JSON.parse(await (put.form!.get('metadata') as Blob).text()).assets.jwt).toBe('done-jwt');
  });

  it('never replaces a Worker that MonCha did not make', async () => {
    const calls = mockCloudflare(({ path }) =>
      path.endsWith('/script-settings') ? { status: 200, body: { success: true, result: { tags: [] } } } : { status: 500, body: {} },
    );
    const error = await deployer().deploy({ name: 'moncha-backend', files: FILES }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SiteDeployError);
    expect(error).toMatchObject({ code: 'worker_name_taken', retryable: false });
    expect(calls).toHaveLength(1);
  });

  it('refuses a new Worker when the account is at its Worker limit, before uploading anything', async () => {
    const calls = mockCloudflare(({ path }) => {
      if (path.endsWith('/script-settings')) return { status: 404, body: { success: false, errors: [{ code: 10007, message: 'not found' }] } };
      if (path.endsWith('/workers/scripts')) return { status: 200, body: { success: true, result: [{ id: 'a' }, { id: 'b' }] } };
      return { status: 500, body: {} };
    });
    const small = new CloudflareSiteWorkerDeployer({ apiToken: 'cf-token', accountId: ACCOUNT, subdomain: 'x', maxWorkers: 2 });
    await expect(small.deploy({ name: 'new-site', files: FILES })).rejects.toMatchObject({ code: 'worker_limit_reached', retryable: true });
    expect(calls.map((c) => c.path.split('/').pop())).toEqual(['script-settings', 'scripts']);
  });

  it('still redeploys an existing site Worker at the limit', async () => {
    const calls = mockCloudflare(({ path }) => {
      if (path.endsWith('/script-settings')) return { status: 200, body: { success: true, result: { tags: ['moncha-site'] } } };
      if (path.endsWith('/assets-upload-session')) return { status: 200, body: { success: true, result: { jwt: 'done-jwt', buckets: [] } } };
      return { status: 200, body: { success: true, result: {} } };
    });
    const small = new CloudflareSiteWorkerDeployer({ apiToken: 'cf-token', accountId: ACCOUNT, subdomain: 'x', maxWorkers: 1 });
    await expect(small.deploy({ name: 'ja-edu-sg', files: FILES })).resolves.toMatchObject({ name: 'ja-edu-sg' });
    expect(calls.some((c) => c.path.endsWith('/workers/scripts'))).toBe(false);
  });

  it("maps Cloudflare's own script limit error to worker_limit_reached", async () => {
    mockCloudflare(({ method, path }) => {
      if (path.endsWith('/script-settings')) return { status: 404, body: { success: false, errors: [{ code: 10007, message: 'not found' }] } };
      if (path.endsWith('/workers/scripts') && method === 'GET') return { status: 200, body: { success: true, result: [] } };
      if (path.endsWith('/assets-upload-session')) return { status: 200, body: { success: true, result: { jwt: 'done-jwt', buckets: [] } } };
      if (method === 'PUT') {
        return { status: 400, body: { success: false, errors: [{ code: 10037, message: 'You have exceeded the limit of 100 scripts' }] } };
      }
      return { status: 200, body: { success: true, result: {} } };
    });
    await expect(deployer().deploy({ name: 'new-site', files: FILES })).rejects.toMatchObject({ code: 'worker_limit_reached' });
  });

  it('explains a token without Workers access', async () => {
    mockCloudflare(() => ({ status: 403, body: { success: false, errors: [{ code: 10000, message: 'Authentication error' }] } }));
    await expect(deployer().deploy({ name: 'ja-edu-sg', files: FILES })).rejects.toMatchObject({ code: 'cloudflare_bad_token' });
  });

  it('rejects names that are not one DNS label', async () => {
    await expect(deployer().deploy({ name: 'Bad.Name', files: FILES })).rejects.toMatchObject({ code: 'worker_bad_name', retryable: false });
  });

  it('reads the workers.dev subdomain from the account when it is not configured', async () => {
    const calls = mockCloudflare(() => ({ status: 200, body: { success: true, result: { subdomain: 'vinothjv4-tech' } } }));
    const fresh = new CloudflareSiteWorkerDeployer({ apiToken: 'cf-token', accountId: ACCOUNT });
    expect(await fresh.urlFor('ja-edu-sg')).toBe('https://ja-edu-sg.vinothjv4-tech.workers.dev');
    expect(await fresh.urlFor('other')).toBe('https://other.vinothjv4-tech.workers.dev');
    expect(calls).toHaveLength(1);
    expect(calls[0]!.path).toBe(`/accounts/${ACCOUNT}/workers/subdomain`);
  });

  it('counts site Workers in check()', async () => {
    mockCloudflare(({ path }) =>
      path.endsWith('/workers/scripts')
        ? { status: 200, body: { success: true, result: [{ id: 'a', tags: ['moncha-site'] }, { id: 'moncha-backend', tags: [] }] } }
        : { status: 500, body: {} },
    );
    expect(await deployer().check()).toEqual({
      subdomain: 'vinothjv4-tech',
      canRead: true,
      siteWorkers: 1,
      totalWorkers: 2,
      workerLimit: 100,
      error: null,
    });
  });
});

describe('cloudflareWorkersConfigFromEnv', () => {
  it('needs a token and falls back to the R2 account id', () => {
    expect(cloudflareWorkersConfigFromEnv({ CLOUDFLARE_API_TOKEN: 't', R2_ACCOUNT_ID: ACCOUNT })).toEqual({
      apiToken: 't',
      accountId: ACCOUNT,
      subdomain: null,
      maxWorkers: 100,
    });
    expect(cloudflareWorkersConfigFromEnv({ CLOUDFLARE_API_TOKEN: 't', R2_ACCOUNT_ID: ACCOUNT, CLOUDFLARE_WORKERS_LIMIT: '500' })?.maxWorkers).toBe(500);
    expect(cloudflareWorkersConfigFromEnv({ R2_ACCOUNT_ID: ACCOUNT })).toBeNull();
    expect(cloudflareWorkersConfigFromEnv({ CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'nope' })).toBeNull();
  });
});
