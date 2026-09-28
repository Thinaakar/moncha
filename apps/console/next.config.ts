import type { NextConfig } from 'next';
import { loadEnvConfig } from '@next/env';
import fs from 'node:fs';
import path from 'node:path';

const repoRoot = path.join(__dirname, '../..');
loadEnvConfig(repoRoot);

/** Force DB URLs from repo-root `.env` so a stale shell/packages/db value cannot win. */
function forceRootDbEnv() {
  const envPath = path.join(repoRoot, '.env');
  if (!fs.existsSync(envPath)) return;
  const keys = new Set([
    'DATABASE_URL',
    'DIRECT_URL',
    'DATABASE_URL_UNPOOLED',
    'DB_ENV',
    'PROD_DB_HOST',
    'NEON_BRANCH',
    'GOOGLE_PLACES_API_KEY',
    'SESSION_SECRET',
    'DEFAULT_TENANT_ID',
    'OMIT_CHATBOT_SITES',
    'omit_chatbot_sites',
  ]);
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    if (!keys.has(k)) continue;
    let v = s.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[k] = v;
  }
}

forceRootDbEnv();

const config: NextConfig = {
  transpilePackages: [
    '@moncha/db',
    '@moncha/domain',
    '@moncha/contracts',
    '@moncha/integrations',
    '@moncha/crawling',
  ],
  async rewrites() {
    return [{ source: '/v1/:path*', destination: '/api/v1/:path*' }];
  },
};

export default config;
