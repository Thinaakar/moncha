import Link from 'next/link';
import { PageHeader } from '@/components/page-header';
import { AddLeadForm } from './add-lead-form';

export default function AddLeadPage() {
  return (
    <main>
      <PageHeader
        title="Add lead"
        description="Secondary fallback. Same normalize + domain dedupe rules as Discover."
        action={
          <Link href="/discover" className="btn btn-secondary">
            Prefer Discover
          </Link>
        }
      />
      <AddLeadForm />
    </main>
  );
}
