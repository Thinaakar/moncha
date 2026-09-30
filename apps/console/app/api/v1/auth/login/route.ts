import { NextResponse } from 'next/server';
import { loginSchema } from '@moncha/contracts';
import type { AuthContext } from '@moncha/domain';
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
