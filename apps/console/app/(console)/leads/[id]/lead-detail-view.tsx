'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { LeadChips, LeadDetailBody } from '@/components/lead-detail';
import { PageHeader } from '@/components/page-header';
import type { LeadDetail, TimelineEntry } from '@/lib/leads';
import { formatStatus, websiteLabel } from '@/lib/ui';

type ApiLead = {
  id: string;
  queue: string;
  assistantVerdict?: string | null;
  assistantVendor?: string | null;
  createdAt: string;
  company?: {
    name?: string;
    domain?: string | null;
    phone?: string | null;
    address?: string | null;
    city?: string | null;
    country?: string | null;
    website?: {
      status?: string;
      finalUrl?: string | null;
      url?: string | null;
      httpStatus?: number | null;
      title?: string | null;
      lastCheckedAt?: string | null;
    } | null;
    sourceRecords?: { source?: string }[];
  };
};

function mapDetail(value: ApiLead): LeadDetail {
  const company = value.company || {};
  const website = company.website;
  const status = websiteLabel(website?.status, Boolean(website));
  const timeline: TimelineEntry[] = (company.sourceRecords || []).map((record) => ({
    label: `Found via ${record.source || 'discovery'}`,
    when: null,
  }));
  timeline.push({ label: 'Added to leads', when: new Date(value.createdAt).toLocaleString() });
  if (website?.lastCheckedAt) timeline.push({ label: `Website checked: ${formatStatus(status)}`, when: new Date(website.lastCheckedAt).toLocaleString() });
  timeline.push({ label: `Now in ${formatStatus(value.queue)}`, when: null });

  return {
    id: value.id,
    name: company.name || 'Lead details',
    domain: company.domain ?? null,
    phone: company.phone ?? null,
    address: company.address ?? null,
    city: company.city ?? null,
    country: company.country ?? null,
    queue: value.queue,
    verdict: value.assistantVerdict ?? null,
    vendor: value.assistantVendor ?? null,
    website: {
      status,
      url: website?.finalUrl || website?.url || null,
      httpStatus: website?.httpStatus ?? null,
      title: website?.title ?? null,
      checkedAt: website?.lastCheckedAt ? new Date(website.lastCheckedAt).toLocaleString() : null,
    },
    created: new Date(value.createdAt).toLocaleString(),
    timeline,
    live: true,
  };
}

export function LeadDetailView({ id }: { id: string }) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/leads/${encodeURIComponent(id)}`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || 'Could not load this lead');
        if (!cancelled) setLead(mapDetail(data as ApiLead));
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load this lead');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <main><p className="muted">Loading lead…</p></main>;
  if (error || !lead) {
    return <main><PageHeader back={{ href: '/leads', label: 'Leads' }} title="Lead unavailable" description={error || 'Lead not found'} />
      <Link href="/leads" className="btn btn-secondary">Back to leads</Link>
    </main>;
  }

  return (
    <main>
      <PageHeader
        back={{ href: '/leads', label: 'Leads' }}
        title={lead.name}
        description={<LeadChips lead={lead} />}
        action={<Link href="/discover" className="btn btn-secondary">Discover more</Link>}
      />
      <LeadDetailBody lead={lead} variant="page" />
    </main>
  );
}
