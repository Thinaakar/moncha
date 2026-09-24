/**
 * Refuse destructive DB commands unless DB_ENV=dev and host is not PROD_DB_HOST.
 * Prints host (and optional NEON_BRANCH) before proceeding.
 */
import { pathToFileURL } from 'node:url';

function parseHost(databaseUrl) {
  try {
    const normalized = databaseUrl.replace(/^postgresql:/i, 'http:');
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}

export function assertDevDatabase(env = process.env) {
  const databaseUrl = env.DATABASE_URL || '';
  const host = parseHost(databaseUrl);
  const dbEnv = (env.DB_ENV || '').trim().toLowerCase();
  const prodHost = (env.PROD_DB_HOST || '').trim().toLowerCase();
  const neonBranch = env.NEON_BRANCH || '(unset)';

  console.log('[db-guard] About to touch database:');
  console.log(`  host:        ${host || '(unparseable DATABASE_URL)'}`);
  console.log(`  NEON_BRANCH: ${neonBranch}`);
  console.log(`  DB_ENV:      ${dbEnv || '(unset)'}`);

  if (dbEnv !== 'dev') {
    console.error('[db-guard] Refusing: set DB_ENV=dev to run reset/seed against a non-production DB.');
    process.exit(1);
  }

  if (!host) {
    console.error('[db-guard] Refusing: DATABASE_URL host could not be parsed.');
    process.exit(1);
  }

  if (!prodHost) {
    console.error('[db-guard] Refusing: set PROD_DB_HOST to the production hostname blocklist entry.');
    process.exit(1);
  }

  if (host.toLowerCase() === prodHost || host.toLowerCase().includes(prodHost)) {
    console.error(`[db-guard] Refusing: host "${host}" matches PROD_DB_HOST "${prodHost}".`);
    process.exit(1);
  }

  console.log('[db-guard] OK — not production; continuing.');
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  assertDevDatabase();
}
