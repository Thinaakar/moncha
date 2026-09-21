import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AuthContext } from '@moncha/domain';

export const SESSION_COOKIE = 'moncha_session';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

type SessionPayload = AuthContext & { exp: number };

function secret(): string {
  return process.env.SESSION_SECRET || process.env.DEFAULT_TENANT_ID || 'moncha-dev-session';
}

export function signSession(context: AuthContext): string {
  const payload: SessionPayload = {
    ...context,
    exp: Date.now() + MAX_AGE_SECONDS * 1000,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifySession(token?: string | null): AuthContext | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload;
    if (!payload.tenantId || !payload.userId || payload.exp < Date.now()) return null;
    return { userId: payload.userId, tenantId: payload.tenantId, role: payload.role };
  } catch {
    return null;
  }
}

export function sessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${MAX_AGE_SECONDS}`,
  ];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  const parts = header.split(';');
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=');
  }
  return undefined;
}
