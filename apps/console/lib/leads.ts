import type { LeadRow } from '@/components/leads-table';
import { findDummyLead, type DummyLead } from './dummy-leads';
import { formatStatus, sourceLabel, websiteLabel } from './ui';

export type TimelineEntry = { label: string; when: string | null };

export type LeadDetail = {
  id: string;
  name: string;
  domain: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  country: string | null;
  queue: string;
  verdict: string | null;
  vendor: string | null;
  website: {
    status: string;
    url: string | null;
    httpStatus: number | null;
    title: string | null;
    checkedAt: string | null;
  };
  created: string;
  timeline: TimelineEntry[];
  live: boolean;
};

export function dummyRow(lead: DummyLead): LeadRow {
  return {
    id: lead.id,
    name: lead.name,
    domain: lead.domain,
    city: lead.city,
    country: lead.country,
    queue: lead.queue,
    website: websiteLabel(lead.websiteStatus, Boolean(lead.domain || lead.websiteStatus)),
    created: lead.createdAt,
  };
}

function dummyDetail(id: string): LeadDetail | null {
  const lead = findDummyLead(id);
  if (!lead) return null;
  const status = websiteLabel(lead.websiteStatus, Boolean(lead.domain || lead.websiteStatus));
  const checked = status !== 'UNCHECKED' && status !== 'MISSING';
  const timeline: TimelineEntry[] = [{ label: `Found via ${sourceLabel(lead.source)}`, when: lead.createdAt }];
  if (checked) timeline.push({ label: `Website checked: ${formatStatus(status)}`, when: lead.createdAt });
  timeline.push({ label: `Now in ${formatStatus(lead.queue)}`, when: null });

  return {
    id: lead.id,
    name: lead.name,
    domain: lead.domain,
    phone: lead.phone,
    address: lead.address,
    city: lead.city,
    country: lead.country,
    queue: lead.queue,
    verdict: null,
    vendor: null,
    website: {
      status,
      url: lead.domain ? `https://${lead.domain}` : null,
      httpStatus: null,
      title: null,
      checkedAt: checked ? lead.createdAt : null,
    },
    created: lead.createdAt,
    timeline,
    live: false,
  };
}

export async function loadLeadDetail(id: string, auth: { tenantId: string } | null): Promise<LeadDetail | null> {
  if (!auth || !process.env.DATABASE_URL) return dummyDetail(id);

  const { prisma } = await import('@moncha/db');
  const lead = await prisma.lead.findFirst({
    where: { id, tenantId: auth.tenantId },
    include: { company: { include: { website: true, sourceRecords: true } } },
  });
  if (!lead) return null;

  const { company } = lead;
  const website = company.website;
  const status = websiteLabel(website?.status, Boolean(website));

  const events = [
    ...company.sourceRecords.map((source) => ({
      label: `Found via ${sourceLabel(source.source)}`,
      at: source.createdAt,
    })),
    { label: 'Added to leads', at: lead.createdAt },
  ];
  if (website?.lastCheckedAt) {
    events.push({ label: `Website checked: ${formatStatus(status)}`, at: website.lastCheckedAt });
  }
  events.sort((a, b) => a.at.getTime() - b.at.getTime());

  return {
    id: lead.id,
    name: company.name,
    domain: company.domain,
    phone: company.phone,
    address: company.address,
    city: company.city,
    country: company.country,
    queue: lead.queue,
    verdict: lead.assistantVerdict,
    vendor: lead.assistantVendor,
    website: {
      status,
      url: website ? website.finalUrl || website.url : null,
      httpStatus: website?.httpStatus ?? null,
      title: website?.title ?? null,
      checkedAt: website?.lastCheckedAt?.toLocaleString() ?? null,
    },
    created: lead.createdAt.toLocaleString(),
    timeline: [
      ...events.map((event) => ({ label: event.label, when: event.at.toLocaleString() })),
      { label: `Now in ${formatStatus(lead.queue)}`, when: null },
    ],
    live: true,
  };
}
