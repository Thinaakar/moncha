import Link from 'next/link';
import { Icon } from '@/components/icon';
import { PageHeader } from '@/components/page-header';
import { ImportForm } from './import-form';

export default function ImportPage() {
  return (
    <main>
      <PageHeader
        title="Import CSV"
        description="Add companies from a spreadsheet. Discover is still the main way."
        action={
          <Link href="/discover" className="btn btn-secondary">
            <Icon name="discover" size={16} />
            Use Discover →
          </Link>
        }
      />

      <ImportForm />
    </main>
  );
}
