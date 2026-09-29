import fs from 'node:fs';
import path from 'node:path';

// Import this module before anything that reads process.env at load time (@moncha/db builds the
// Prisma client on import). apps/worker/.env wins; the repo-root .env only fills missing keys.

function loadEnvFile(envPath: string, override: boolean) {
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const i = s.indexOf('=');
    if (i < 0) continue;
    const k = s.slice(0, i).trim();
    let v = s.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (override || process.env[k] === undefined) process.env[k] = v;
  }
}

loadEnvFile(path.resolve(__dirname, '../.env'), true);
loadEnvFile(path.resolve(__dirname, '../../../.env'), false);
