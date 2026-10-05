import { neon } from '@neondatabase/serverless';
import type {
  AuthUserCreate,
  AuthUserRecord,
  AuthUserRepo,
  PasswordResetCreate,
  PasswordResetRepo,
  SessionCreate,
  SessionRepo,
  CompanyPatch,
  CompanyRecord,
  CompanyRepo,
  CompanyWrite,
  DiscoveryScheduleCreate,
  DiscoveryScheduleRecord,
  DiscoveryScheduleRepo,
  JobCreate,
  JobPatch,
  JobRunRecord,
  JobRepo,
  LeadCreate,
  LeadListItem,
  LeadListQuery,
  LeadListResult,
  LeadQualificationPatch,
  LeadRecord,
  LeadRepo,
  QueueCounts,
  SourceRecord,
  SourceWrite,
  WebsiteRecord,
  WebsiteRepo,
  WebsiteUpsert,
} from '@moncha/domain';

export type NeonClient = ReturnType<typeof neon>;

async function queryRows<T = any>(sql: NeonClient, text: string, params: any[] = []): Promise<T[]> {
  const res: any = await sql.query(text, params);
  return Array.isArray(res) ? res : [];
}

export class NeonDiscoveryScheduleRepo implements DiscoveryScheduleRepo {
  constructor(private sql: any) {}

