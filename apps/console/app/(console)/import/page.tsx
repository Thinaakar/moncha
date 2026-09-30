import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { ImportForm } from './import-form';

export default function ImportPage() {
  return (
    <main>
      <PageHeader
        title="Import CSV"
        description="Secondary fallback only. Prefer Discover for new company lists."
        action={
          <Link href="/discover" className="btn btn-secondary">
            Prefer Discover
          </Link>
        }
      />

      <div className="card">
        <p className="muted card-intro">
          Columns: <code>name</code>, <code>domain</code>/<code>website</code>, <code>country</code>,{' '}
          <code>city</code>, <code>phone</code>, <code>address</code>.
        </p>
        <ImportForm />
      </div>
    </main>
  );
}
