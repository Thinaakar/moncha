import Link from 'next/link';
import { notFound } from 'next/navigation';
import { LeadChips, LeadDetailBody } from '@/components/lead-detail';
import { PageHeader } from '@/components/page-header';
import { getServerAuth } from '@/lib/auth';
import { loadLeadDetail } from '@/lib/leads';

export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const lead = await loadLeadDetail(id, await getServerAuth());
  if (!lead) notFound();

  return (
    <main>
      <PageHeader
        back={{ href: '/leads?queue=ALL', label: 'Leads' }}
        title={lead.name}
        description={<LeadChips lead={lead} />}
        action={
          <Link href="/discover" className="btn btn-secondary">
            Discover more
          </Link>
        }
      />
      <LeadDetailBody lead={lead} variant="page" />
    </main>
  );
}