  async list(tenantId: string): Promise<DiscoveryScheduleRecord[]> {
    const rows = await queryRows(
      this.sql,
      'SELECT id, "tenantId", "countryCode", "timeOfDay", timezone, enabled, "nextRunAt", "lastRunAt", "createdAt" FROM "DiscoverySchedule" WHERE "tenantId" = $1 ORDER BY "countryCode" ASC, "timeOfDay" ASC',
      [tenantId]
    );
    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenantId,
      countryCode: r.countryCode,
      timeOfDay: r.timeOfDay,
      timezone: r.timezone,
      enabled: r.enabled,
      nextRunAt: new Date(r.nextRunAt),
      lastRunAt: r.lastRunAt ? new Date(r.lastRunAt) : null,
      createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
    }));
  }

  async create(data: DiscoveryScheduleCreate): Promise<DiscoveryScheduleRecord | null> {
    try {
      const id = `sched_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
      const rows = await queryRows(
        this.sql,
        'INSERT INTO "DiscoverySchedule" (id, "tenantId", "countryCode", "timeOfDay", timezone, enabled, "nextRunAt", "createdAt") VALUES ($1, $2, $3, $4, $5, true, $6, NOW()) RETURNING *',
        [id, data.tenantId, data.countryCode, data.timeOfDay, data.timezone, data.nextRunAt.toISOString()]
      );
      const r = rows[0];
      return {
        id: r.id,
        tenantId: r.tenantId,
        countryCode: r.countryCode,
        timeOfDay: r.timeOfDay,
        timezone: r.timezone,
        enabled: r.enabled,
        nextRunAt: new Date(r.nextRunAt),
        lastRunAt: r.lastRunAt ? new Date(r.lastRunAt) : null,
        createdAt: new Date(r.createdAt),
      };
    } catch (error: any) {
      if (error?.message?.includes('unique') || error?.code === '23505' || String(error).includes('23505')) {
        return null;
      }
      throw error;
    }
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const rows = await queryRows(
      this.sql,
      'DELETE FROM "DiscoverySchedule" WHERE "tenantId" = $1 AND id = $2 RETURNING id',
      [tenantId, id]
    );
    return rows.length > 0;
  }

  async deleteByCountry(tenantId: string, countryCode: string): Promise<number> {
    const rows = await queryRows(
      this.sql,
      'DELETE FROM "DiscoverySchedule" WHERE "tenantId" = $1 AND "countryCode" = $2 RETURNING id',
      [tenantId, countryCode]
    );
    return rows.length;
  }

  async due(now: Date, limit: number): Promise<DiscoveryScheduleRecord[]> {
    const rows = await queryRows(
      this.sql,
      'SELECT * FROM "DiscoverySchedule" WHERE enabled = true AND "nextRunAt" <= $1 ORDER BY "nextRunAt" ASC LIMIT $2',
      [now.toISOString(), limit]
    );
    return rows.map((r: any) => ({
      id: r.id,
      tenantId: r.tenantId,
      countryCode: r.countryCode,
      timeOfDay: r.timeOfDay,
      timezone: r.timezone,
      enabled: r.enabled,
      nextRunAt: new Date(r.nextRunAt),
      lastRunAt: r.lastRunAt ? new Date(r.lastRunAt) : null,
      createdAt: new Date(r.createdAt),
    }));
  }

  async advance(schedule: DiscoveryScheduleRecord, next: Date, ranAt: Date, job?: JobCreate) {
    return { advanced: true, job: null };
  }

  async recentRuns(tenantId: string, limit: number): Promise<JobRunRecord[]> {
    const rows = await queryRows(
      this.sql,
      'SELECT * FROM "JobRun" WHERE "tenantId" = $1 AND type = \'country_discovery\' ORDER BY "createdAt" DESC LIMIT $2',
      [tenantId, limit]
    );
    return rows.map(mapJobRow);
  }
}

export class NeonJobRepo implements JobRepo {
  constructor(private sql: any) {}

  async create(data: JobCreate): Promise<JobRunRecord> {
    const id = `job_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const running = data.status === 'running';
    const rows = await queryRows(
      this.sql,
      `INSERT INTO "JobRun" (id, "tenantId", type, status, payload, "dedupeKey", "maxAttempts", "runAfter", attempts, "startedAt", "lockedAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, NOW())
       RETURNING *`,
      [
        id,
        data.tenantId,
        data.type,
        data.status || 'pending',
        data.payload ? JSON.stringify(data.payload) : null,
        data.dedupeKey ?? null,
        data.maxAttempts ?? 3,
        data.runAfter ? data.runAfter.toISOString() : new Date().toISOString(),
        running ? 1 : 0,
        running ? new Date().toISOString() : null,
      ]
    );
    return mapJobRow(rows[0]);
  }

  async update(tenantId: string, id: string, data: JobPatch): Promise<JobRunRecord | null> {
    const sets: string[] = [];
    const params: any[] = [tenantId, id];
    let idx = 3;
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    if (data.status) { sets.push(`status = $${idx++}`); params.push(data.status); }
    if (data.lastError !== undefined) { sets.push(`"lastError" = $${idx++}`); params.push(data.lastError); }
    if (data.result !== undefined) { sets.push(`result = $${idx++}`); params.push(data.result ? JSON.stringify(data.result) : null); }
    if (data.attempts !== undefined) { sets.push(`attempts = $${idx++}`); params.push(data.attempts); }
    if (data.runAfter) { sets.push(`"runAfter" = $${idx++}`); params.push(iso(data.runAfter)); }
    if (data.lockedAt !== undefined) { sets.push(`"lockedAt" = $${idx++}`); params.push(iso(data.lockedAt)); }
    if (data.lockedBy !== undefined) { sets.push(`"lockedBy" = $${idx++}`); params.push(data.lockedBy); }
    if (data.startedAt !== undefined) { sets.push(`"startedAt" = $${idx++}`); params.push(iso(data.startedAt)); }
    if (data.finishedAt !== undefined) { sets.push(`"finishedAt" = $${idx++}`); params.push(iso(data.finishedAt)); }
    if (!sets.length) return this.get(tenantId, id);

    const rows = await queryRows(
      this.sql,
      `UPDATE "JobRun" SET ${sets.join(', ')} WHERE "tenantId" = $1 AND id = $2 RETURNING *`,
      params
    );
    return rows.length ? mapJobRow(rows[0]) : null;
  }

  async get(tenantId: string, id: string): Promise<JobRunRecord | null> {
    const rows = await queryRows(
      this.sql,
      'SELECT * FROM "JobRun" WHERE "tenantId" = $1 AND id = $2',
      [tenantId, id]
    );
    return rows.length ? mapJobRow(rows[0]) : null;
  }
}

export class NeonCompanyRepo implements CompanyRepo {
  constructor(private sql: any) {}

  async findByDomain(tenantId: string, domain: string): Promise<CompanyRecord | null> {
    const rows = await queryRows(
      this.sql,
      'SELECT * FROM "Company" WHERE "tenantId" = $1 AND domain = $2 LIMIT 1',
      [tenantId, domain]
    );
    return rows.length ? mapCompanyRow(rows[0]) : null;
  }

