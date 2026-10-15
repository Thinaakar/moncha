/**
 * Checks the MonCha internal lead API setup without printing secrets:
 *   pnpm --filter @moncha/worker exec tsx src/check-moncha-internal.ts
 * Reports which keys are set and which environment the base URL points at, then calls GET /slots (read-only).
 */
import './env';
import { createMonchaInternalClientFromEnv } from '@moncha/integrations';

const KEYS = ['MONCHA_INTERNAL_BASE_URL', 'MONCHA_INTERNAL_KEY'] as const;

async function main() {
  const present = Object.fromEntries(KEYS.map((k) => [k, Boolean(process.env[k]?.trim())]));
  console.log('keys set:', present);

  const client = createMonchaInternalClientFromEnv();
  if (!client) {
    console.log('moncha internal: not configured (set MONCHA_INTERNAL_KEY; MONCHA_INTERNAL_BASE_URL must be https, default UAT)');
    process.exitCode = 1;
    return;
  }
  const check = await client.check();
  console.log('moncha internal:', check);
  if (!check.canAuthenticate) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exit(1);
});
