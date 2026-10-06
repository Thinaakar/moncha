import { NextResponse } from 'next/server';
import { registerSchema } from '@moncha/contracts';
import { callBackend, errorResponse } from '@/lib/server/backend';
import { SESSION_COOKIE, sessionCookieOptions } from '@/lib/server/config';
import type { User } from '@/lib/types';

export async function POST(req: Request) {
  const parsed = registerSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'Invalid request', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const res = await callBackend('/api/v1/auth/register', {
    method: 'POST',
    body: JSON.stringify(parsed.data),
    contentType: 'application/json',
  });
  if (!res.ok) return NextResponse.json(res.json, { status: res.status });

  const session = res.json as { token: string; expiresAt: string; user: User };
  if (!session?.token) return errorResponse(502, 'bad_gateway', 'Backend did not return a session');
  const response = NextResponse.json({ user: session.user }, { status: 201 });
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  return response;
}
