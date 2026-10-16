/** One lead as the CSV export needs it: only the columns it writes. */
export type LeadExportRow = {
  id: string;
  queue: string;
  assistantVerdict: string | null;
  assistantVendor: string | null;
  qualificationReason: string | null;
  createdAt: Date;
  company: {
    name: string;
    domain: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    website: { url: string; finalUrl: string | null; status: string } | null;
    sourceRecords: Array<{ source: string }>;
  };
};

export const LEAD_EXPORT_BATCH = 1000;

export const LEAD_EXPORT_COLUMNS = [
  'Company',
  'Domain',
  'Website',
  'Phone',
  'Email',
  'Address',
  'City',
  'Country',
  'Queue',
  'Assistant',
  'Assistant vendor',
  'Website status',
  'Source',
  'Reason',
  'Added',
  'Lead ID',
] as const;

const humanize = (value: string | null | undefined) => {
  if (!value) return '';
  const text = value.replace(/_/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
};

const PHONE_LIKE = /^[+-]?[\d\s().-]+$/;

/**
 * Quotes a value for CSV. Text that a spreadsheet would run as a formula (starting with = + - @) gets a
 * leading apostrophe, except plain phone numbers like "+65 6789 1234".
 */
export function csvCell(value: string | null | undefined): string {
  let text = value ?? '';
  if (/^[=+\-@\t\r]/.test(text) && !PHONE_LIKE.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function leadExportValues(lead: LeadExportRow): string[] {
  const { company } = lead;
  const website = company.website?.finalUrl || company.website?.url || (company.domain ? `https://${company.domain}` : '');
  return [
    company.name,
    company.domain ?? '',
    website,
    company.phone ?? '',
    company.email ?? '',
    company.address ?? '',
    company.city ?? '',
    company.country ?? '',
    humanize(lead.queue),
    lead.assistantVerdict ? humanize(lead.assistantVerdict) : 'Not audited',
    lead.assistantVendor ?? '',
    humanize(company.website?.status ?? (company.domain ? 'UNCHECKED' : null)),
    company.sourceRecords[0] ? humanize(company.sourceRecords[0].source) : 'Manual',
    humanize(lead.qualificationReason),
    lead.createdAt.toISOString(),
    lead.id,
  ];
}

const csvLine = (values: readonly string[]) => `${values.map(csvCell).join(',')}\r\n`;

/** `moncha-leads-qualified-2026-10-12.csv`; `all` when every queue is exported. */
export function leadExportFilename(queue: string | undefined, now: Date): string {
  return `moncha-leads-${(queue ?? 'all').toLowerCase().replace(/_/g, '-')}-${now.toISOString().slice(0, 10)}.csv`;
}

/**
 * The CSV file as UTF-8 chunks, one per batch of leads. Starts with a byte order mark so Excel reads
 * non-Latin company names (Japanese, Chinese) correctly.
 */
export async function* leadCsvChunks(batches: AsyncIterable<LeadExportRow[]>): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  yield encoder.encode(`\uFEFF${csvLine(LEAD_EXPORT_COLUMNS)}`);
  for await (const batch of batches) {
    if (batch.length) yield encoder.encode(batch.map((lead) => csvLine(leadExportValues(lead))).join(''));
  }
}