  async create(data: CompanyWrite): Promise<CompanyRecord> {
    const id = `comp_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const rows = await queryRows(
      this.sql,
      `INSERT INTO "Company" (id, "tenantId", name, domain, country, city, phone, address, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
       RETURNING *`,
      [id, data.tenantId, data.name, data.domain ?? null, data.country ?? null, data.city ?? null, data.phone ?? null, data.address ?? null]
    );
    return mapCompanyRow(rows[0]);
  }

  async update(tenantId: string, id: string, data: CompanyPatch): Promise<CompanyRecord | null> {
    const sets: string[] = ['"updatedAt" = NOW()'];
    const params: any[] = [tenantId, id];
    let idx = 3;
    if (data.name) { sets.push(`name = $${idx++}`); params.push(data.name); }
    if (data.domain !== undefined) { sets.push(`domain = $${idx++}`); params.push(data.domain); }
    if (data.country !== undefined) { sets.push(`country = $${idx++}`); params.push(data.country); }
    if (data.city !== undefined) { sets.push(`city = $${idx++}`); params.push(data.city); }
    if (data.phone !== undefined) { sets.push(`phone = $${idx++}`); params.push(data.phone); }
    if (data.address !== undefined) { sets.push(`address = $${idx++}`); params.push(data.address); }

    const rows = await queryRows(
      this.sql,
      `UPDATE "Company" SET ${sets.join(', ')} WHERE "tenantId" = $1 AND id = $2 RETURNING *`,
      params
    );
    return rows.length ? mapCompanyRow(rows[0]) : null;
  }

  async upsertSource(data: SourceWrite): Promise<SourceRecord> {
    const id = `src_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const rows = await queryRows(
      this.sql,
      `INSERT INTO "SourceRecord" (id, "tenantId", "companyId", source, "externalId", "rawJson", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT ("tenantId", source, "externalId") DO UPDATE SET "rawJson" = EXCLUDED."rawJson"
       RETURNING *`,
      [id, data.tenantId, data.companyId, data.source, data.externalId ?? null, data.rawJson ? JSON.stringify(data.rawJson) : null]
    );
    const r = rows[0];
    return {
      id: r.id,
      tenantId: r.tenantId,
      companyId: r.companyId,
      source: r.source,
      externalId: r.externalId,
      rawJson: r.rawJson,
    };
  }
}

export class NeonLeadRepo implements LeadRepo {
  constructor(private sql: any) {}

  async create(data: LeadCreate): Promise<LeadRecord> {
    const id = `lead_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const rows = await queryRows(
      this.sql,
      `INSERT INTO "Lead" (id, "tenantId", "companyId", queue, "assistantVerdict", "qualificationReason", version, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, 1, NOW(), NOW())
       RETURNING *`,
      [id, data.tenantId, data.companyId, data.queue, data.assistantVerdict ?? null, data.qualificationReason ?? null]
    );
    return mapLeadRecord(rows[0]);
  }

  async findByCompany(tenantId: string, companyId: string): Promise<LeadRecord | null> {
    const rows = await queryRows(
      this.sql,
      'SELECT * FROM "Lead" WHERE "tenantId" = $1 AND "companyId" = $2 LIMIT 1',
      [tenantId, companyId]
    );
    return rows.length ? mapLeadRecord(rows[0]) : null;
  }

  async get(tenantId: string, id: string): Promise<LeadListItem | null> {
    const rows = await queryRows(
      this.sql,
      `SELECT l.*,
              c.id as "c_id", c.name as "c_name", c.domain as "c_domain", c.country as "c_country",
              c.city as "c_city", c.phone as "c_phone", c.address as "c_address",
              w.id as "w_id", w.url as "w_url", w.status as "w_status", w.title as "w_title"
       FROM "Lead" l
       LEFT JOIN "Company" c ON l."companyId" = c.id
       LEFT JOIN "Website" w ON c.id = w."companyId"
       WHERE l."tenantId" = $1 AND l.id = $2`,
      [tenantId, id]
    );
    return rows.length ? mapLeadListItem(rows[0]) : null;
  }

  async list(tenantId: string, query: LeadListQuery): Promise<LeadListResult> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 25));
    const offset = (page - 1) * pageSize;

    const conditions = ['l."tenantId" = $1'];
    const params: any[] = [tenantId];
    let paramIdx = 2;

    if (query.queue) {
      conditions.push(`l.queue = $${paramIdx++}`);
      params.push(query.queue);
    }
    if (query.country) {
      conditions.push(`c.country = $${paramIdx++}`);
      params.push(query.country);
    }
    if (query.search) {
      conditions.push(`(c.name ILIKE $${paramIdx} OR c.domain ILIKE $${paramIdx})`);
      params.push(`%${query.search}%`);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    const countRows = await queryRows(
      this.sql,
      `SELECT COUNT(*)::int as total
       FROM "Lead" l
       LEFT JOIN "Company" c ON l."companyId" = c.id
       WHERE ${whereClause}`,
      params
    );
    const total = Number(countRows[0]?.total || 0);

    const dataRows = await queryRows(
      this.sql,
      `SELECT l.*,
              c.id as "c_id", c.name as "c_name", c.domain as "c_domain", c.country as "c_country",
              c.city as "c_city", c.phone as "c_phone", c.address as "c_address",
              w.id as "w_id", w.url as "w_url", w.status as "w_status", w.title as "w_title"
       FROM "Lead" l
       LEFT JOIN "Company" c ON l."companyId" = c.id
       LEFT JOIN "Website" w ON c.id = w."companyId"
       WHERE ${whereClause}
       ORDER BY l."createdAt" DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, pageSize, offset]
    );

