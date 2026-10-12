import { NextResponse } from 'next/server';
import type { DemoLoginStatus } from '@moncha/contracts';
import { callBackend, errorResponse } from '@/lib/server/backend';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/server/config';
import type { User } from '@/lib/types';

export async function GET() {
  const res = await callBackend('/api/v1/auth/demo');
  const status: DemoLoginStatus = res.ok ? (res.json as DemoLoginStatus) : { enabled: false, email: null };
  return NextResponse.json(status, { headers: { 'cache-control': 'no-store' } });
}

export async function POST() {
  const res = await callBackend('/api/v1/auth/demo', { method: 'POST' });
  if (!res.ok) return NextResponse.json(res.json, { status: res.status });

  const session = res.json as { token: string; expiresAt: string; user: User };
  if (!session?.token) return errorResponse(502, 'bad_gateway', 'Backend did not return a session');
  const response = NextResponse.json({ user: session.user });
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return response;
}
