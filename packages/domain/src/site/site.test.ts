import { describe, expect, it } from 'vitest';
import { normalizeSiteFilePath, signPreviewToken, verifyPreviewToken } from './preview-token';

describe('preview token', () => {
  const secret = 'test-secret-test-secret-test-secret';
  const now = 1_800_000_000_000;

  it('round-trips valid tokens', async () => {
    const token = await signPreviewToken({ snapshotId: 'snap_1', tenantId: 'ten_1' }, secret, 3600, now);
    expect(token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    expect(await verifyPreviewToken(token, secret, now + 1000)).toEqual({ snapshotId: 'snap_1', tenantId: 'ten_1', exp: now / 1000 + 3600 });
  });

  it('rejects expired, tampered and wrongly signed tokens', async () => {
    const token = await signPreviewToken({ snapshotId: 'snap_1', tenantId: 'ten_1' }, secret, 60, now);
    expect(await verifyPreviewToken(token, secret, now + 61_000)).toBeNull();
    expect(await verifyPreviewToken(token, 'other-secret', now)).toBeNull();
    const forged = Buffer.from('snap_2.ten_1.9999999999').toString('base64url');
    expect(await verifyPreviewToken(`${forged}.${token.split('.')[1]}`, secret, now)).toBeNull();
    expect(await verifyPreviewToken(`${token}x`, secret, now)).toBeNull();
    expect(await verifyPreviewToken('garbage', secret, now)).toBeNull();
    expect(await verifyPreviewToken('', secret, now)).toBeNull();
  });

  it('normalizes file paths and rejects traversal', () => {
    expect(normalizeSiteFilePath('index.html')).toBe('index.html');
    expect(normalizeSiteFilePath('assets/site.com/a~1234abcd.png')).toBe('assets/site.com/a~1234abcd.png');
    for (const bad of ['../x', 'a/../../b', '/etc/passwd', 'a\\b', '%2e%2e/x', '%252e%252e/x', 'a//b', 'a\0b', '']) {
      expect(normalizeSiteFilePath(bad)).toBeNull();
    }
  });
});
