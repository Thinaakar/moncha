import { NextResponse } from 'next/server';
import { sourceImportSchema } from '@moncha/contracts';
import { prisma, PrismaJobRunRepository } from '@moncha/db';
import { authFromRequest } from '@/lib/auth';
import { jsonError } from '@/lib/errors';
import { enqueueCsvImport, enqueuePlacesDiscovery } from '@/lib/enqueue';
import { providerError } from '@/lib/api-error';

export async function POST(req: Request) {
  try {
    const auth = authFromRequest(req);
    const input = sourceImportSchema.parse(await req.json());
    const jobs = new PrismaJobRunRepository(prisma);

    if (input.source === 'csv') {
      const job = await jobs.create(auth.tenantId, 'csv_import', input);
      try {
        await enqueueCsvImport({
          jobId: job.id,
          tenantId: auth.tenantId,
          csv: input.csv,
          records: input.records,
        });
      } catch (error) {
        await jobs.update(auth.tenantId, job.id, {
          status: 'failed',
          error: error instanceof Error ? error.message : 'Failed to enqueue CSV import',
          finishedAt: new Date(),
        });
        throw providerError('Failed to start CSV import job');
      }
      return NextResponse.json({ id: job.id, status: job.status }, { status: 202 });
    }

    const job = await jobs.create(auth.tenantId, 'places_discovery', input);
    try {
      await enqueuePlacesDiscovery({
        jobId: job.id,
        tenantId: auth.tenantId,
        country: input.country,
        city: input.city,
        keyword: input.keyword,
        source: input.source,
      });
    } catch (error) {
      await jobs.update(auth.tenantId, job.id, {
        status: 'failed',
        error: error instanceof Error ? error.message : 'Failed to enqueue discovery',
        finishedAt: new Date(),
      });
      throw providerError('Failed to start discovery job');
    }
    return NextResponse.json({ id: job.id, status: job.status }, { status: 202 });
  } catch (error) {
    return jsonError(error);
  }
}
