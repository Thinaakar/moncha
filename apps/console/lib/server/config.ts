import 'server-only';

export const SESSION_COOKIE = 'moncha_session';

export function backendConfig() {
  const baseUrl = (process.env.BACKEND_URL || 'http://127.0.0.1:4000').replace(/\/+$/, '');
  return {
    baseUrl,
    tenantId: process.env.TENANT_ID || process.env.DEFAULT_TENANT_ID || '',
    apiKey: process.env.WORKER_API_KEY || '',
  };
}

/** Headers every backend call needs; the bearer token is added when the user is signed in. */
export function backendHeaders(token?: string, extra?: HeadersInit): Headers {
  const { tenantId, apiKey } = backendConfig();
  const headers = new Headers(extra);
  headers.set('accept', 'application/json');
  if (tenantId) headers.set('x-tenant-id', tenantId);
  if (apiKey) headers.set('x-api-key', apiKey);
  if (token) headers.set('authorization', `Bearer ${token}`);
  return headers;
}

export function sessionCookieOptions(expiresAt?: string) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  };
}