    return {
      items: dataRows.map(mapLeadListItem),
      total,
      page,
      pageSize,
      totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
    };
  }

  async applyQualification(tenantId: string, leadId: string, data: LeadQualificationPatch): Promise<LeadRecord | null> {
    const rows = await queryRows(
      this.sql,
      `UPDATE "Lead"
       SET queue = $1, "assistantVerdict" = $2, "assistantVendor" = $3, "qualificationReason" = $4,
           "latestAuditId" = COALESCE($5, "latestAuditId"), version = version + 1, "updatedAt" = NOW()
       WHERE id = $6 AND "tenantId" = $7 AND version = $8
       RETURNING *`,
      [data.queue, data.assistantVerdict, data.assistantVendor ?? null, data.qualificationReason, data.latestAuditId ?? null, leadId, tenantId, data.expectedVersion]
    );
    return rows.length ? mapLeadRecord(rows[0]) : null;
  }

  async queueCounts(tenantId: string): Promise<QueueCounts> {
    const rows = await queryRows(
      this.sql,
      'SELECT queue, COUNT(*)::int as count FROM "Lead" WHERE "tenantId" = $1 GROUP BY queue',
      [tenantId]
    );
    const counts: QueueCounts = {
      PENDING_AUDIT: 0,
      QUALIFIED: 0,
      HAS_ASSISTANT: 0,
      NO_WEBSITE: 0,
      NEEDS_REVIEW: 0,
      INACTIVE: 0,
      openReviewTasks: 0,
    };
    for (const r of rows) {
      if (r.queue in counts) (counts as any)[r.queue] = Number(r.count);
    }
    return counts;
  }
}

export class NeonWebsiteRepo implements WebsiteRepo {
  constructor(private sql: any) {}

  async upsert(data: WebsiteUpsert): Promise<WebsiteRecord> {
    const id = `web_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const rows = await queryRows(
      this.sql,
      `INSERT INTO "Website" (id, "tenantId", "companyId", url, status)
       VALUES ($1, $2, $3, $4, COALESCE($5::"WebsiteStatus", 'UNCHECKED'))
       ON CONFLICT ("companyId") DO UPDATE
         SET url = EXCLUDED.url, status = COALESCE($5::"WebsiteStatus", "Website".status)
       RETURNING *`,
      [id, data.tenantId, data.companyId, data.url, data.status ?? null]
    );
    return mapWebsiteRow(rows[0]);
  }

  async getByCompany(tenantId: string, companyId: string): Promise<WebsiteRecord | null> {
    const rows = await queryRows(
      this.sql,
      'SELECT * FROM "Website" WHERE "tenantId" = $1 AND "companyId" = $2 LIMIT 1',
      [tenantId, companyId]
    );
    return rows.length ? mapWebsiteRow(rows[0]) : null;
  }

  async applyAuditPointers(
    tenantId: string,
    websiteId: string,
    data: {
      status: any;
      canonicalUrl?: string | null;
      language?: string | null;
      finalUrl?: string | null;
      httpStatus?: number | null;
      title?: string | null;
      latestAuditId: string;
      lastCheckedAt: Date;
    }
  ): Promise<WebsiteRecord | null> {
    const rows = await queryRows(
      this.sql,
      `UPDATE "Website"
       SET status = $1, "canonicalUrl" = $2, language = $3, "finalUrl" = $4,
           "httpStatus" = $5, title = $6, "latestAuditId" = $7, "lastCheckedAt" = $8
       WHERE "tenantId" = $9 AND id = $10
       RETURNING *`,
      [
        data.status,
        data.canonicalUrl ?? null,
        data.language ?? null,
        data.finalUrl ?? null,
        data.httpStatus ?? null,
        data.title ?? null,
        data.latestAuditId,
        data.lastCheckedAt.toISOString(),
        tenantId,
        websiteId,
      ]
    );
    return rows.length ? mapWebsiteRow(rows[0]) : null;
  }
}

const USER_COLUMNS = 'u.id, u."tenantId", u.email, u.name, u.role, u."passwordHash", u."createdAt"';

export class NeonAuthUserRepo implements AuthUserRepo {
  constructor(private sql: any) {}

  async findByEmail(tenantId: string, email: string): Promise<AuthUserRecord | null> {
    const rows = await queryRows(
      this.sql,
      `SELECT ${USER_COLUMNS} FROM "User" u WHERE u."tenantId" = $1 AND lower(u.email) = lower($2) LIMIT 1`,
      [tenantId, email]
    );
    return rows.length ? mapUserRow(rows[0]) : null;
  }

  async create(data: AuthUserCreate): Promise<AuthUserRecord | null> {
    const id = `user_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const rows = await queryRows(
      this.sql,
      `INSERT INTO "User" AS u (id, "tenantId", email, name, role, "passwordHash", "createdAt")
       VALUES ($1, $2, $3, $4, $5::"UserRole", $6, NOW())
       ON CONFLICT ("tenantId", email) DO NOTHING
       RETURNING ${USER_COLUMNS}`,
      [id, data.tenantId, data.email, data.name, data.role, data.passwordHash]
    );
    return rows.length ? mapUserRow(rows[0]) : null;
  }

