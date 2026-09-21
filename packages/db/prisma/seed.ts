import { prisma } from '../src/client';

const TENANT_ID = 'tenant_moncha_internal';

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

  const company = await prisma.company.upsert({
    where: { tenantId_domain: { tenantId: tenant.id, domain: 'example.com' } },
    create: {
      tenantId: tenant.id,
      name: 'Demo Dental Clinic',
      domain: 'example.com',
      country: 'Singapore',
      city: 'Singapore',
    },
    update: { name: 'Demo Dental Clinic' },
  });

  await prisma.lead.upsert({
    where: { tenantId_companyId: { tenantId: tenant.id, companyId: company.id } },
    create: { tenantId: tenant.id, companyId: company.id, status: 'discovered' },
    update: {},
  });

  console.log({ tenantId: tenant.id, login: 'operator@moncha.local' });
}

main().finally(() => prisma.$disconnect());
