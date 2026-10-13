import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CostsView } from './costs-view';

export const metadata: Metadata = { title: 'Costs' };

export default function CostsPage() {
  return (
    <Suspense>
      <CostsView />
    </Suspense>
  );
}
