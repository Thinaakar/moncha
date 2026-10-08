import { describe, expect, it } from 'vitest';
import { DEMO_MARKER, injectDemo, neutralizeMetaCsp, scriptSafeJson, type DemoConfig } from './demo-injection';
import { normalizeSiteFilePath, signPreviewToken, verifyPreviewToken } from './preview-token';

const config: DemoConfig = {
  businessName: 'Clínica </script><b>',
  greeting: 'Hi!',
  faqs: [{ question: 'Open?', answer: 'Yes' }],
  colors: { primary: '#112233', background: null, text: null },
  phone: null,
  email: null,
  whatsapp: null,
  language: 'es',
  logoPath: null,
};

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'latin1'));
const str = (b: Uint8Array) => Buffer.from(b).toString('latin1');

describe('demo injection', () => {
  it('inserts before the last </body> and leaves the rest unchanged', () => {
    const index = '<html><body><p>x</p><script>"</body>"</script></BODY>\r\n</html>';
    const out = str(injectDemo(bytes(index), config).bytes);
    const at = out.indexOf('<script>window.__MONCHA_DEMO__');
    expect(out.slice(0, at)).toBe('<html><body><p>x</p><script>"</body>"</script>');
    expect(out.endsWith('</BODY>\r\n</html>')).toBe(true);
    expect(out).toContain(`<script src="moncha-widget.js" ${DEMO_MARKER}></script>`);
    expect(index).not.toContain(DEMO_MARKER);
  });

  it('appends when there is no </body>', () => {
    const out = str(injectDemo(bytes('<p>hi'), config).bytes);
    expect(out.startsWith('<p>hi<script>')).toBe(true);
  });

  it('keeps non-UTF-8 bytes intact', () => {
    const index = new Uint8Array([0x3c, 0x70, 0x3e, 0x93, 0xfa, 0x3c, 0x2f, 0x62, 0x6f, 0x64, 0x79, 0x3e]);
    const out = injectDemo(index, config).bytes;
    expect(Array.from(out.slice(0, 5))).toEqual([0x3c, 0x70, 0x3e, 0x93, 0xfa]);
    expect(Array.from(out.slice(-7))).toEqual(Array.from(index.slice(-7)));
  });

  it('emits ASCII-only JSON that cannot close the script', () => {
    const json = scriptSafeJson(config);
    expect(json).not.toMatch(/[<>]/);
    expect(json).toMatch(/^[\x00-\x7f]*$/);
    expect(JSON.parse(json)).toEqual(config);
  });

  it('neutralizes meta CSP', () => {
    const r = neutralizeMetaCsp(`<meta http-equiv="Content-Security-Policy" content="default-src 'self'"><meta charset=utf-8>`);
    expect(r.count).toBe(1);
    expect(r.html).toBe('<meta name="moncha-removed-csp"><meta charset=utf-8>');
  });
});

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
