import type { Metadata } from 'next';
import { Suspense } from 'react';
import { ImportsView } from './imports-view';

export const metadata: Metadata = { title: 'CSV import' };

export default function ImportsPage() {
  return (
    <Suspense>
      <ImportsView />
    </Suspense>
  );
}
