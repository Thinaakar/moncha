import { describe, expect, it } from 'vitest';
import { csvCell, leadCsvChunks, leadExportFilename, type LeadExportRow } from './leadExport';

const lead = (overrides: Partial<LeadExportRow> = {}): LeadExportRow => ({
  id: 'lead_1',
  queue: 'QUALIFIED',
  assistantVerdict: 'NO_ASSISTANT',
  assistantVendor: null,
  qualificationReason: 'no_assistant_high_confidence',
  createdAt: new Date('2026-10-11T09:00:00Z'),
  company: {
    name: 'AIO Motors',
    domain: 'aiomotors.sg',
    phone: '+65 6789 1234',
    email: 'hello@aiomotors.sg',
    address: '1 Woodlands Ave, #01-02',
    city: 'Woodlands',
    country: 'Singapore',
    website: { url: 'https://aiomotors.sg', finalUrl: 'https://www.aiomotors.sg/', status: 'ACTIVE' },
    sourceRecords: [{ source: 'google_places' }],
  },
  ...overrides,
});

async function csvOf(batches: LeadExportRow[][]) {
  async function* source() {
    yield* batches;
  }
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true });
  let text = '';
  for await (const chunk of leadCsvChunks(source())) text += decoder.decode(chunk, { stream: true });
  return text;
}

describe('lead CSV export', () => {
  it('writes a BOM, the header and one line per lead across batches', async () => {
    const text = await csvOf([[lead()], [], [lead({ id: 'lead_2', queue: 'HAS_ASSISTANT', assistantVerdict: null })]]);
    expect(text.startsWith('\uFEFFCompany,Domain,Website,')).toBe(true);
    const lines = text.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe(
      'AIO Motors,aiomotors.sg,https://www.aiomotors.sg/,+65 6789 1234,hello@aiomotors.sg,"1 Woodlands Ave, #01-02",Woodlands,Singapore,' +
        'Qualified,No assistant,,Active,Google places,No assistant high confidence,2026-10-11T09:00:00.000Z,lead_1',
    );
    expect(lines[2]).toContain(',Has assistant,Not audited,');
  });

  it('falls back to the domain and marks hand-added leads as manual', async () => {
    const text = await csvOf([[lead({ company: { ...lead().company, website: null, sourceRecords: [] } })]]);
    expect(text).toContain(',https://aiomotors.sg,');
    expect(text).toContain(',Unchecked,Manual,');
  });

  it('quotes commas, quotes and newlines, and defuses formulas but not phone numbers', () => {
    expect(csvCell('Tan "Best" Clinic')).toBe('"Tan ""Best"" Clinic"');
    expect(csvCell('line 1\nline 2')).toBe('"line 1\nline 2"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('+65 6789 1234')).toBe('+65 6789 1234');
    expect(csvCell(null)).toBe('');
  });

  it('names the file after the queue and the day', () => {
    const now = new Date('2026-10-12T10:00:00Z');
    expect(leadExportFilename('QUALIFIED', now)).toBe('moncha-leads-qualified-2026-10-12.csv');
    expect(leadExportFilename('PENDING_AUDIT', now)).toBe('moncha-leads-pending-audit-2026-10-12.csv');
    expect(leadExportFilename(undefined, now)).toBe('moncha-leads-all-2026-10-12.csv');
  });
});