  async updateName(userId: string, name: string): Promise<AuthUserRecord | null> {
    const rows = await queryRows(
      this.sql,
      `UPDATE "User" AS u SET name = $2 WHERE u.id = $1 RETURNING ${USER_COLUMNS}`,
      [userId, name]
    );
    return rows.length ? mapUserRow(rows[0]) : null;
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await queryRows(this.sql, 'UPDATE "User" SET "passwordHash" = $2 WHERE id = $1', [userId, passwordHash]);
  }
}

export class NeonPasswordResetRepo implements PasswordResetRepo {
  constructor(private sql: any) {}

  async create(data: PasswordResetCreate): Promise<void> {
    const id = `pwr_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    await queryRows(
      this.sql,
      `INSERT INTO "PasswordResetToken" (id, "tenantId", "userId", "tokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [id, data.tenantId, data.userId, data.tokenHash, data.expiresAt.toISOString()]
    );
  }

  async consume(tokenHash: string, now: Date): Promise<{ userId: string; tenantId: string } | null> {
    const rows = await queryRows(
      this.sql,
      `UPDATE "PasswordResetToken" SET "usedAt" = $2
       WHERE "tokenHash" = $1 AND "usedAt" IS NULL AND "expiresAt" > $2
       RETURNING "userId", "tenantId"`,
      [tokenHash, now.toISOString()]
    );
    return rows.length ? { userId: rows[0].userId, tenantId: rows[0].tenantId } : null;
  }

  async invalidateForUser(userId: string, now: Date): Promise<void> {
    await queryRows(
      this.sql,
      'UPDATE "PasswordResetToken" SET "usedAt" = $2 WHERE "userId" = $1 AND "usedAt" IS NULL',
      [userId, now.toISOString()]
    );
  }
}

export class NeonSessionRepo implements SessionRepo {
  constructor(private sql: any) {}

