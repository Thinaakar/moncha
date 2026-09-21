import { NextResponse } from 'next/server';
import { prisma, PrismaJobRunRepository, PrismaLeadRepository } from '@moncha/db';
import { authFromRequest } from '@/lib/auth';
import { jsonError } from '@/lib/errors';
import { notFound, providerError, validationError } from '@/lib/api-error';
import { enqueueWebsiteCheck } from '@/lib/enqueue';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = authFromRequest(req);
    const { id } = await params;
    if (req.headers.get('content-type')?.includes('application/json')) {
      try {
        await req.json();
      } catch {
        throw validationError('Invalid JSON body');
      }
    }
    const lead = await new PrismaLeadRepository(prisma).get(auth.tenantId, id);
    if (!lead?.company.domain) throw notFound('Lead/company/domain not found');
    const jobs = new PrismaJobRunRepository(prisma);
    const url = `https://${lead.company.domain}`;
    const job = await jobs.create(auth.tenantId, 'website_check', {
      leadId: id,
      companyId: lead.companyId,
      url,
    });
    try {
      await enqueueWebsiteCheck({
        jobId: job.id,
        tenantId: auth.tenantId,
        companyId: lead.companyId,
        url,
      });
    } catch (error) {
      await jobs.update(auth.tenantId, job.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Failed to enqueue website check',
        finishedAt: new Date(),
      });
      throw providerError('Failed to start website check');
    }
    return NextResponse.json({ id: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
