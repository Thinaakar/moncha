const fs = require('fs');
const path = require('path');

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
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
    out[s.slice(0, i).trim()] = v;
  }
  return out;
}

function hostOf(url) {
  try {
    return new URL(url.replace(/^postgresql:/i, 'http:')).hostname;
  } catch {
    return null;
  }
}

const root = readEnv(path.resolve(__dirname, '../../../.env'));
const dbEnvPath = path.resolve(__dirname, '../.env');

const databaseUrl = root.DATABASE_URL;
const directUrl = root.DIRECT_URL || root.DATABASE_URL_UNPOOLED;
const unpooled = root.DATABASE_URL_UNPOOLED || directUrl;

if (!databaseUrl || !directUrl) {
  console.error('Root .env missing DATABASE_URL or DIRECT_URL');
  process.exit(1);
}

const pooledHost = hostOf(databaseUrl);
const directHost = hostOf(directUrl);
const unpooledHost = hostOf(unpooled);
const prod = (root.PROD_DB_HOST || '').toLowerCase();

for (const [label, h] of [
  ['DATABASE_URL', pooledHost],
  ['DIRECT_URL', directHost],
  ['DATABASE_URL_UNPOOLED', unpooledHost],
]) {
  if (!h) {
    console.error('Could not parse host for', label);
    process.exit(1);
  }
  if (prod && h.toLowerCase().includes(prod)) {
    console.error(`Refusing: ${label} host "${h}" matches PROD_DB_HOST`);
    process.exit(1);
  }
  if (!h.includes('ep-dawn-field')) {
    console.error(`Refusing: ${label} expected ep-dawn-field, got ${h}`);
    process.exit(1);
  }
}

// DB-only keys — never copy app secrets into packages/db/.env
const next = {
  DATABASE_URL: databaseUrl,
  DIRECT_URL: directUrl,
  DATABASE_URL_UNPOOLED: unpooled,
  DB_ENV: root.DB_ENV || 'dev',
  PROD_DB_HOST: root.PROD_DB_HOST || 'ep-lucky-violet-b5u7kp15',
  NEON_BRANCH: root.NEON_BRANCH || 'dev',
};

const body = [
  '# DB-only for Prisma CLI. App secrets stay in repo-root `.env`.',
  '# Neon DEV branch only — never production (PROD_DB_HOST blocklist).',
  ...Object.entries(next).map(([k, v]) => `${k}="${v}"`),
  '',
].join('\n');

fs.writeFileSync(dbEnvPath, body, 'utf8');
console.log('Updated packages/db/.env (DB-only)');
for (const [k, v] of Object.entries(next)) {
  if (k.includes('URL')) console.log(k, 'host:', hostOf(v));
  else console.log(k + ':', v);
}
