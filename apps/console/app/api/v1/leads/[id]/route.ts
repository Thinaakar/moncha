import { NextResponse } from 'next/server';
import { prisma, PrismaLeadRepository } from '@moncha/db';
import { authFromRequest } from '@/lib/auth';
import { jsonError } from '@/lib/errors';
import { notFound } from '@/lib/api-error';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = authFromRequest(req);
    const { id } = await params;
    const lead = await new PrismaLeadRepository(prisma).get(auth.tenantId, id);
    if (!lead) throw notFound('Lead not found');
    return NextResponse.json(lead);
  } catch (error) {
    return jsonError(error);
  }
}
