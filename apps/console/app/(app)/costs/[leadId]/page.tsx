import type { Metadata } from 'next';
import { Suspense } from 'react';
import { WebsiteCostView } from './website-cost-view';

export const metadata: Metadata = { title: 'Website cost' };

export default async function WebsiteCostPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  return (
    <Suspense>
      <WebsiteCostView leadId={leadId} />
    </Suspense>
  );
}
