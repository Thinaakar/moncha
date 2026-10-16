import { describe, expect, it } from 'vitest';
import {
  coldEmailContent,
  coldEmailSendingEnabled,
  isColdEmailRecipientAllowed,
  parseColdEmailAllowlist,
} from './cold-email';

describe('coldEmailContent', () => {
  it('personalizes the greeting and escapes HTML', () => {
    const { subject, html, text } = coldEmailContent({
      companyName: 'Acme <b>Co</b>',
      demoUrl: 'https://acme.example.workers.dev/?x=1&y=2',
    });
    expect(subject).toContain('Acme <b>Co</b>');
    expect(html).toContain('Hi Acme &lt;b&gt;Co&lt;/b&gt;,');
    expect(html).toContain('https://acme.example.workers.dev/?x=1&amp;y=2');
    expect(html).toContain('Open demo');
    expect(text).toContain('Grounded answers');
  });
});

describe('cold email gate', () => {
  it('defaults to disabled', () => {
    expect(coldEmailSendingEnabled({})).toBe(false);
    expect(isColdEmailRecipientAllowed('a@b.com', {})).toBe(false);
  });

  it('requires allowlist even when enabled', () => {
    const env = { COLD_EMAIL_SENDING_ENABLED: 'true', COLD_EMAIL_ALLOWLIST: '' };
    expect(isColdEmailRecipientAllowed('vinothjv4.tech@gmail.com', env)).toBe(false);
  });

  it('allows only listed addresses', () => {
    const env = {
      COLD_EMAIL_SENDING_ENABLED: 'true',
      COLD_EMAIL_ALLOWLIST: 'vinothjv4.tech@gmail.com, other@example.com',
    };
    expect(isColdEmailRecipientAllowed('vinothjv4.tech@gmail.com', env)).toBe(true);
    expect(isColdEmailRecipientAllowed('lead@company.com', env)).toBe(false);
  });

  it('opens with *', () => {
    expect(parseColdEmailAllowlist('*').open).toBe(true);
    expect(
      isColdEmailRecipientAllowed('anyone@x.com', {
        COLD_EMAIL_SENDING_ENABLED: '1',
        COLD_EMAIL_ALLOWLIST: '*',
      }),
    ).toBe(true);
  });
});
