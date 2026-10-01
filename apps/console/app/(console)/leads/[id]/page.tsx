import { LeadDetailView } from './lead-detail-view';

export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetailView id={id} />;
}
