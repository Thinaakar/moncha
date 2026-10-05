import {
  canonicalDomain,
  DEFAULT_AUDIT_CONFIG,
  normalizeCity,
  normalizeCompanyName,
  normalizeCountry,
  normalizeWebsiteUrl,
  parseCsv,
  utcDay,
  type CsvRecordInput,
  type JobRepo,
  type JobRunRecord,
} from '@moncha/domain';

// Shared by the Cloudflare edge (neon-router.ts), the local API and the worker. Keep it free of
// Node-only and Prisma imports: it talks to Postgres through a @neondatabase/serverless client.

/** Imported during the request; larger files are queued for the worker. */
export const CSV_INLINE_MAX_ROWS = 1000;
export const CSV_MAX_ROWS = 20_000;
/** Rows per lookup + transaction; keeps the edge far below its 50 subrequests per request. */
const CHUNK_ROWS = 1000;

export type CsvSqlClient = {
  query: (text: string, params?: unknown[]) => any;
  transaction: (queries: any[]) => Promise<any[]>;
};

export type CsvImportResult = {
  found: number;
  created: number;
  duplicates: number;
  skipped: number;
  auditsEnqueued: number;
  noWebsite: number;
};

export class CsvImportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CsvImportError';
  }
}

type PreparedRow = {
  name: string;
  domain: string;
  websiteUrl: string;
  country: string | null;
  city: string | null;
  phone: string | null;
  address: string | null;
};

/** Same normalization as ingestDiscoveredRecord; rows without a name or website are skipped. */
export function prepareCsvRows(records: CsvRecordInput[]) {
  const rows: PreparedRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let inFileDuplicates = 0;
  for (const record of records) {
    const name = normalizeCompanyName(record.name || '');
    const domain = canonicalDomain(record.domain || record.website);
    const websiteUrl = normalizeWebsiteUrl(record.website || record.domain);
    if (!name || !domain || !websiteUrl) {
      skipped += 1;
      continue;
    }
    if (seen.has(domain)) {
      inFileDuplicates += 1;
      continue;
    }
    seen.add(domain);
    rows.push({
      name,
      domain,
      websiteUrl,
      country: normalizeCountry(record.country) ?? null,
      city: normalizeCity(record.city) ?? null,
      phone: record.phone?.trim() || null,
      address: record.address?.trim() || null,
    });
  }
  return { rows, skipped, inFileDuplicates };
}

const INPUT = `jsonb_to_recordset($2::jsonb) AS r(name text, domain text, "websiteUrl" text, country text, city text, phone text, address text)`;
const COMPANY = `JOIN "Company" c ON c."tenantId" = $1 AND c.domain = r.domain`;
const PENDING_LEAD = `JOIN "Lead" l ON l."tenantId" = $1 AND l."companyId" = c.id AND l.queue = 'PENDING_AUDIT'`;
const newId = (prefix: string) => `'${prefix}_' || replace(gen_random_uuid()::text, '-', '')`;

