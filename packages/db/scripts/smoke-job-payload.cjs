const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

function loadRootEnv() {
  const envPath = path.resolve(__dirname, '../../../.env');
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    let v = s.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[s.slice(0, i).trim()] = v;
  }
}

loadRootEnv();
const host = new URL(process.env.DATABASE_URL.replace(/^postgresql:/i, 'http:')).hostname;
if (host.includes('lucky-violet')) {
  console.error('Refusing: root DATABASE_URL still points at production');
  process.exit(1);
}
console.log('Using host', host);

const prisma = new PrismaClient();
(async () => {
  const row = await prisma.jobRun.create({
    data: {
      tenantId: process.env.DEFAULT_TENANT_ID || 'tenant_moncha_internal',
      type: 'places_discovery',
      payload: { smoke: true },
    },
  });
  console.log('created job', row.id, 'status', row.status);
  await prisma.jobRun.delete({ where: { id: row.id } });
  console.log('smoke ok — payload column works');
  await prisma.$disconnect();
})().catch(async (e) => {
  console.error(e.message || e);
  await prisma.$disconnect();
  process.exit(1);
});
