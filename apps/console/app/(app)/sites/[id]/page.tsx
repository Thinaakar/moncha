import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SiteSnapshotView } from './site-snapshot-view';

export const metadata: Metadata = { title: 'Website copy' };

export default async function SiteSnapshotPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Suspense>
      <SiteSnapshotView id={id} />
    </Suspense>
  );
}
