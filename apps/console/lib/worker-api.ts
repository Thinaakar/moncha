import { NextResponse } from 'next/server';
import { authFromRequest } from '@/lib/auth';
import { jsonError } from '@/lib/errors';

export async function proxyWorkerApi(req: Request, path: string, method: 'GET' | 'POST' | 'DELETE' = 'GET') {
  try {
    const auth = authFromRequest(req);
    const baseUrl = process.env.WORKER_API_BASE_URL?.trim().replace(/\/+$/, '');
    if (!baseUrl) {
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Backend API is not configured' } },
        { status: 503 },
      );
    }

    const target = new URL(`${baseUrl}${path.startsWith('/') ? path : `/${path}`}`);
    target.search = new URL(req.url).search;
    const headers = new Headers({ accept: 'application/json', 'x-tenant-id': auth.tenantId });
    const apiKey = process.env.WORKER_API_KEY;
    if (apiKey) headers.set('x-api-key', apiKey);

    let body: string | undefined;
    if (method === 'POST') {
      body = await req.text();
      headers.set('content-type', req.headers.get('content-type') || 'application/json');
    }

    let response: Response;
    try {
      response = await fetch(target, {
        method,
        headers,
        body,
        cache: 'no-store',
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Backend API is unavailable' } },
        { status: 503 },
      );
    }

    const data: unknown = await response.json().catch(() => null);
    if (data === null) {
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Backend API returned an invalid response' } },
        { status: 502 },
      );
    }
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return jsonError(error);
  }
}