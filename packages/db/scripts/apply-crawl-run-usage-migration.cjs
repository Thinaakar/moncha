/**
 * Applies prisma/migrations/20261105090000_crawl_run_usage. Every statement is idempotent and only adds columns,
 * tables, indexes and keys; no existing row is changed.
 *
 *   node scripts/guarded.cjs node scripts/apply-crawl-run-usage-migration.cjs
 *
 * guarded.cjs refuses to run unless DB_ENV=dev and neither database URL points at PROD_DB_HOST.
 */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { assertDevDatabase } = require('./assert-dev-db.cjs');

assertDevDatabase();

const MIGRATION = '20261105090000_crawl_run_usage';
const sql = readFileSync(resolve(__dirname, `../prisma/migrations/${MIGRATION}/migration.sql`), 'utf8');

/** Split on `;` at the end of a line, keeping DO $$ … $$; blocks whole. */
function statements(text) {
  const out = [];
  let current = '';
  let inDollar = false;
  for (const line of text.split(/\r?\n/)) {
    if (!current && /^\s*(--|$)/.test(line)) continue;
    current += `${line}\n`;
    if ((line.match(/\$\$/g) || []).length % 2 === 1) inDollar = !inDollar;
    if (!inDollar && /;\s*$/.test(line)) {
      out.push(current.trim().replace(/;$/, ''));
      current = '';
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

const prisma = new PrismaClient();

async function run() {
  const list = statements(sql);
  console.log(`Applying ${MIGRATION} (${list.length} statements)...`);
  for (let i = 0; i < list.length; i++) {
    console.log(`  [${i + 1}/${list.length}] ${list[i].split('\n')[0].slice(0, 90)}`);
    await prisma.$executeRawUnsafe(list[i]);
  }
  const columns = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'CrawlPipelineSettings' AND column_name IN ('crawlMode', 'scheduleReservedRuns') ORDER BY 1`,
  );
  const tables = await prisma.$queryRawUnsafe(
    `SELECT table_name FROM information_schema.tables WHERE table_name IN ('CrawlRunUsage', 'ScheduleRunSkip') ORDER BY 1`,
  );
  console.log('Columns present:', columns.map((c) => c.column_name).join(', '));
  console.log('Tables present:', tables.map((t) => t.table_name).join(', '));
}

run()
  .catch((err) => {
    console.error('Migration failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
