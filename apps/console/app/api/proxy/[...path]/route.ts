import { NextResponse, type NextRequest } from 'next/server';
import { callBackend, errorResponse, streamBackend } from '@/lib/server/backend';
import { SESSION_COOKIE } from '@/lib/server/config';

/** Reachable without a session (password reset flow). */
const PUBLIC_PATHS = new Set(['auth/forgot-password', 'auth/reset-password']);
/** Session-issuing routes go through /api/auth/* so the token stays in the httpOnly cookie. */
const BLOCKED_PATHS = new Set(['auth/login', 'auth/register']);
const MAX_BODY_BYTES = 10_000_000;
/** Reads just above the worker's 25s read deadline, so its 503 wins over our 504. */
const READ_TIMEOUT_MS = 30_000;
const WRITE_TIMEOUT_MS = 60_000;
const IMPORT_TIMEOUT_MS = 120_000;
const SITE_FILE_TIMEOUT_MS = 60_000;
const SITE_FILE_HEADERS = ['content-type', 'content-length', 'cache-control', 'content-disposition'];
const PREVIEW_TOKEN_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Public origin of the console as the browser sees it (the preview CSP must name it). */
function consoleOrigin(req: NextRequest): string {
  const host = (req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? '').split(',')[0]!.trim();
  const proto = (req.headers.get('x-forwarded-proto') ?? '').split(',')[0]!.trim();
  if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) return req.nextUrl.origin;
  return `${proto === 'http' || proto === 'https' ? proto : req.nextUrl.protocol.replace(':', '')}://${host}`;
}

/**
 * Website copy files for the sandboxed preview iframe. The iframe has an opaque origin, so no session
 * cookie arrives; access is gated by the signed token in the path, checked by the backend. Copied pages
 * may load files of their own snapshot only and can never call the network or this console.
 */
async function siteFile(req: NextRequest, path: string[]) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return errorResponse(405, 'method_not_allowed', 'Read only');
  const [, token, ...rest] = path;
  if (!token || !PREVIEW_TOKEN_RE.test(token) || rest.length === 0) return errorResponse(400, 'invalid_path', 'Invalid file path');

  const filePath = rest.map(encodeURIComponent).join('/');
  const download = req.nextUrl.searchParams.get('download') === '1' ? '?download=1' : '';
  const res = await streamBackend(`/api/v1/site-files/${token}/${filePath}${download}`, { timeoutMs: SITE_FILE_TIMEOUT_MS });
  if (!res) return errorResponse(502, 'backend_unreachable', 'Cannot reach the backend service');

  const headers = new Headers();
  for (const name of SITE_FILE_HEADERS) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  const root = `${consoleOrigin(req)}/api/proxy/site-files/${token}/`;
  headers.set(
    'content-security-policy',
    `sandbox allow-scripts; default-src ${root} data: blob: 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; ` +
      `frame-src 'none'; form-action 'none'; base-uri 'self'; frame-ancestors 'self'`,
  );
  headers.set('x-content-type-options', 'nosniff');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-frame-options', 'SAMEORIGIN');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  // Fonts and module scripts are CORS requests from the iframe's opaque (null) origin.
  headers.set('access-control-allow-origin', '*');
  return new Response(req.method === 'HEAD' ? null : res.body, { status: res.status, headers });
}

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.some((segment) => segment === '..' || segment === '.' || segment.includes('\\'))) {
    return errorResponse(400, 'validation_error', 'Invalid path');
  }
  if (path[0] === 'site-files') return siteFile(req, path);
  const joined = path.map(encodeURIComponent).join('/');
  if (BLOCKED_PATHS.has(joined)) return errorResponse(404, 'not_found', 'Not found');

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token && !PUBLIC_PATHS.has(joined)) return errorResponse(401, 'unauthorized', 'Sign in to continue');

  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = hasBody ? await req.text() : null;
  if (body && body.length > MAX_BODY_BYTES) return errorResponse(413, 'payload_too_large', 'Body larger than 10 MB');

  const backendPath = joined === 'health' ? '/health' : `/api/v1/${joined}`;
  const res = await callBackend(`${backendPath}${req.nextUrl.search}`, {
    method: req.method,
    token,
    body: body || null,
    contentType: body ? (req.headers.get('content-type') ?? 'application/json') : null,
    timeoutMs: joined === 'source-imports' ? IMPORT_TIMEOUT_MS : hasBody ? WRITE_TIMEOUT_MS : READ_TIMEOUT_MS,
  });

  const response = NextResponse.json(res.json, { status: res.status });
  if (res.status === 401 && token) response.cookies.delete(SESSION_COOKIE);
  return response;
}

export const GET = forward;
export const POST = forward;
export const PATCH = forward;
export const PUT = forward;
export const DELETE = forward;
export const dynamic = 'force-dynamic';
