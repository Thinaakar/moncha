import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  AuthUserCreate,
  AuthUserRepo,
  PasswordResetCreate,
  PasswordResetRepo,
  SessionCreate,
  SessionRepo,
} from '@moncha/domain';

const isNotFound = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';

export class PrismaAuthUserRepository implements AuthUserRepo {
  constructor(private db: PrismaClient) {}

  findByEmail(tenantId: string, email: string) {
    return this.db.user.findFirst({
      where: { tenantId, email: { equals: email, mode: 'insensitive' } },
    });
  }

  async create(data: AuthUserCreate) {
    try {
      return await this.db.user.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return null;
      throw error;
    }
  }

  async updateName(userId: string, name: string) {
    try {
      return await this.db.user.update({ where: { id: userId }, data: { name } });
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async setPasswordHash(userId: string, passwordHash: string) {
    await this.db.user.updateMany({ where: { id: userId }, data: { passwordHash } });
  }
}

export class PrismaSessionRepository implements SessionRepo {
  constructor(private db: PrismaClient) {}

  async create(data: SessionCreate) {
    const row = await this.db.session.create({ data, select: { id: true, expiresAt: true } });
    return row;
  }

  async findActiveUser(tokenHash: string, now: Date) {
    const row = await this.db.session.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      include: { user: true },
    });
    return row?.user ?? null;
  }

  async revoke(tokenHash: string, now: Date) {
    const { count } = await this.db.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: now },
    });
    return count > 0;
  }

  async revokeAllForUser(userId: string, now: Date, keepTokenHash?: string) {
    const { count } = await this.db.session.updateMany({
      where: { userId, revokedAt: null, ...(keepTokenHash ? { tokenHash: { not: keepTokenHash } } : {}) },
      data: { revokedAt: now },
    });
    return count;
  }
}

export class PrismaPasswordResetRepository implements PasswordResetRepo {
  constructor(private db: PrismaClient) {}

  async create(data: PasswordResetCreate) {
    await this.db.passwordResetToken.create({ data });
  }

  async consume(tokenHash: string, now: Date) {
    const rows = await this.db.$queryRaw<Array<{ userId: string; tenantId: string }>>`
      UPDATE "PasswordResetToken" SET "usedAt" = ${now}
      WHERE "tokenHash" = ${tokenHash} AND "usedAt" IS NULL AND "expiresAt" > ${now}
      RETURNING "userId", "tenantId"
    `;
    return rows[0] ?? null;
  }

  async invalidateForUser(userId: string, now: Date) {
    await this.db.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } });
  }
}
