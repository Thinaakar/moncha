import { spawnSync } from 'node:child_process';

process.env.DATABASE_URL ||= 'postgresql://user:password@localhost:5432/db';
const result = spawnSync('prisma', ['validate'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});
process.exit(result.status ?? 1);
