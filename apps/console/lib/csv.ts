/** Mirrors the backend's header aliases (packages/domain importCsvRecords.parseCsv). */
export const CSV_COLUMNS = [
  { key: 'name', label: 'Name', aliases: ['name', 'company', 'company_name'], required: true },
  { key: 'domain', label: 'Website', aliases: ['domain', 'website', 'url', 'website_url'], required: true },
  { key: 'country', label: 'Country', aliases: ['country'], required: false },
  { key: 'city', label: 'City', aliases: ['city'], required: false },
  { key: 'phone', label: 'Phone', aliases: ['phone', 'telephone'], required: false },
  { key: 'address', label: 'Address', aliases: ['address'], required: false },
] as const;

export const CSV_MAX_ROWS = 20_000;
export const CSV_INLINE_MAX_ROWS = 1_000;
export const CSV_MAX_BYTES = 9_500_000;

export function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  const pushRow = () => {
    row.push(cell);
    if (row.some((v) => v.trim())) rows.push(row);
    row = [];
    cell = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else cell += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else cell += ch;
  }
  if (cell || row.length) pushRow();
  return rows;
}

export type CsvAnalysis = {
  header: string[];
  mapping: Record<(typeof CSV_COLUMNS)[number]['key'], number>;
  rows: string[][];
  importable: number;
  missingWebsite: number;
  missingRequired: string[];
};

export function analyzeCsv(text: string): CsvAnalysis {
  const all = splitCsv(text.replace(/^\uFEFF/, ''));
  const header = (all[0] ?? []).map((h) => h.trim());
  const lower = header.map((h) => h.toLowerCase());
  const mapping = Object.fromEntries(
    CSV_COLUMNS.map((c) => [c.key, lower.findIndex((h) => (c.aliases as readonly string[]).includes(h))]),
  ) as CsvAnalysis['mapping'];
  const rows = all.slice(1);
  let importable = 0;
  let missingWebsite = 0;
  for (const row of rows) {
    const name = mapping.name >= 0 ? row[mapping.name]?.trim() : '';
    if (!name) continue;
    const site = mapping.domain >= 0 ? row[mapping.domain]?.trim() : '';
    if (site) importable++;
    else missingWebsite++;
  }
  const missingRequired = CSV_COLUMNS.filter((c) => c.required && mapping[c.key] < 0).map((c) => c.label);
  return { header, mapping, rows, importable, missingWebsite, missingRequired };
}

export const CSV_TEMPLATE =
  'name,website,country,city,phone,address\n' +
  'Orchard Dental Surgery,orcharddental.com.sg,Singapore,Orchard,+65 6235 9999,304 Orchard Road #05-01\n' +
  'Bangsar Physio,bangsarphysio.my,Malaysia,Kuala Lumpur,+60 3-2282 1234,12 Jalan Telawi\n';
