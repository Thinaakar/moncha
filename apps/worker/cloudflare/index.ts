import { Container } from '@cloudflare/containers';

interface Env {
  BACKEND: DurableObjectNamespace<BackendWorker>;
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
  return env.BACKEND.get(env.BACKEND.idFromName(INSTANCE), { locationHint: 'enam' });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== '/health') return new Response('Not found', { status: 404 });
    const stub = backend(env);
    await stub.startAndWaitForPorts();
    return stub.fetch(new Request('http://container/health'));
  },

  /** Cron: (re)start the container if a deploy, crash or host restart stopped it. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(backend(env).startAndWaitForPorts());
  },
} satisfies ExportedHandler<Env>;