async function importChunk(
  sql: CsvSqlClient,
  tenantId: string,
  rows: PreparedRow[],
  classifierVersion: string,
  day: string,
) {
  const json = JSON.stringify(rows);
  const domains = rows.map((r) => r.domain);
  const existingRows: Array<{ domain: string }> = await sql.query(
    'SELECT domain FROM "Company" WHERE "tenantId" = $1 AND domain = ANY($2::text[])',
    [tenantId, domains],
  );
  const existing = existingRows.map((r) => r.domain);

  const results = await sql.transaction([
    // Existing companies keep their values; CSV only fills blanks (like ingestDiscoveredRecord).
    sql.query(
      `INSERT INTO "Company" (id, "tenantId", name, domain, country, city, phone, address, "createdAt", "updatedAt")
       SELECT ${newId('comp')}, $1, r.name, r.domain, r.country, r.city, r.phone, r.address, NOW(), NOW() FROM ${INPUT}
       ON CONFLICT ("tenantId", domain) DO UPDATE SET
         country = COALESCE("Company".country, EXCLUDED.country),
         city = COALESCE("Company".city, EXCLUDED.city),
         phone = COALESCE("Company".phone, EXCLUDED.phone),
         address = COALESCE("Company".address, EXCLUDED.address),
         "updatedAt" = NOW()`,
      [tenantId, json],
    ),
    sql.query(
      `INSERT INTO "SourceRecord" (id, "tenantId", "companyId", source, "createdAt")
       SELECT ${newId('src')}, $1, c.id, 'csv', NOW() FROM ${INPUT} ${COMPANY}
       WHERE NOT (r.domain = ANY($3::text[]))`,
      [tenantId, json, existing],
    ),
    sql.query(
      `INSERT INTO "Lead" (id, "tenantId", "companyId", queue, "qualificationReason", version, "createdAt", "updatedAt")
       SELECT ${newId('lead')}, $1, c.id, 'PENDING_AUDIT'::"LeadQueue", 'pending_audit', 1, NOW(), NOW()
       FROM ${INPUT} ${COMPANY}
       ON CONFLICT ("tenantId", "companyId") DO NOTHING`,
      [tenantId, json],
    ),
    sql.query(
      `INSERT INTO "Website" (id, "tenantId", "companyId", url, status)
       SELECT ${newId('web')}, $1, c.id, r."websiteUrl", 'UNCHECKED'::"WebsiteStatus" FROM ${INPUT} ${COMPANY} ${PENDING_LEAD}
       ON CONFLICT ("companyId") DO UPDATE SET url = EXCLUDED.url, status = 'UNCHECKED'::"WebsiteStatus"`,
      [tenantId, json],
    ),
    // Same dedupe key as ingestDiscoveredRecord: one audit per lead per classifier version per day.
    sql.query(
      `INSERT INTO "JobRun" (id, "tenantId", type, status, payload, "dedupeKey", "maxAttempts", attempts, "runAfter", "createdAt")
       SELECT ${newId('job')}, $1, 'website_audit'::"JobType", 'pending'::"JobStatus",
              jsonb_build_object('leadId', l.id, 'companyId', c.id, 'url', r."websiteUrl"),
              l.id || ':' || $3::text || ':' || $4::text, 3, 0, NOW(), NOW()
       FROM ${INPUT} ${COMPANY} ${PENDING_LEAD}
       ON CONFLICT ("tenantId", "dedupeKey") DO NOTHING
       RETURNING id`,
      [tenantId, json, classifierVersion, day],
    ),
    sql.query(
      `SELECT count(*)::int AS n FROM ${INPUT} ${COMPANY}
       JOIN "Lead" l ON l."tenantId" = $1 AND l."companyId" = c.id AND l.queue = 'NO_WEBSITE'`,
      [tenantId, json],
    ),
  ]);

  return {
    created: rows.length - existing.length,
    existing: existing.length,
    auditsEnqueued: (results[4] as unknown[]).length,
    noWebsite: Number((results[5] as Array<{ n: number }>)[0]?.n ?? 0),
  };
}

/** Set-based CSV import: per 1,000 rows one lookup plus one transaction, whatever the row count. */
export async function importCsvBulk(
  sql: CsvSqlClient,
  input: { tenantId: string; records: CsvRecordInput[]; classifierVersion?: string; day?: string },
): Promise<CsvImportResult> {
  const { rows, skipped, inFileDuplicates } = prepareCsvRows(input.records);
  const result: CsvImportResult = {
    found: input.records.length,
    created: 0,
    duplicates: inFileDuplicates,
    skipped,
    auditsEnqueued: 0,
    noWebsite: 0,
  };
  const classifierVersion = input.classifierVersion ?? DEFAULT_AUDIT_CONFIG.classifierVersion;
  const day = input.day ?? utcDay();
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const chunk = await importChunk(sql, input.tenantId, rows.slice(i, i + CHUNK_ROWS), classifierVersion, day);
    result.created += chunk.created;
    result.duplicates += chunk.existing;
    result.auditsEnqueued += chunk.auditsEnqueued;
    result.noWebsite += chunk.noWebsite;
  }
  return result;
}

