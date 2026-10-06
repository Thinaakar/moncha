import { NextResponse, type NextRequest } from 'next/server';
import { callBackend } from '@/lib/server/backend';
import { SESSION_COOKIE } from '@/lib/server/config';

async function revoke(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await callBackend('/api/v1/auth/logout', { method: 'POST', token, timeoutMs: 5_000 });
}

export async function POST(req: NextRequest) {
  await revoke(req);
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}

/** Used by server components when the session is no longer valid: clears the cookie and goes to /login. */
export async function GET(req: NextRequest) {
  await revoke(req);
  const target = new URL('/login', req.url);
  const next = req.nextUrl.searchParams.get('next');
  if (next?.startsWith('/') && !next.startsWith('//')) target.searchParams.set('next', next);
  if (req.nextUrl.searchParams.get('expired')) target.searchParams.set('expired', '1');
  const response = NextResponse.redirect(target);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
