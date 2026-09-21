import type { PrismaClient } from '@prisma/client';

export class PrismaUserRepository {
  constructor(private db: PrismaClient) {}

  findByEmail(email: string) {
    return this.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });
  }
}
