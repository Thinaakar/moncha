import { describe, expect, it } from 'vitest';
import {
  COLD_EMAIL_LOGO_URL,
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

  it('shows the MonCha favicon PNG in the header instead of a letter', () => {
    const { html } = coldEmailContent({ companyName: 'Acme', demoUrl: 'https://acme.example' });
    expect(html).toContain(`<img src="${COLD_EMAIL_LOGO_URL}" width="28" height="28" alt="MonCha"`);
    expect(html).not.toContain('line-height:28px">M</td>');
    const custom = coldEmailContent({ companyName: 'Acme', demoUrl: 'https://acme.example', logoUrl: 'https://cdn.example/logo.png?a=1&b=2' });
    expect(custom.html).toContain('src="https://cdn.example/logo.png?a=1&amp;b=2"');
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
