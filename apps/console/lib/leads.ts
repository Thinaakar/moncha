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

export async function loadLeadDetail(id: string, auth: { tenantId: string } | null): Promise<LeadDetail | null> {
  if (!auth || !process.env.DATABASE_URL) return null;

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
