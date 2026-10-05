import { NextResponse } from 'next/server';
import { backendBaseUrl, callBackendAuth, clearAuthCookies, readBackendToken } from '@/lib/backend-auth';

export async function POST(req: Request) {
  const token = readBackendToken(req);
  if (token && backendBaseUrl()) {
    await callBackendAuth('/api/v1/auth/logout', { method: 'POST', token }).catch(() => undefined);
  }
  return clearAuthCookies(NextResponse.json({ ok: true }));
}