  async create(data: SessionCreate): Promise<{ id: string; expiresAt: Date }> {
    const id = `sess_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
    const rows = await queryRows(
      this.sql,
      `INSERT INTO "Session" (id, "tenantId", "userId", "tokenHash", "expiresAt", "createdAt")
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING id, "expiresAt"`,
      [id, data.tenantId, data.userId, data.tokenHash, data.expiresAt.toISOString()]
    );
    return { id: rows[0].id, expiresAt: new Date(rows[0].expiresAt) };
  }

  async findActiveUser(tokenHash: string, now: Date): Promise<AuthUserRecord | null> {
    const rows = await queryRows(
      this.sql,
      `SELECT ${USER_COLUMNS} FROM "Session" s JOIN "User" u ON u.id = s."userId"
       WHERE s."tokenHash" = $1 AND s."revokedAt" IS NULL AND s."expiresAt" > $2 LIMIT 1`,
      [tokenHash, now.toISOString()]
    );
    return rows.length ? mapUserRow(rows[0]) : null;
  }

  async revoke(tokenHash: string, now: Date): Promise<boolean> {
    const rows = await queryRows(
      this.sql,
      'UPDATE "Session" SET "revokedAt" = $2 WHERE "tokenHash" = $1 AND "revokedAt" IS NULL RETURNING id',
      [tokenHash, now.toISOString()]
    );
    return rows.length > 0;
  }

  async revokeAllForUser(userId: string, now: Date, keepTokenHash?: string): Promise<number> {
    const rows = await queryRows(
      this.sql,
      `UPDATE "Session" SET "revokedAt" = $2
       WHERE "userId" = $1 AND "revokedAt" IS NULL AND ($3::text IS NULL OR "tokenHash" <> $3)
       RETURNING id`,
      [userId, now.toISOString(), keepTokenHash ?? null]
    );
    return rows.length;
  }
}

function mapUserRow(r: any): AuthUserRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    email: r.email,
    name: r.name ?? null,
    role: r.role,
    passwordHash: r.passwordHash ?? null,
    createdAt: new Date(r.createdAt),
  };
}

function mapCompanyRow(r: any): CompanyRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    name: r.name,
    domain: r.domain,
    country: r.country,
    city: r.city,
    phone: r.phone,
    address: r.address,
  };
}

function mapWebsiteRow(r: any): WebsiteRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    companyId: r.companyId,
    url: r.url,
    canonicalUrl: r.canonicalUrl,
    status: r.status,
    language: r.language,
    finalUrl: r.finalUrl,
    httpStatus: r.httpStatus,
    title: r.title,
    latestAuditId: r.latestAuditId,
    lastCheckedAt: r.lastCheckedAt ? new Date(r.lastCheckedAt) : null,
  };
}

function mapLeadRecord(r: any): LeadRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    companyId: r.companyId,
    queue: r.queue,
    assistantVerdict: r.assistantVerdict,
    assistantVendor: r.assistantVendor,
    qualificationReason: r.qualificationReason,
    latestAuditId: r.latestAuditId,
    version: r.version,
    createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
    updatedAt: r.updatedAt ? new Date(r.updatedAt) : new Date(),
  };
}

function mapLeadListItem(r: any): LeadListItem {
  return {
    id: r.id,
    tenantId: r.tenantId,
    companyId: r.companyId,
    queue: r.queue,
    assistantVerdict: r.assistantVerdict,
    assistantVendor: r.assistantVendor,
    qualificationReason: r.qualificationReason,
    latestAuditId: r.latestAuditId,
    version: r.version,
    createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
    updatedAt: r.updatedAt ? new Date(r.updatedAt) : new Date(),
    company: {
      id: r.c_id,
      tenantId: r.tenantId,
      name: r.c_name,
      domain: r.c_domain,
      country: r.c_country,
      city: r.c_city,
      phone: r.c_phone,
      address: r.c_address,
      website: r.w_id ? {
        id: r.w_id,
        tenantId: r.tenantId,
        companyId: r.companyId,
        url: r.w_url,
        canonicalUrl: null,
        status: r.w_status,
        language: null,
        finalUrl: null,
        httpStatus: null,
        title: r.w_title,
        latestAuditId: null,
        lastCheckedAt: null,
      } : null,
      sourceRecords: [],
    },
  };
}

function mapJobRow(r: any): JobRunRecord {
  return {
    id: r.id,
    tenantId: r.tenantId,
    type: r.type,
    status: r.status,
    payload: typeof r.payload === 'string' ? JSON.parse(r.payload) : r.payload,
    result: typeof r.result === 'string' ? JSON.parse(r.result) : r.result,
    attempts: r.attempts,
    maxAttempts: r.maxAttempts,
    runAfter: r.runAfter ? new Date(r.runAfter) : new Date(),
    lockedAt: r.lockedAt ? new Date(r.lockedAt) : null,
    lockedBy: r.lockedBy ?? null,
    lastError: r.lastError ?? null,
    dedupeKey: r.dedupeKey ?? null,
    startedAt: r.startedAt ? new Date(r.startedAt) : null,
    finishedAt: r.finishedAt ? new Date(r.finishedAt) : null,
    createdAt: r.createdAt ? new Date(r.createdAt) : new Date(),
  };
}
