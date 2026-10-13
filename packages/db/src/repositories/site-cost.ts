import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  JobStatus,
  ModelPriceRow,
  SiteCostAuditRun,
  SiteCostCopyRun,
  SiteCostDayRow,
  SiteCostFilter,
  SiteCostModelRow,
  SiteCostRepo,
  SiteCostSort,
  SiteCostTotals,
  SiteCostWebsiteRow,
} from '@moncha/domain';
import { clampPage, clampPageSize } from '@moncha/domain';

type WebRow = {
  leadId: string;
  copies: number;
  copy_in: number;
  copy_out: number;
  copy_cost: number;
  copy_est: boolean;
  copy_unpriced: boolean;
  bytes: number;
  first_at: Date;
  last_at: Date;
  audits: number;
  audit_in: number;
  audit_out: number;
  audit_cost: number;
  audit_est: boolean;
  audit_unpriced: boolean;
  company_id: string;
  company_name: string;
  company_domain: string | null;
  snapshot_id: string;
  latest_status: JobStatus;
  worker_status: string | null;
  worker_url: string | null;
  github_repo: string | null;
};

type RunRow = {
  id: string;
  model: string | null;
  tin: number;
  tout: number;
  cost: number | null;
  estimated: boolean;
};

const ORDER: Record<SiteCostSort, Prisma.Sql> = {
  cost: Prisma.raw('(copy_cost + audit_cost) DESC, last_at DESC'),
  tokens: Prisma.raw('(copy_in + copy_out + audit_in + audit_out) DESC, last_at DESC'),
  newest: Prisma.raw('last_at DESC'),
  size: Prisma.raw('bytes DESC, last_at DESC'),
};

/** OpenRouter's charge when stored, otherwise tokens × price; NULL when tokens have no known price. */
const COST = Prisma.raw(
  'CASE WHEN exact IS NOT NULL THEN exact WHEN tin + tout = 0 THEN 0 ELSE tin * input + tout * output END',
);

function mapWeb(row: WebRow): SiteCostWebsiteRow {
  return {
    leadId: row.leadId,
    company: { id: row.company_id, name: row.company_name, domain: row.company_domain },
    copies: row.copies,
    aiAudits: row.audits,
    copyTokens: { input: Number(row.copy_in), output: Number(row.copy_out) },
    auditTokens: { input: Number(row.audit_in), output: Number(row.audit_out) },
    copyCostUsd: Number(row.copy_cost),
    auditCostUsd: Number(row.audit_cost),
    estimated: row.copy_est || row.audit_est,
    unpriced: row.copy_unpriced || row.audit_unpriced,
    storageBytes: Number(row.bytes),
    firstCopyAt: row.first_at,
    lastCopyAt: row.last_at,
    latest: {
      snapshotId: row.snapshot_id,
      status: row.latest_status,
      workerStatus: row.worker_status,
      workerUrl: row.worker_url,
      githubRepo: row.github_repo,
    },
  };
}

const tokensOf = (row: RunRow) => ({ input: Number(row.tin), output: Number(row.tout) });

export class PrismaSiteCostRepository implements SiteCostRepo {
  constructor(private db: PrismaClient) {}