export function csvRecordsFrom(input: { csv?: string; records?: CsvRecordInput[] }): CsvRecordInput[] {
  const records = input.records?.length ? input.records : parseCsv(input.csv ?? '');
  if (!records.length) {
    throw new CsvImportError(
      400,
      'validation_error',
      'No rows found. The CSV needs a header row with a "name" column and a "website" or "domain" column.',
    );
  }
  if (records.length > CSV_MAX_ROWS) {
    throw new CsvImportError(413, 'too_many_rows', `CSV has ${records.length} rows; the limit is ${CSV_MAX_ROWS}.`);
  }
  return records;
}

export type StartedCsvImport = {
  id: string;
  status: JobRunRecord['status'];
  mode: 'inline' | 'queued';
  rows: number;
  result?: CsvImportResult;
};

/** Small files are imported now; large ones become a queued csv_import job for the worker. */
export async function startCsvImport(
  deps: { sql: CsvSqlClient; jobs: JobRepo },
  input: { tenantId: string; csv?: string; records?: CsvRecordInput[] },
): Promise<StartedCsvImport> {
  const records = csvRecordsFrom(input);
  if (records.length > CSV_INLINE_MAX_ROWS) {
    const job = await deps.jobs.create({
      tenantId: input.tenantId,
      type: 'csv_import',
      payload: { source: 'csv', mode: 'queued', rows: records.length, records },
    });
    return { id: job.id, status: job.status, mode: 'queued', rows: records.length };
  }

  const job = await deps.jobs.create({
    tenantId: input.tenantId,
    type: 'csv_import',
    status: 'running',
    payload: { source: 'csv', mode: 'inline', rows: records.length },
  });
  try {
    const result = await importCsvBulk(deps.sql, { tenantId: input.tenantId, records });
    await deps.jobs.update(input.tenantId, job.id, { status: 'done', result, finishedAt: new Date(), lastError: null });
    return { id: job.id, status: 'done', mode: 'inline', rows: records.length, result };
  } catch (error) {
    await deps.jobs.update(input.tenantId, job.id, {
      status: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
      finishedAt: new Date(),
    });
    throw error;
  }
}

/** Worker side of a queued import (job already claimed as running). */
export async function runQueuedCsvImport(deps: { sql: CsvSqlClient; jobs: JobRepo }, job: JobRunRecord) {
  const payload = (job.payload ?? {}) as { records?: CsvRecordInput[] };
  try {
    const result = await importCsvBulk(deps.sql, { tenantId: job.tenantId, records: payload.records ?? [] });
    await deps.jobs.update(job.tenantId, job.id, {
      status: 'done',
      result,
      finishedAt: new Date(),
      lastError: null,
      lockedAt: null,
      lockedBy: null,
    });
    return result;
  } catch (error) {
    await deps.jobs.update(job.tenantId, job.id, {
      status: 'failed',
      lastError: error instanceof Error ? error.message : String(error),
      finishedAt: new Date(),
      lockedAt: null,
      lockedBy: null,
    });
    throw error;
  }
}

/** GET /api/v1/source-imports/:id body; same shape the console route returned. */
export function sourceImportView(job: JobRunRecord) {
  const result = (job.result ?? null) as Record<string, unknown> | null;
  const payload = (job.payload ?? null) as { source?: string; mode?: string; rows?: number } | null;
  return {
    id: job.id,
    status: job.status,
    source: payload?.source ?? (job.type === 'csv_import' ? 'csv' : 'google_places'),
    type: job.type,
    mode: payload?.mode ?? null,
    rows: payload?.rows ?? null,
    startedAt: job.startedAt ?? null,
    finishedAt: job.finishedAt ?? null,
    createdAt: job.createdAt ?? null,
    result,
    recordsDiscovered: result?.found ?? null,
    recordsImported: result?.created ?? null,
    error: job.lastError ?? null,
  };
}

export const SOURCE_IMPORT_JOB_TYPES: ReadonlyArray<JobRunRecord['type']> = ['csv_import', 'places_discovery'];
