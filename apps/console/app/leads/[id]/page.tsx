import { notFound } from 'next/navigation';
import { prisma } from '@moncha/db';
import { getServerAuth } from '@/lib/auth';

export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const auth = await getServerAuth();
  if (!auth) notFound();
  const { id } = await params;
  const lead = await prisma.lead.findFirst({
    where: { id, tenantId: auth.tenantId },
    include: { company: { include: { website: true, sourceRecords: true } } },
  });
  if (!lead) return notFound();

  return (
    <main>
      <h1>{lead.company.name}</h1>
      <div className="card">
        <p>
          <b>Domain:</b> {lead.company.domain || '—'}
        </p>
        <p>
          <b>Location:</b> {lead.company.city || '—'}, {lead.company.country || '—'}
        </p>
        <p>
          <b>Status:</b> {lead.status}
        </p>
        <p>
          <b>Website:</b>{' '}
          {lead.company.website
            ? `${lead.company.website.reachable ? 'reachable' : 'unreachable'} — ${lead.company.website.finalUrl || lead.company.website.url}`
            : 'Not checked'}
        </p>
        <p>
          <b>Created:</b> {lead.createdAt.toISOString()}
        </p>
        <h3>Source provenance</h3>
        {lead.company.sourceRecords.map((s) => (
          <div key={s.id}>
            {s.source} / {s.externalId || '—'} / {s.createdAt.toISOString()}
          </div>
        ))}
      </div>
    </main>
  );
}
