import type { Logger } from './ports';

const SECRET_KEYS = /api[_-]?key|authorization|password|secret|token|database_url|credential/i;

function redact(fields?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!fields) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = SECRET_KEYS.test(key) ? '[redacted]' : value;
  }
  return out;
}

export function createConsoleLogger(): Logger {
  return {
    info(event, fields) {
      console.log(JSON.stringify({ level: 'info', event, ts: new Date().toISOString(), ...redact(fields) }));
    },
    error(event, fields) {
      console.error(JSON.stringify({ level: 'error', event, ts: new Date().toISOString(), ...redact(fields) }));
    },
  };
}

export function createSilentLogger(): Logger {
  return {
    info() {},
    error() {},
  };
}
