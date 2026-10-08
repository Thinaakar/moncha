import type { Metadata } from 'next';
import { Suspense } from 'react';
import { SitesView } from './sites-view';

export const metadata: Metadata = { title: 'Website copies' };

export default function SitesPage() {
  return (
    <Suspense>
      <SitesView />
    </Suspense>
  );
}
