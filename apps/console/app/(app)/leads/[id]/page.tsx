import type { Metadata } from 'next';
import { LeadDetailView } from './lead-detail-view';

export const metadata: Metadata = { title: 'Lead' };

export default async function LeadDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetailView id={id} />;
}
