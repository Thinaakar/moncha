#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { assertDevDatabase } from './assert-dev-db.mjs';

assertDevDatabase();

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/guarded.mjs <command> [args...]');
  process.exit(1);
}

const result = spawnSync(args[0], args.slice(1), {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});
process.exit(result.status ?? 1);
