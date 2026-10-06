import { NextResponse } from 'next/server';
import { passwordLoginSchema } from '@moncha/contracts';
import { callBackend, errorResponse } from '@/lib/server/backend';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/server/config';
import type { User } from '@/lib/types';

export async function POST(req: Request) {
  const parsed = passwordLoginSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return errorResponse(400, 'validation_error', 'Enter a valid email and password');

  const res = await callBackend('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
    contentType: 'application/json',
  });
  if (!res.ok) return NextResponse.json(res.json, { status: res.status });

  const session = res.json as { token: string; expiresAt: string; user: User };
  const response = NextResponse.json({ user: session.user });
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return response;
}
