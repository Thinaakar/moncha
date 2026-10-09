import { Container } from '@cloudflare/containers';
import { handleNeonApi } from './neon-router';

interface Env {
  BACKEND?: DurableObjectNamespace<BackendWorker>;
  DATABASE_URL?: string;
  DEFAULT_TENANT_ID?: string;
  WORKER_API_KEY?: string;
  [key: string]: unknown;
}

const INSTANCE = 'backend';

/** Every string var and secret on the Worker is handed to the container as an env var. */
function containerEnv(env: Env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

/** The long-running backend (apps/worker/src/poller.ts) in one container instance. */
export class BackendWorker extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = '1h';

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = containerEnv(env);
  }

  /** The worker polls the database and gets no inbound traffic, so it must not stop when idle. */
  override async onActivityExpired(): Promise<void> {}

  override onStop(params: { exitCode?: number; reason?: string }) {
    console.log(JSON.stringify({ event: 'backend_container_stopped', ...params }));
  }

  override onError(error: unknown) {
    console.log(JSON.stringify({ event: 'backend_container_error', message: String(error) }));
    throw error;
  }
}

function backend(env: Env) {
  if (!env.BACKEND) throw new Error('Container backend not bound');
  return env.BACKEND.get(env.BACKEND.idFromName(INSTANCE), { locationHint: 'enam' });
}

function corsHeaders(request: Request): Record<string, string> {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD',
    'Access-Control-Allow-Headers':
      request.headers.get('Access-Control-Request-Headers') ||
      'Content-Type, Authorization, x-tenant-id, x-api-key',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request),
      });
    }

    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === '/') {
      return new Response(
        JSON.stringify(
          {
            service: 'moncha-backend',
            status: 'ok',
            endpoints: [
              '/health',
              '/api/v1/auth/login',
              '/api/v1/auth/me',
              '/api/v1/auth/forgot-password',
              '/api/v1/auth/reset-password',
              '/api/v1/auth/change-password',
              '/api/v1/schedules',
              '/api/v1/schedules/runs',
              '/api/v1/leads',
              '/api/v1/source-imports',
              '/api/v1/worker/health',
              '/api/v1/leads/:id/site-snapshots',
              '/api/v1/site-snapshots',
              '/api/v1/site-snapshots/queue',
              '/api/v1/site-snapshots/:id',
              '/api/v1/site-snapshots/:id/source',
              '/api/v1/site-snapshots/:id/cancel',
              '/api/v1/site-snapshots/:id/github-push',
              '/api/v1/site-automation',
              '/api/v1/site-automation/crawls',
              '/api/v1/site-files/:token/*path',
            ],
          },
          null,
          2,
        ),
        {
          status: 200,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            ...corsHeaders(request),
          },
        },
      );
    }

    const isAllowed = pathname === '/health' || pathname.startsWith('/api/');
    if (!isAllowed) {
      return new Response(
        JSON.stringify({ error: { code: 'not_found', message: `Route not found: ${pathname}` } }, null, 2),
        {
          status: 404,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            ...corsHeaders(request),
          },
        },
      );
    }

    // 1. Direct Edge-native Neon API: handles /health and /api/v1/* with zero container overhead
    const neonResponse = await handleNeonApi(request, env, corsHeaders(request));
    if (neonResponse) {
      return neonResponse;
    }

    if (!env.BACKEND) {
      return new Response(
        JSON.stringify({ error: { code: 'not_found', message: `Route not found: ${pathname}` } }, null, 2),
        {
          status: 404,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            ...corsHeaders(request),
          },
        },
      );
    }

    try {
      const stub = backend(env);
      await stub.startAndWaitForPorts();

      const containerUrl = new URL(pathname + url.search, 'http://container');
      const containerRequest = new Request(containerUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
        // @ts-expect-error duplex is required for streaming bodies in standard fetch
        duplex: 'half',
      });

      const response = await stub.fetch(containerRequest);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(corsHeaders(request))) {
        headers.set(key, value);
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      return new Response(
        JSON.stringify(
          {
            error: {
              code: 'gateway_error',
              message: error instanceof Error ? error.message : String(error),
            },
          },
          null,
          2,
        ),
        {
          status: 502,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            ...corsHeaders(request),
          },
        },
      );
    }
  },

  /** Cron: (re)start the container if a deploy, crash or host restart stopped it. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (env.BACKEND) {
      ctx.waitUntil(backend(env).startAndWaitForPorts().catch(() => undefined));
    }
  },
} satisfies ExportedHandler<Env>;
