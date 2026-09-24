import { createRequire } from 'node:module';
import { prisma } from '../src/client';

const require = createRequire(import.meta.url);
const { assertDevDatabase } = require('../scripts/assert-dev-db.cjs') as {
  assertDevDatabase: (env?: NodeJS.ProcessEnv) => void;
};
assertDevDatabase();

const TENANT_ID = process.env.DEFAULT_TENANT_ID || 'tenant_moncha_internal';

async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    create: { id: TENANT_ID, name: 'MonCha Internal' },
    update: { name: 'MonCha Internal' },
  });

  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email: 'operator@moncha.local' } },
    create: {
      tenantId: tenant.id,
      email: 'operator@moncha.local',
      name: 'Operator',
      role: 'admin',
    },
    update: { name: 'Operator', role: 'admin' },
  });

  console.log({ tenantId: tenant.id, login: 'operator@moncha.local' });
}

main().finally(() => prisma.$disconnect());
