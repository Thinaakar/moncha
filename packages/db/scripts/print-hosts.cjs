const fs = require('node:fs');
const { parseHost, assertDevDatabase } = require('./packages/db/scripts/assert-dev-db.cjs');

const env = {};
for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 0) continue;
  let v = t.slice(i + 1).trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  env[t.slice(0, i).trim()] = v;
}

const pooled = parseHost(env.DATABASE_URL);
const direct = parseHost(env.DIRECT_URL);
const prod = env.PROD_DB_HOST;

console.log('DATABASE_URL host:', pooled);
console.log('DIRECT_URL host:  ', direct);
console.log('PROD_DB_HOST:     ', prod);
console.log('both ep-dawn-field:', pooled.includes('ep-dawn-field') && direct.includes('ep-dawn-field'));
console.log('neither matches prod:', !pooled.includes(prod) && !direct.includes(prod));

Object.assign(process.env, env);
assertDevDatabase();
