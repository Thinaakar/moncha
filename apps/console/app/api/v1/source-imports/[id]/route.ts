import { NextResponse } from 'next/server';
import { prisma, PrismaJobRunRepository } from '@moncha/db';
import { authFromRequest } from '@/lib/auth';
import { jsonError } from '@/lib/errors';
import { notFound } from '@/lib/api-error';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = authFromRequest(req);
    const { id } = await params;
    const job = await new PrismaJobRunRepository(prisma).get(auth.tenantId, id);
    if (!job) throw notFound('Job not found');
    const result = (job.resultJson ?? null) as Record<string, unknown> | null;
    const input = (job.inputJson ?? null) as { source?: string } | null;
    return NextResponse.json({
      id: job.id,
      status: job.status,
      source: input?.source ?? (job.type === 'csv_import' ? 'csv' : 'google_places'),
      type: job.type,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      createdAt: job.createdAt,
      result,
      recordsDiscovered: result?.found ?? null,
      recordsImported: result?.created ?? null,
      error: job.error,
    });
  } catch (error) {
    return jsonError(error);
  }
}
