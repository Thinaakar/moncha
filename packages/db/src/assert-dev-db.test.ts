import { describe, expect, it } from 'vitest';
import { assertDevDatabase, parseHost } from '../scripts/assert-dev-db.cjs';

describe('assertDevDatabase', () => {
  it('parses neon hosts', () => {
    expect(
      parseHost(
        'postgresql://u:p@ep-dawn-field-b5hve2qr-pooler.c-7.us-east-2.aws.neon.tech/neondb?sslmode=require',
      ),
    ).toBe('ep-dawn-field-b5hve2qr-pooler.c-7.us-east-2.aws.neon.tech');
  });

  it('refuses when DB_ENV is not dev', () => {
    const exit = process.exit;
    let code: number | undefined;
    process.exit = ((c?: number) => {
      code = c;
      throw new Error(`exit:${c}`);
    }) as never;
    try {
      expect(() =>
        assertDevDatabase({
          DATABASE_URL: 'postgresql://u:p@ep-dev-pooler.example/neon',
          DIRECT_URL: 'postgresql://u:p@ep-dev.example/neon',
          DB_ENV: 'prod',
          PROD_DB_HOST: 'ep-prod',
          NEON_BRANCH: 'dev',
        }),
      ).toThrow(/exit:1/);
      expect(code).toBe(1);
    } finally {
      process.exit = exit;
    }
  });

  it('refuses when DATABASE_URL host matches PROD_DB_HOST', () => {
    const exit = process.exit;
    let code: number | undefined;
    process.exit = ((c?: number) => {
      code = c;
      throw new Error(`exit:${c}`);
    }) as never;
    try {
      expect(() =>
        assertDevDatabase({
          DATABASE_URL: 'postgresql://u:p@ep-lucky-violet-b5u7kp15-pooler.example/neon',
          DIRECT_URL: 'postgresql://u:p@ep-dev.example/neon',
          DB_ENV: 'dev',
          PROD_DB_HOST: 'ep-lucky-violet-b5u7kp15',
          NEON_BRANCH: 'dev',
        }),
      ).toThrow(/exit:1/);
      expect(code).toBe(1);
    } finally {
      process.exit = exit;
    }
  });

  it('refuses when DIRECT_URL host matches PROD_DB_HOST', () => {
    const exit = process.exit;
    let code: number | undefined;
    process.exit = ((c?: number) => {
      code = c;
      throw new Error(`exit:${c}`);
    }) as never;
    try {
      expect(() =>
        assertDevDatabase({
          DATABASE_URL: 'postgresql://u:p@ep-dev-pooler.example/neon',
          DIRECT_URL: 'postgresql://u:p@ep-lucky-violet-b5u7kp15.example/neon',
          DB_ENV: 'dev',
          PROD_DB_HOST: 'ep-lucky-violet-b5u7kp15',
          NEON_BRANCH: 'dev',
        }),
      ).toThrow(/exit:1/);
      expect(code).toBe(1);
    } finally {
      process.exit = exit;
    }
  });
});
