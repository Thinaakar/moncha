import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function withConnectTimeout(url: string | undefined) {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (!u.searchParams.has('connect_timeout')) {
      u.searchParams.set('connect_timeout', '30');
    }
    // Neon pooler / PgBouncer: disable prepared-statement cache so schema
    // resets don't hit "cached plan must not change result type".
    if (u.hostname.includes('-pooler.') && !u.searchParams.has('pgbouncer')) {
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

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

function isTransientDbError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /Can't reach database server|P1001|P1017|Connection reset|ECONNRESET|ETIMEDOUT|timed out|cached plan must not change result type|0A000/i.test(
    message,
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
      await prisma.$disconnect().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 1200 * (i + 1)));
      await prisma.$connect().catch(() => undefined);
    }
  }
  throw last;
}
