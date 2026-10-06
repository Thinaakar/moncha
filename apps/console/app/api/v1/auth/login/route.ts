import { NextResponse } from 'next/server';
import { loginSchema } from '@moncha/contracts';
import type { AuthContext } from '@moncha/domain';
import { backendBaseUrl, callBackendAuth, signedInResponse } from '@/lib/backend-auth';
import { jsonError } from '@/lib/errors';
import { unauthorized } from '@/lib/api-error';
import { sessionCookie, signSession } from '@/lib/session';

const DEMO_EMAIL = 'operator@moncha.local';

function signedIn(context: AuthContext, email: string) {
  const response = NextResponse.json({ id: context.userId, email, tenantId: context.tenantId, role: context.role });
  response.headers.set('set-cookie', sessionCookie(signSession(context)));
  return response;
}

export async function POST(req: Request) {
  try {
    if (backendBaseUrl()) {
      const result = await callBackendAuth('/api/v1/auth/login', { method: 'POST', body: await req.text() });
      if (result instanceof NextResponse) return result;
      const { response, data } = result;
      if (!response.ok) return NextResponse.json(data, { status: response.status });
      return signedInResponse(data, 200);
    }

    const input = loginSchema.parse(await req.json());

    if (!process.env.DATABASE_URL) {
      if (input.email.toLowerCase() !== DEMO_EMAIL) throw unauthorized('Unknown operator');
      return signedIn(
        { userId: 'demo-operator', tenantId: process.env.DEFAULT_TENANT_ID || 'demo', role: 'admin' },
        DEMO_EMAIL,
      );
    }

    const { prisma, PrismaUserRepository } = await import('@moncha/db');
    const user = await new PrismaUserRepository(prisma).findByEmail(input.email);
    if (!user) throw unauthorized('Unknown operator');
    return signedIn({ userId: user.id, tenantId: user.tenantId, role: user.role }, user.email);
  } catch (error) {
    return jsonError(error);
  }
}