  /**
   * CTEs shared by every cost query. A website is a lead with at least one copy in the window; its audits
   * count whenever they ran, because the audit is what qualified the lead for the copy.
   */
  private base(filter: { tenantId: string; since: Date | null; prices: ModelPriceRow[]; leadId?: string }) {
    const since = filter.since ? Prisma.sql`AND s."createdAt" >= ${filter.since}` : Prisma.empty;
    const lead = filter.leadId ? Prisma.sql`AND s."leadId" = ${filter.leadId}` : Prisma.empty;
    return Prisma.sql`
      price AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(filter.prices)}::jsonb) AS x(model text, input float8, output float8)
      ),
      copy_runs AS (
        SELECT s.id, s."leadId", s."createdAt", s.status::text AS status, s."totalBytes", s.attempts,
               s."llmModel" AS model,
               COALESCE(s."llmPromptTokens", 0)::float8 AS tin,
               COALESCE(s."llmCompletionTokens", 0)::float8 AS tout,
               s."llmCostUsd" AS exact, p.input, p.output
        FROM "SiteSnapshot" s
        LEFT JOIN price p ON p.model = s."llmModel"
        WHERE s."tenantId" = ${filter.tenantId} ${since} ${lead}
      ),
      audit_runs AS (
        SELECT a.id, a."leadId", a."auditedAt", a.method::text AS method, a.verdict::text AS verdict,
               a."llmModel" AS model,
               COALESCE(a."llmPromptTokens", 0)::float8 AS tin,
               COALESCE(a."llmCompletionTokens", 0)::float8 AS tout,
               a."llmCostUsd" AS exact, p.input, p.output
        FROM "WebsiteAudit" a
        LEFT JOIN price p ON p.model = a."llmModel"
        WHERE a."tenantId" = ${filter.tenantId} AND a."llmRan"
          AND a."leadId" IN (SELECT DISTINCT "leadId" FROM copy_runs)
      ),
      copy_costed AS (SELECT *, ${COST} AS cost, (exact IS NULL AND tin + tout > 0) AS estimated FROM copy_runs),
      audit_costed AS (SELECT *, ${COST} AS cost, (exact IS NULL AND tin + tout > 0) AS estimated FROM audit_runs),
      copy_by_lead AS (
        SELECT "leadId", count(*)::int AS copies,
               sum(tin)::float8 AS copy_in, sum(tout)::float8 AS copy_out,
               COALESCE(sum(cost), 0)::float8 AS copy_cost,
               bool_or(estimated) AS copy_est, bool_or(cost IS NULL) AS copy_unpriced,
               sum("totalBytes")::float8 AS bytes, min("createdAt") AS first_at, max("createdAt") AS last_at
        FROM copy_costed GROUP BY "leadId"
      ),
      audit_by_lead AS (
        SELECT "leadId", count(*)::int AS audits,
               sum(tin)::float8 AS audit_in, sum(tout)::float8 AS audit_out,
               COALESCE(sum(cost), 0)::float8 AS audit_cost,
               bool_or(estimated) AS audit_est, bool_or(cost IS NULL) AS audit_unpriced
        FROM audit_costed GROUP BY "leadId"
      ),
      latest AS (
        SELECT DISTINCT ON (s."leadId") s."leadId", s.id AS snapshot_id, s.status::text AS latest_status,
               s."workerStatus" AS worker_status, s."workerUrl" AS worker_url, s."githubRepo" AS github_repo
        FROM "SiteSnapshot" s
        WHERE s."tenantId" = ${filter.tenantId} AND s."leadId" IN (SELECT "leadId" FROM copy_by_lead)
        ORDER BY s."leadId", s."createdAt" DESC
      ),
      web AS (
        SELECT c.*,
               COALESCE(a.audits, 0)::int AS audits,
               COALESCE(a.audit_in, 0)::float8 AS audit_in,
               COALESCE(a.audit_out, 0)::float8 AS audit_out,
               COALESCE(a.audit_cost, 0)::float8 AS audit_cost,
               COALESCE(a.audit_est, false) AS audit_est,
               COALESCE(a.audit_unpriced, false) AS audit_unpriced,
               co.id AS company_id, co.name AS company_name, co.domain AS company_domain,
               lt.snapshot_id, lt.latest_status, lt.worker_status, lt.worker_url, lt.github_repo
        FROM copy_by_lead c
        LEFT JOIN audit_by_lead a USING ("leadId")
        JOIN "Lead" l ON l.id = c."leadId"
        JOIN "Company" co ON co.id = l."companyId"
        JOIN latest lt ON lt."leadId" = c."leadId"
      )`;
  }

  async models(tenantId: string): Promise<string[]> {
    const rows = await this.db.$queryRaw<Array<{ model: string }>>`
      SELECT "llmModel" AS model FROM "SiteSnapshot" WHERE "tenantId" = ${tenantId} AND "llmModel" IS NOT NULL
      UNION
      SELECT "llmModel" AS model FROM "WebsiteAudit" WHERE "tenantId" = ${tenantId} AND "llmModel" IS NOT NULL`;
    return rows.map((r) => r.model);
  }

