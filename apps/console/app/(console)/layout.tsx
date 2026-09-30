import type { ReactNode } from 'react';
import { getServerAuth } from '@/lib/auth';
import { DUMMY_LEADS } from '@/lib/dummy-leads';
import { Sidebar } from '../nav-bar';

async function sidebarData() {
  const auth = await getServerAuth();
  if (!auth || !process.env.DATABASE_URL) {
    return {
      demo: true,
      qualifiedCount: DUMMY_LEADS.filter((lead) => lead.queue === 'QUALIFIED').length,
    };
  }
  try {
    const { prisma } = await import('@moncha/db');
    const qualifiedCount = await prisma.lead.count({ where: { tenantId: auth.tenantId, queue: 'QUALIFIED' } });
    return { demo: false, qualifiedCount };
  } catch {
    return { demo: false, qualifiedCount: null };
  }
}

export default async function ConsoleLayout({ children }: { children: ReactNode }) {
  const { demo, qualifiedCount } = await sidebarData();

  return (
    <div className="app">
      <Sidebar qualifiedCount={qualifiedCount} demo={demo} />
      <div className="main">
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
