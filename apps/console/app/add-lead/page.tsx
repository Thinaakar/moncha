import Link from 'next/link';
import { AddLeadForm } from './add-lead-form';

export default function AddLeadPage() {
  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Add lead</h1>
          <p>Secondary fallback. Same normalize + domain dedupe rules as Discover.</p>
        </div>
        <Link href="/discover" className="btn">
          Prefer Discover
        </Link>
      </div>

      <div className="card">
        <AddLeadForm />
      </div>
    </main>
  );
}
