import { NextResponse } from 'next/server';
import { jsonError } from '@/lib/errors';
import { callBackendAuth, signedInResponse } from '@/lib/backend-auth';

export async function POST(req: Request) {
  try {
    const result = await callBackendAuth('/api/v1/auth/register', { method: 'POST', body: await req.text() });
    if (result instanceof NextResponse) return result;
    const { response, data } = result;
    if (!response.ok) return NextResponse.json(data, { status: response.status });
    return signedInResponse(data, 201);
  } catch (error) {
    return jsonError(error);
  }
}
