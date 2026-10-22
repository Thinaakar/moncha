import { describe, expect, it, vi } from 'vitest';
import { PrismaDiscoveryIndustryRepository } from './repositories/discovery-industry';

function mockDb() {
  const table: any[] = [];
  let seq = 1;

  const db: any = {
    discoveryIndustry: {
      findMany: vi.fn(async ({ where, orderBy }: any) => {
        let results = table.filter((r) => {
          if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
          if (where.OR) {
            const matchesOr = where.OR.some((cond: any) => {
              if (cond.tenantId === null && r.tenantId === null) return true;
              if (cond.tenantId && r.tenantId === cond.tenantId) return true;
              return false;
            });
            if (!matchesOr) return false;
          }
          return true;
        });
        return results;
      }),

      findFirst: vi.fn(async ({ where }: any) => {
        return table.find((r) => {
          if (where.id && r.id !== where.id) return false;
          if (where.slug && r.slug !== where.slug) return false;
          if (where.isActive !== undefined && r.isActive !== where.isActive) return false;
          if (where.OR) {
            const matchesOr = where.OR.some((cond: any) => {
              if (cond.tenantId === null && r.tenantId === null) return true;
              if (cond.tenantId && r.tenantId === cond.tenantId) return true;
              return false;
            });
            if (!matchesOr) return false;
          }
          return true;
        }) ?? null;
      }),

      create: vi.fn(async ({ data }: any) => {
        const row = {
          id: `ind_${seq++}`,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        table.push(row);
        return row;
      }),

      update: vi.fn(async ({ where, data }: any) => {
        const row = table.find((r) => r.id === where.id);
        if (!row) throw new Error('Not found');
        Object.assign(row, data, { updatedAt: new Date() });
        return row;
      }),

      updateMany: vi.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of table) {
          if (where.id && row.id !== where.id) continue;
          if (where.tenantId && row.tenantId !== where.tenantId) continue;
          if (where.isDefault !== undefined && row.isDefault !== where.isDefault) continue;
          Object.assign(row, data, { updatedAt: new Date() });
          count++;
        }
        return { count };
      }),
    },
  };

  return { db, table };
}

describe('PrismaDiscoveryIndustryRepository', () => {
  it('lists global default industries plus the current tenant custom industries', async () => {
    const { db, table } = mockDb();
    // Seed 1 global default, 1 custom for t1, 1 custom for t2
    table.push(
      { id: '1', tenantId: null, name: 'Dentist', slug: 'dentist', category: 'Healthcare', isDefault: true, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      { id: '2', tenantId: 't1', name: 'Pet Grooming', slug: 'pet grooming', category: 'Custom', isDefault: false, isActive: true, createdAt: new Date(), updatedAt: new Date() },
      { id: '3', tenantId: 't2', name: 'Boat Repair', slug: 'boat repair', category: 'Custom', isDefault: false, isActive: true, createdAt: new Date(), updatedAt: new Date() },
    );

    const repo = new PrismaDiscoveryIndustryRepository(db);
    const t1List = await repo.list('t1');
    expect(t1List).toHaveLength(2);
    expect(t1List.map((i) => i.slug)).toEqual(['dentist', 'pet grooming']);

    // Tenant t2 should see global + t2 only
    const t2List = await repo.list('t2');
    expect(t2List).toHaveLength(2);
    expect(t2List.map((i) => i.slug)).toEqual(['dentist', 'boat repair']);
  });

  it('creates custom industry for a tenant and normalizes the slug', async () => {
    const { db } = mockDb();
    const repo = new PrismaDiscoveryIndustryRepository(db);

    const created = await repo.create({
      tenantId: 't1',
      name: '  Solar Panel Cleaning  ',
      category: 'Home Services',
    });

    expect(created).not.toBeNull();
    expect(created?.name).toBe('Solar Panel Cleaning');
    expect(created?.slug).toBe('solar panel cleaning');
    expect(created?.category).toBe('Home Services');
    expect(created?.isDefault).toBe(false);
  });

  it('rejects duplicate custom industries for the same tenant', async () => {
    const { db, table } = mockDb();
    table.push({
      id: '1',
      tenantId: 't1',
      name: 'Solar Cleaning',
      slug: 'solar cleaning',
      category: 'Custom',
      isDefault: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const repo = new PrismaDiscoveryIndustryRepository(db);
    const result = await repo.create({
      tenantId: 't1',
      name: 'Solar Cleaning',
    });
    expect(result).toBeNull();
  });

  it('protects system default industries from being deleted or archived', async () => {
    const { db, table } = mockDb();
    table.push({
      id: 'def_1',
      tenantId: null,
      name: 'Dentist',
      slug: 'dentist',
      category: 'Healthcare',
      isDefault: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const repo = new PrismaDiscoveryIndustryRepository(db);
    // Attempting to archive a system default industry should fail
    const archived = await repo.archive('t1', 'def_1');
    expect(archived).toBe(false);
    expect(table[0].isActive).toBe(true);
  });

  it('allows archiving custom industries owned by the tenant', async () => {
    const { db, table } = mockDb();
    table.push({
      id: 'cust_1',
      tenantId: 't1',
      name: 'Custom Industry',
      slug: 'custom industry',
      category: 'Custom',
      isDefault: false,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const repo = new PrismaDiscoveryIndustryRepository(db);
    const archived = await repo.archive('t1', 'cust_1');
    expect(archived).toBe(true);
    expect(table[0].isActive).toBe(false);
  });
});
