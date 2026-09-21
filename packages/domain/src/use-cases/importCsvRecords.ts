import type { CompanyRecord, CompanyRepo, LeadRepo, Logger } from '../ports';
import { ingestDiscoveredRecord } from './ingestDiscoveredRecord';

export type CsvRecordInput = {
  name?: string;
  domain?: string;
  website?: string;
  country?: string;
  city?: string;
  phone?: string;
  address?: string;
};

export type ImportCsvResult = {
  found: number;
  created: number;
  duplicates: number;
  skipped: number;
  companies: CompanyRecord[];
};

export function parseCsv(text: string): CsvRecordInput[] {
  const rows = splitCsv(text);
  if (rows.length < 2) return [];
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];
  const index = (aliases: string[]) => header.findIndex((cell) => aliases.includes(cell));
  const nameIdx = index(['name', 'company', 'company_name']);
  const domainIdx = index(['domain', 'website', 'url', 'website_url']);
  const countryIdx = index(['country']);
  const cityIdx = index(['city']);
  const phoneIdx = index(['phone', 'telephone']);
  const addressIdx = index(['address']);

  return rows.slice(1).flatMap((row) => {
    const name = nameIdx >= 0 ? row[nameIdx]?.trim() : '';
    if (!name) return [];
    return [
      {
        name,
        domain: domainIdx >= 0 ? row[domainIdx]?.trim() : undefined,
        website: domainIdx >= 0 ? row[domainIdx]?.trim() : undefined,
        country: countryIdx >= 0 ? row[countryIdx]?.trim() : undefined,
        city: cityIdx >= 0 ? row[cityIdx]?.trim() : undefined,
        phone: phoneIdx >= 0 ? row[phoneIdx]?.trim() : undefined,
        address: addressIdx >= 0 ? row[addressIdx]?.trim() : undefined,
      },
    ];
  });
}

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  const pushCell = () => {
    row.push(cell);
    cell = '';
  };
  const pushRow = () => {
    if (row.some((value) => value.trim())) rows.push(row);
    row = [];
  };

  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === ',' && !inQuotes) {
      pushCell();
      continue;
    }
    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      pushCell();
      pushRow();
      continue;
    }
    cell += char;
  }
  if (cell.length || row.length) {
    pushCell();
    pushRow();
  }
  return rows;
}

export async function importCsvRecords(
  deps: { companies: CompanyRepo; leads: LeadRepo; logger?: Logger },
  input: { tenantId: string; records: CsvRecordInput[] },
): Promise<ImportCsvResult> {
  let created = 0;
  let duplicates = 0;
  let skipped = 0;
  const companies: CompanyRecord[] = [];

  for (const record of input.records) {
    const result = await ingestDiscoveredRecord(
      deps,
      {
        tenantId: input.tenantId,
        name: record.name || '',
        domain: record.domain || record.website,
        websiteUrl: record.website || record.domain,
        country: record.country,
        city: record.city,
        phone: record.phone,
        address: record.address,
        source: 'csv',
      },
      { requireDomain: true },
    );
    if (result.skipped) {
      skipped += 1;
      continue;
    }
    companies.push(result.company);
    if (result.created) created += 1;
    if (result.duplicate) duplicates += 1;
  }

  return { found: input.records.length, created, duplicates, skipped, companies };
}
