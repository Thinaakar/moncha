import Link from 'next/link';
import { ImportForm } from './import-form';

export default function ImportPage() {
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Import CSV</h1>
          <p>Secondary fallback only. Prefer Discover for new company lists.</p>
        </div>
        <Link href="/discover" className="btn">
          Prefer Discover
        </Link>
      </div>

      <div className="card">
        <p className="muted">
          Columns: <code>name</code>, <code>domain</code>/<code>website</code>, <code>country</code>,{' '}
          <code>city</code>, <code>phone</code>, <code>address</code>.
        </p>
        <ImportForm />
      </div>
    </main>
  );
}
