import { NextResponse } from 'next/server';
import {
  prisma,
  PrismaJobRunRepository,
  PrismaLeadRepository,
  PrismaWebsiteRepository,
} from '@moncha/db';
import { DEFAULT_AUDIT_CONFIG, websiteAuditDedupeKey } from '@moncha/domain';
import { authFromRequest } from '@/lib/auth';
import { jsonError } from '@/lib/errors';
import { notFound, validationError } from '@/lib/api-error';

/** Upserts Website + enqueues website_audit. Worker claims and runs HTML→Playwright→LLM. */
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

    const url = `https://${lead.company.domain}`;
    await new PrismaWebsiteRepository(prisma).upsert({
      tenantId: auth.tenantId,
      companyId: lead.companyId,
      url,
      status: 'UNCHECKED',
    });

    const jobs = new PrismaJobRunRepository(prisma);
    const findOpen = async () =>
      (await jobs.list(auth.tenantId)).find(
        (j) =>
          j.type === 'website_audit' &&
          (j.payload as { leadId?: string } | null)?.leadId === id &&
          (j.status === 'pending' || j.status === 'running'),
      );

    const open = await findOpen();
    if (open) {
      return NextResponse.json({ id: open.id, status: open.status, deduped: true }, { status: 202 });
    }
    try {
      const job = await jobs.create({
        tenantId: auth.tenantId,
        type: 'website_audit',
        payload: {
          leadId: id,
          companyId: lead.companyId,
          url,
          force: true,
        },
        // Operator re-checks bypass the daily key so a lead can be re-audited more than once a day.
        dedupeKey: `${websiteAuditDedupeKey(id, DEFAULT_AUDIT_CONFIG.classifierVersion)}:manual:${Date.now()}`,
      });
      return NextResponse.json({ id: job.id, status: job.status }, { status: 202 });
    } catch {
      const existing = await findOpen();
      if (existing) {
        return NextResponse.json({ id: existing.id, status: existing.status, deduped: true }, { status: 202 });
      }
      throw validationError('Could not queue website audit');
    }
  } catch (error) {
    return jsonError(error);
  }
}
