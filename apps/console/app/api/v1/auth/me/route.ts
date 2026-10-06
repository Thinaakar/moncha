import { NextResponse } from 'next/server';
import { backendBaseUrl, callBackendAuth, clearAuthCookies, readBackendToken } from '@/lib/backend-auth';
import { jsonError } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    if (!backendBaseUrl()) {
      return NextResponse.json(
        { error: { code: 'internal_error', message: 'Backend API is not configured' } },
        { status: 503 },
      );
    }

    const token = readBackendToken(req);
    if (!token) {
      return clearAuthCookies(
        NextResponse.json({ error: { code: 'unauthorized', message: 'Not signed in' } }, { status: 401 }),
      );
    }

    const result = await callBackendAuth('/api/v1/auth/me', { method: 'GET', token });
    if (result instanceof NextResponse) return result;
    const { response, data } = result;
    const reply = NextResponse.json(data, { status: response.status });
    return response.status === 401 ? clearAuthCookies(reply) : reply;
  } catch (error) {
    return jsonError(error);
  }
}
