import { Prisma, type PrismaClient } from '@prisma/client';
import type { AuthUserCreate, AuthUserRepo, SessionCreate, SessionRepo } from '@moncha/domain';

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
}
