import { NextResponse } from 'next/server';
import { clearSessionCookie, readCookie, sessionCookie, signSession } from './session';

export const BACKEND_TOKEN_COOKIE = 'moncha_token';
const DEFAULT_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export type BackendUser = {
  id: string;
  tenantId: string;
  email: string;
  name: string | null;
  role: string;
  createdAt?: string;
};

type BackendSession = { token?: string; expiresAt?: string; user?: Partial<BackendUser> };

export function backendBaseUrl(): string | null {
  return process.env.WORKER_API_BASE_URL?.trim().replace(/\/+$/, '') || null;
}

function errorResponse(message: string, status: number) {
  return NextResponse.json({ error: { code: 'internal_error', message } }, { status });
}

export async function callBackendAuth(
  path: string,
  init: { method: 'GET' | 'POST'; body?: string; token?: string },
): Promise<{ response: Response; data: Record<string, unknown> } | NextResponse> {
  const baseUrl = backendBaseUrl();
  if (!baseUrl) return errorResponse('Backend API is not configured', 503);

  const headers = new Headers({ accept: 'application/json' });
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  if (init.token) headers.set('authorization', `Bearer ${init.token}`);
  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (tenantId) headers.set('x-tenant-id', tenantId);
  const apiKey = process.env.WORKER_API_KEY;
  if (apiKey) headers.set('x-api-key', apiKey);

  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: init.method,
      headers,
      body: init.body,
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    return errorResponse('Backend API is unavailable', 503);
  }

  const data = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (data === null) return errorResponse('Backend API returned an invalid response', 502);
  return { response, data };
}

export function readBackendToken(req: Request): string | undefined {
  return readCookie(req.headers.get('cookie'), BACKEND_TOKEN_COOKIE) || undefined;
}

function tokenCookie(token: string, expiresAt?: string): string {
  const expires = expiresAt ? Date.parse(expiresAt) : NaN;
  const maxAge = Number.isFinite(expires)
    ? Math.max(0, Math.floor((expires - Date.now()) / 1000))
    : DEFAULT_MAX_AGE_SECONDS;
  const parts = [`${BACKEND_TOKEN_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`];
  if (process.env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

function clearTokenCookie(): string {
  return `${BACKEND_TOKEN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function clearAuthCookies(response: NextResponse): NextResponse {
  response.headers.append('set-cookie', clearSessionCookie());
  response.headers.append('set-cookie', clearTokenCookie());
  return response;
}

export function signedInResponse(data: Record<string, unknown>, status: number): NextResponse {
  const { token, expiresAt, user } = data as BackendSession;
  if (!token || !user?.id || !user.tenantId) return errorResponse('Backend API returned an invalid response', 502);

  const response = NextResponse.json(
    {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      tenantId: user.tenantId,
      role: user.role,
      expiresAt,
    },
    { status },
  );
  response.headers.append(
    'set-cookie',
    sessionCookie(signSession({ userId: user.id, tenantId: user.tenantId, role: user.role || 'operator' })),
  );
  response.headers.append('set-cookie', tokenCookie(token, expiresAt));
  return response;
}
