import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function withConnectTimeout(url: string | undefined) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connect_timeout')) {
      u.searchParams.set('connect_timeout', '30');
    }
    // Opt-in only: pgbouncer=true makes every query ~4-5x slower against Neon's pooler, which
    // supports prepared statements. withDbRetry reconnects on "cached plan must not change result type".
    if (process.env.PRISMA_PGBOUNCER === '1' && !u.searchParams.has('pgbouncer')) {
      u.searchParams.set('pgbouncer', 'true');
    }
    return u.toString();
  } catch {
    return url;
  }
}

function createClient() {
  return new PrismaClient({
    datasources: {
      db: { url: withConnectTimeout(process.env.DATABASE_URL) },
    },
    log: process.env.PRISMA_LOG === '1' ? ['error', 'warn'] : ['error'],
  });
}

let current: PrismaClient = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = current;
}

/**
 * Stable handle that always forwards to the live client, so repositories keep working after
 * replaceClient() swaps in a fresh engine.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const value = Reflect.get(current, prop);
    return typeof value === 'function' ? value.bind(current) : value;
  },
});

const STALE_CLIENT_GRACE_MS = 30_000;
let replacing: Promise<void> | null = null;

/**
 * Once Prisma's engine drops its connection it never recovers: $disconnect() throws "Engine is
 * not yet connected", $connect() is a no-op and every later query fails. Only a new client works.
 */
function replaceClient() {
  replacing ??= (async () => {
    const stale = current;
    current = createClient();
    if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = current;
    setTimeout(() => void stale.$disconnect().catch(() => undefined), STALE_CLIENT_GRACE_MS).unref();
  })().finally(() => {
    replacing = null;
  });
  return replacing;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function needsFreshClient(error: unknown) {
  return /Engine is not yet connected|cached plan must not change result type|0A000/i.test(errorMessage(error));
}

export function isTransientDbError(error: unknown) {
  return (
    needsFreshClient(error) ||
    /Can't reach database server|P1001|P1017|P2028|Unable to start a transaction|Connection reset|ECONNRESET|ETIMEDOUT|timed out/i.test(
      errorMessage(error),
    )
  );
}

/** Retry a few times while Neon compute wakes from idle. */
export async function withDbRetry<T>(fn: () => Promise<T>, attempts = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (error) {
      last = error;
      if (!isTransientDbError(error) || i === attempts - 1) throw error;
      if (needsFreshClient(error)) await replaceClient();
      await new Promise((resolve) => setTimeout(resolve, 1200 * (i + 1)));
    }
  }
  throw last;
}
