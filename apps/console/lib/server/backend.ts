import 'server-only';
import { NextResponse } from 'next/server';
import { backendConfig, backendHeaders } from './config';

export function errorResponse(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

/**
 * Raw GET to the backend for streamed bodies (website copy files). Returns the backend response
 * untouched, or null when the backend is unreachable or too slow to answer.
 */
export async function streamBackend(path: string, init: { timeoutMs?: number } = {}) {
  const headers = backendHeaders();
  headers.set('accept', '*/*');
  const started = Date.now();
  try {
    return await fetch(`${backendConfig().baseUrl}${path}`, {
      headers,
      cache: 'no-store',
      signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    console.error(timedOut ? 'backend_timeout' : 'backend_unreachable', {
      method: 'GET',
      path: path.split('?')[0]!.replace(/\/site-files\/[^/]+/, '/site-files/<token>'),
      ms: Date.now() - started,
    });
    return null;
  }
}

/** JSON call to the backend; network failures become a 502 envelope instead of throwing. */
export async function callBackend(
  path: string,
  init: { method?: string; token?: string; body?: string | null; contentType?: string | null; timeoutMs?: number } = {},
) {
  const headers = backendHeaders(init.token);
  if (init.contentType) headers.set('content-type', init.contentType);
  const method = init.method ?? 'GET';
  const route = path.split('?')[0];
  const started = Date.now();
  try {
    const res = await fetch(`${backendConfig().baseUrl}${path}`, {
      method,
      headers,
      body: init.body ?? undefined,
      cache: 'no-store',
      signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { error: { code: 'bad_gateway', message: 'Backend returned a non-JSON response' } };
    }
    if (res.status >= 500) {
      const code = (json as { error?: { code?: string } } | null)?.error?.code;
      console.error('backend_error', { method, path: route, status: res.status, code, ms: Date.now() - started });
    }
    return { ok: res.ok, status: res.status, json };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'TimeoutError';
    console.error(timedOut ? 'backend_timeout' : 'backend_unreachable', {
      method,
      path: route,
      ms: Date.now() - started,
      ...(timedOut ? {} : { message: error instanceof Error ? error.message : String(error) }),
    });
    return {
      ok: false,
      status: timedOut ? 504 : 502,
      json: {
        error: {
          code: timedOut ? 'gateway_timeout' : 'backend_unreachable',
          message: timedOut ? 'The backend took too long to respond' : 'Cannot reach the backend service',
        },
      },
    };
  }
}
