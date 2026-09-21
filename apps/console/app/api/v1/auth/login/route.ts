import { NextResponse } from 'next/server';
import { loginSchema } from '@moncha/contracts';
import { prisma, PrismaUserRepository } from '@moncha/db';
import { jsonError } from '@/lib/errors';
import { unauthorized } from '@/lib/api-error';
import { sessionCookie, signSession } from '@/lib/session';

export async function POST(req: Request) {
  try {
    const input = loginSchema.parse(await req.json());
    const user = await new PrismaUserRepository(prisma).findByEmail(input.email);
    if (!user) throw unauthorized('Unknown operator');
    const token = signSession({ userId: user.id, tenantId: user.tenantId, role: user.role });
    const response = NextResponse.json({
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    });
    response.headers.set('set-cookie', sessionCookie(token));
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