  async summary(filter: SiteCostFilter) {
    const base = this.base(filter);
    const [totalsRows, modelRows, dayRows] = await Promise.all([
      this.db.$queryRaw<
        Array<{
          websites: number;
          copies: number;
          audits: number;
          copy_in: number;
          copy_out: number;
          audit_in: number;
          audit_out: number;
          copy_cost: number;
          audit_cost: number;
          bytes: number;
        }>
      >`
        WITH ${base}
        SELECT count(*)::int AS websites,
               COALESCE(sum(copies), 0)::int AS copies, COALESCE(sum(audits), 0)::int AS audits,
               COALESCE(sum(copy_in), 0)::float8 AS copy_in, COALESCE(sum(copy_out), 0)::float8 AS copy_out,
               COALESCE(sum(audit_in), 0)::float8 AS audit_in, COALESCE(sum(audit_out), 0)::float8 AS audit_out,
               COALESCE(sum(copy_cost), 0)::float8 AS copy_cost, COALESCE(sum(audit_cost), 0)::float8 AS audit_cost,
               COALESCE(sum(bytes), 0)::float8 AS bytes
        FROM web`,
      this.db.$queryRaw<
        Array<{ kind: 'copy' | 'audit'; model: string | null; calls: number; tin: number; tout: number; cost: number; exact_cost: number }>
      >`
        WITH ${base},
        calls AS (
          SELECT 'copy' AS kind, model, tin, tout, exact, cost FROM copy_costed
          UNION ALL
          SELECT 'audit' AS kind, model, tin, tout, exact, cost FROM audit_costed
        )
        SELECT kind, model, count(*) FILTER (WHERE tin + tout > 0)::int AS calls,
               COALESCE(sum(tin), 0)::float8 AS tin, COALESCE(sum(tout), 0)::float8 AS tout,
               COALESCE(sum(cost), 0)::float8 AS cost, COALESCE(sum(exact), 0)::float8 AS exact_cost
        FROM calls GROUP BY kind, model`,
      this.db.$queryRaw<Array<{ day: string; websites: number; cost: number; tokens: number }>>`
        WITH ${base}
        SELECT to_char(date_trunc('day', first_at), 'YYYY-MM-DD') AS day, count(*)::int AS websites,
               COALESCE(sum(copy_cost + audit_cost), 0)::float8 AS cost,
               COALESCE(sum(copy_in + copy_out + audit_in + audit_out), 0)::float8 AS tokens
        FROM web GROUP BY 1 ORDER BY 1`,
    ]);

    const t = totalsRows[0];
    const byModel: SiteCostModelRow[] = modelRows
      .filter((r) => r.calls > 0)
      .map((r) => ({
        model: r.model,
        kind: r.kind,
        calls: r.calls,
        tokens: { input: Number(r.tin), output: Number(r.tout) },
        costUsd: Number(r.cost),
      }))
      .sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls);
    const exactCostUsd = modelRows.reduce((sum, r) => sum + Number(r.exact_cost), 0);
    const copyCostUsd = Number(t?.copy_cost ?? 0);
    const auditCostUsd = Number(t?.audit_cost ?? 0);
    const totals: SiteCostTotals = {
      websites: t?.websites ?? 0,
      copies: t?.copies ?? 0,
      aiAudits: t?.audits ?? 0,
      copyTokens: { input: Number(t?.copy_in ?? 0), output: Number(t?.copy_out ?? 0) },
      auditTokens: { input: Number(t?.audit_in ?? 0), output: Number(t?.audit_out ?? 0) },
      copyCostUsd,
      auditCostUsd,
      exactCostUsd,
      estimatedCostUsd: Math.max(0, copyCostUsd + auditCostUsd - exactCostUsd),
      storageBytes: Number(t?.bytes ?? 0),
    };
    const byDay: SiteCostDayRow[] = dayRows.map((r) => ({
      day: r.day,
      websites: r.websites,
      costUsd: Number(r.cost),
      tokens: Number(r.tokens),
    }));
    return { totals, byModel, byDay };
  }

  async websites(filter: SiteCostFilter & { page: number; pageSize: number; search?: string; sort: SiteCostSort }) {
    const page = clampPage(filter.page);
    const pageSize = clampPageSize(filter.pageSize);
    const base = this.base(filter);
    const search = filter.search?.trim();
    const where = search
      ? Prisma.sql`WHERE company_name ILIKE ${`%${search}%`} OR company_domain ILIKE ${`%${search}%`}`
      : Prisma.empty;
    const [rows, counts] = await Promise.all([
      this.db.$queryRaw<WebRow[]>`
        WITH ${base}
        SELECT * FROM web ${where}
        ORDER BY ${ORDER[filter.sort] ?? ORDER.cost}, "leadId"
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.db.$queryRaw<Array<{ total: number }>>`WITH ${base} SELECT count(*)::int AS total FROM web ${where}`,
    ]);
    const total = counts[0]?.total ?? 0;
    return {
      items: rows.map(mapWeb),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async website(filter: Omit<SiteCostFilter, 'since'> & { leadId: string }) {
    const base = this.base({ ...filter, since: null });
    const [rows, copies, audits] = await Promise.all([
      this.db.$queryRaw<WebRow[]>`WITH ${base} SELECT * FROM web`,
      this.db.$queryRaw<Array<RunRow & { createdAt: Date; status: JobStatus; totalBytes: number; attempts: number }>>`
        WITH ${base}
        SELECT id, model, tin, tout, cost, estimated, "createdAt", status, "totalBytes", attempts
        FROM copy_costed ORDER BY "createdAt" DESC`,
      this.db.$queryRaw<Array<RunRow & { auditedAt: Date; method: string; verdict: string }>>`
        WITH ${base}
        SELECT id, model, tin, tout, cost, estimated, "auditedAt", method, verdict
        FROM audit_costed ORDER BY "auditedAt" DESC`,
    ]);
    const row = rows[0];
    if (!row) return null;
    return {
      row: mapWeb(row),
      copies: copies.map(
        (c): SiteCostCopyRun => ({
          id: c.id,
          createdAt: c.createdAt,
          status: c.status,
          model: c.model,
          tokens: tokensOf(c),
          costUsd: c.cost === null ? null : Number(c.cost),
          estimated: c.estimated,
          totalBytes: Number(c.totalBytes),
          attempts: c.attempts,
        }),
      ),
      audits: audits.map(
        (a): SiteCostAuditRun => ({
          id: a.id,
          auditedAt: a.auditedAt,
          method: a.method,
          verdict: a.verdict,
          model: a.model,
          tokens: tokensOf(a),
          costUsd: a.cost === null ? null : Number(a.cost),
          estimated: a.estimated,
        }),
      ),
    };
  }
}
