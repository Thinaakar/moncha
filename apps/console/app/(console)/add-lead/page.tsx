import Link from 'next/link';
import { Icon } from '@/components/icon';
import { PageHeader } from '@/components/page-header';
import { AddLeadForm } from './add-lead-form';

export default function AddLeadPage() {
  return (
    <main>
      <PageHeader
        title="Add lead"
        description="Add one company by hand. MonCha checks its website automatically."
        action={
          <Link href="/discover" className="btn btn-secondary">
            <Icon name="discover" size={16} />
            Use Discover →
          </Link>
        }
      />
      <AddLeadForm />
    </main>
  );
}
