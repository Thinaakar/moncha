import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DiscoveryView } from './discovery-view';

export const metadata: Metadata = { title: 'Country crawl' };

export default function DiscoveryPage() {
  return (
    <Suspense>
      <DiscoveryView />
    </Suspense>
  );
}
