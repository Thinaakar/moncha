import 'server-only';
import { cookies } from 'next/headers';
import type { User } from '@/lib/types';
import { backendConfig, backendHeaders, SESSION_COOKIE } from './config';

export async function sessionToken() {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export type SessionState =
  | { status: 'ok'; user: User }
  | { status: 'unauthenticated' }
  | { status: 'unavailable'; message: string };

/** Resolves the signed-in user from the backend; distinguishes "logged out" from "backend down". */
export async function getSession(): Promise<SessionState> {
  const token = await sessionToken();
  if (!token) return { status: 'unauthenticated' };
  try {
    const res = await fetch(`${backendConfig().baseUrl}/api/v1/auth/me`, {
      headers: backendHeaders(token),
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 401) return { status: 'unauthenticated' };
    if (!res.ok) return { status: 'unavailable', message: `Backend responded ${res.status}` };
    const data = (await res.json()) as { user: User };
    return { status: 'ok', user: data.user };
  } catch (error) {
    return { status: 'unavailable', message: error instanceof Error ? error.message : 'Backend unreachable' };
  }
}
