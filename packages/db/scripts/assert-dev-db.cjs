/**
 * Refuse destructive DB commands unless DB_ENV=dev and neither
 * DATABASE_URL nor DIRECT_URL points at PROD_DB_HOST.
 * Prints hosts only (no passwords) before proceeding.
 */

function parseHost(databaseUrl) {
  try {
    const normalized = databaseUrl.replace(/^postgresql:/i, 'http:');
    return new URL(normalized).hostname;
  } catch {
    return null;
  }
}

function matchesProd(host, prodHost) {
  if (!host || !prodHost) return false;
  const h = host.toLowerCase();
  const p = prodHost.toLowerCase();
  return h === p || h.includes(p);
}

function assertDevDatabase(env = process.env) {
  const databaseUrl = env.DATABASE_URL || '';
  const directUrl = env.DIRECT_URL || env.DATABASE_URL_UNPOOLED || '';
  const pooledHost = parseHost(databaseUrl);
  const directHost = parseHost(directUrl);
  const dbEnv = (env.DB_ENV || '').trim().toLowerCase();
  const prodHost = (env.PROD_DB_HOST || '').trim().toLowerCase();
  const neonBranch = env.NEON_BRANCH || '(unset)';

  console.log('[db-guard] About to touch database:');
  console.log(`  DATABASE_URL host: ${pooledHost || '(missing/unparseable)'}`);
  console.log(`  DIRECT_URL host:   ${directHost || '(missing/unparseable)'}`);
  console.log(`  NEON_BRANCH:       ${neonBranch}`);
  console.log(`  DB_ENV:            ${dbEnv || '(unset)'}`);
  console.log(`  PROD_DB_HOST:      ${prodHost || '(unset)'}`);

  if (dbEnv !== 'dev') {
    console.error('[db-guard] Refusing: set DB_ENV=dev to run reset/seed against a non-production DB.');
    process.exit(1);
  }

  if (!pooledHost) {
    console.error('[db-guard] Refusing: DATABASE_URL host could not be parsed.');
    process.exit(1);
  }

  if (!directHost) {
    console.error(
      '[db-guard] Refusing: DIRECT_URL (or DATABASE_URL_UNPOOLED) host could not be parsed.',
    );
    process.exit(1);
  }

  if (!prodHost) {
    console.error('[db-guard] Refusing: set PROD_DB_HOST to the production hostname blocklist entry.');
    process.exit(1);
  }

  if (matchesProd(pooledHost, prodHost)) {
    console.error(
      `[db-guard] Refusing: DATABASE_URL host "${pooledHost}" matches PROD_DB_HOST "${prodHost}".`,
    );
    process.exit(1);
  }

  if (matchesProd(directHost, prodHost)) {
    console.error(
      `[db-guard] Refusing: DIRECT_URL host "${directHost}" matches PROD_DB_HOST "${prodHost}".`,
    );
    process.exit(1);
  }

  console.log('[db-guard] OK — both URLs are non-production; continuing.');
}

module.exports = { assertDevDatabase, parseHost, matchesProd };

if (require.main === module) {
  assertDevDatabase();
}
