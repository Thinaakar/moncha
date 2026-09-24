import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

function loadRootEnv() {
  const file = resolve(__dirname, '../../../.env');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadRootEnv();

const run = Boolean(process.env.DATABASE_URL) && process.env.DB_ENV === 'dev';

describe.skipIf(!run)('WebsiteAudit immutability triggers', () => {
  const db = new PrismaClient({
    datasources: {
      db: { url: process.env.DIRECT_URL || process.env.DATABASE_URL },
    },
  });

  it(
    'rejects UPDATE on WebsiteAudit',
    async () => {
      const tenant = await db.tenant.upsert({
        where: { id: 'tenant_immutability_test' },
        create: { id: 'tenant_immutability_test', name: 'Immutability Test' },
        update: {},
      });
      const company = await db.company.create({
        data: { tenantId: tenant.id, name: 'Immut Co', domain: `immut-${Date.now()}.example` },
      });
      const lead = await db.lead.create({
        data: { tenantId: tenant.id, companyId: company.id, queue: 'PENDING_AUDIT' },
      });
      const website = await db.website.create({
        data: {
          tenantId: tenant.id,
          companyId: company.id,
          url: 'https://immut.example',
          status: 'UNCHECKED',
        },
      });
      const audit = await db.websiteAudit.create({
        data: {
          tenantId: tenant.id,
          websiteId: website.id,
          leadId: lead.id,
          method: 'html',
          verdict: 'UNCERTAIN',
          kind: 'NONE',
          confidence: 0.1,
          classifierVersion: 'test',
        },
      });

      await expect(
        db.websiteAudit.update({
          where: { id: audit.id },
          data: { confidence: 0.99 },
        }),
      ).rejects.toThrow(/immutable/i);

      await db.$disconnect();
    },
    30_000,
  );
});
