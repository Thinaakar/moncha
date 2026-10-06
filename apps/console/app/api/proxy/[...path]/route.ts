import { NextResponse, type NextRequest } from 'next/server';
import { callBackend, errorResponse } from '@/lib/server/backend';
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

async function forward(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  if (path.some((segment) => segment === '..' || segment === '.' || segment.includes('\\'))) {
    return errorResponse(400, 'validation_error', 'Invalid path');
  }
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
