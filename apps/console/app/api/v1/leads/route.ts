import { NextResponse } from 'next/server';
import { leadListQuerySchema, manualLeadSchema } from '@moncha/contracts';
import { prisma, PrismaCompanyRepository, PrismaLeadRepository } from '@moncha/db';
import { createConsoleLogger, createManualLead } from '@moncha/domain';
import { authFromRequest } from '@/lib/auth';
import { jsonError } from '@/lib/errors';

export async function GET(req: Request) {
  try {
    const auth = authFromRequest(req);
    const url = new URL(req.url);
    const query = leadListQuerySchema.parse({
      page: url.searchParams.get('page') ?? undefined,
      pageSize: url.searchParams.get('pageSize') ?? undefined,
      search: url.searchParams.get('search') ?? undefined,
      country: url.searchParams.get('country') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
    });
    const result = await new PrismaLeadRepository(prisma).list(auth.tenantId, query);
    return NextResponse.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(req: Request) {
  try {
    const auth = authFromRequest(req);
    const input = manualLeadSchema.parse(await req.json());
    const result = await createManualLead(
      {
        companies: new PrismaCompanyRepository(prisma),
        leads: new PrismaLeadRepository(prisma),
        logger: createConsoleLogger(),
      },
      { ...input, tenantId: auth.tenantId },
    );
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    return jsonError(error);
  }
}
