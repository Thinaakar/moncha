import { cookies } from 'next/headers';
import type { AuthContext } from '@moncha/domain';
import { unauthorized } from './api-error';
import { readCookie, SESSION_COOKIE, verifySession } from './session';

function devFallback(): AuthContext | null {
  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) return null;
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_AUTH !== 'true') return null;
  return { userId: 'dev-operator', tenantId, role: 'admin' };
}

export function authFromRequest(req: Request): AuthContext {
  const token = readCookie(req.headers.get('cookie'), SESSION_COOKIE);
  const session = verifySession(token);
  if (session) return session;
  const fallback = devFallback();
  if (fallback) return fallback;
  throw unauthorized();
}

export async function getServerAuth(): Promise<AuthContext | null> {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (session) return session;
  return devFallback();
}

export async function requireServerAuth(): Promise<AuthContext> {
  const auth = await getServerAuth();
  if (!auth) throw unauthorized();
  return auth;
}
