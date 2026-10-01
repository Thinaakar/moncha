import { NextResponse } from 'next/server';
import { authFromRequest } from '@/lib/auth';
import { jsonError } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    authFromRequest(req);
    const baseUrl = (process.env.WORKER_HEALTH_BASE_URL || 'http://127.0.0.1:8080').trim().replace(/\/+$/, '');
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/health`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Worker container is unavailable' } },
        { status: 503 },
      );
    }
    const data: unknown = await response.json().catch(() => null);
    if (data === null) {
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Worker container returned an invalid response' } },
        { status: 502 },
      );
    }
    return NextResponse.json(data, { status: response.status });
  } catch (error) {
    return jsonError(error);
  }
}