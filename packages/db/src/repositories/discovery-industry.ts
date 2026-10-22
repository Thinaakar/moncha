import type { PrismaClient } from '@prisma/client';
import {
  normalizeIndustrySlug,
  type DiscoveryIndustryCreate,
  type DiscoveryIndustryRecord,
  type DiscoveryIndustryRepo,
} from '@moncha/domain';

export class PrismaDiscoveryIndustryRepository implements DiscoveryIndustryRepo {
  constructor(private db: PrismaClient) {}

  async list(tenantId: string): Promise<DiscoveryIndustryRecord[]> {
    const rows = await this.db.discoveryIndustry.findMany({
      where: {
        isActive: true,
        OR: [{ tenantId: null }, { tenantId }],
      },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    return rows.map(mapIndustry);
  }

  async findBySlug(tenantId: string, slug: string): Promise<DiscoveryIndustryRecord | null> {
    const normalized = normalizeIndustrySlug(slug);
    if (!normalized) return null;
    const row = await this.db.discoveryIndustry.findFirst({
      where: {
        slug: normalized,
        isActive: true,
        OR: [{ tenantId: null }, { tenantId }],
      },
    });
    return row ? mapIndustry(row) : null;
  }

  async findById(tenantId: string, id: string): Promise<DiscoveryIndustryRecord | null> {
    const row = await this.db.discoveryIndustry.findFirst({
      where: {
        id,
        isActive: true,
        OR: [{ tenantId: null }, { tenantId }],
      },
    });
    return row ? mapIndustry(row) : null;
  }

  async create(data: DiscoveryIndustryCreate): Promise<DiscoveryIndustryRecord | null> {
    const name = data.name.trim();
    const slug = normalizeIndustrySlug(name);
    if (!slug || slug.length < 2 || slug.length > 80) return null;

    // Check if an active industry with this slug already exists (global or for this tenant)
    const existing = await this.db.discoveryIndustry.findFirst({
      where: {
        slug,
        OR: [{ tenantId: null }, { tenantId: data.tenantId }],
      },
    });

    if (existing) {
      // If it exists and is active, conflict!
      if (existing.isActive) return null;

      // If it existed previously for this tenant and was archived, reactivate it!
      if (existing.tenantId === data.tenantId) {
        const reactivated = await this.db.discoveryIndustry.update({
          where: { id: existing.id },
          data: {
            name,
            category: data.category?.trim() || existing.category || 'Custom',
            isActive: true,
          },
        });
        return mapIndustry(reactivated);
      }
      return null;
    }

    try {
      const created = await this.db.discoveryIndustry.create({
        data: {
          tenantId: data.tenantId,
          name,
          slug,
          category: data.category?.trim() || 'Custom',
          isDefault: false,
          isActive: true,
        },
      });
      return mapIndustry(created);
    } catch {
      return null;
    }
  }

  async archive(tenantId: string, id: string): Promise<boolean> {
    // Only allow archiving custom industries owned by this tenant. Never system defaults!
    const res = await this.db.discoveryIndustry.updateMany({
      where: {
        id,
        tenantId,
        isDefault: false,
      },
      data: {
        isActive: false,
      },
    });
    return res.count > 0;
  }
}

function mapIndustry(row: {
  id: string;
  tenantId: string | null;
  name: string;
  slug: string;
  category: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): DiscoveryIndustryRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    slug: row.slug,
    category: row.category,
    isDefault: row.isDefault,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
