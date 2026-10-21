import { describe, expect, it } from 'vitest';
import {
  COLD_EMAIL_LOGO_URL,
  coldEmailContent,
  coldEmailSendingEnabled,
  isColdEmailRecipientAllowed,
  parseColdEmailAllowlist,
  shortCompanyName,
  isColdEmailDevMode,
  getColdEmailDevInboxes,
} from './cold-email';

describe('coldEmailContent', () => {
  it('personalizes the greeting and escapes HTML', () => {
    const { subject, html, text } = coldEmailContent({
      companyName: 'Acme <b>Co</b>',
      demoUrl: 'https://acme.example.workers.dev/?x=1&y=2',
    });
    expect(subject).toContain('Acme <b>Co</b>');
    expect(html).toContain('Hi Acme &lt;b&gt;Co&lt;/b&gt; team,');
    expect(html).toContain('https://acme.example.workers.dev/?x=1&amp;y=2');
    expect(html).toContain('Open demo');
    expect(text).toContain('Accurate answers');
  });

  it('shows "Click to view demo:" with the live demo URL as a link before the button', () => {
    const url = 'https://earthinterior-sg.vinothjv4-tech.workers.dev';
    const { html, text } = coldEmailContent({ companyName: 'Earth Interior Design', demoUrl: url });
    const label = html.indexOf('Click to view demo:');
    const link = html.indexOf(`<a href="${url}" style="color:#2563eb;text-decoration:underline">${url}</a>`);
    const button = html.indexOf('>Open demo</a>');
    expect(label).toBeGreaterThan(0);
    expect(link).toBeGreaterThan(label);
    expect(button).toBeGreaterThan(link);
    expect(text).toContain(`Click to view demo:\n${url}`);
    expect(html).not.toContain('Fair quotas');
  });

  it('greets the business by its short name', () => {
    expect(shortCompanyName('Earth Interior Design Pte Ltd')).toBe('Earth Interior Design');
    expect(shortCompanyName('Pepper Kitchen - Causeway Point')).toBe('Pepper Kitchen');
    expect(shortCompanyName('Homus Singapore @ T-Space (Showroom)')).toBe('Homus Singapore');
    const { html, subject } = coldEmailContent({ companyName: 'Earth Interior Design Pte Ltd', demoUrl: 'https://x.example' });
    expect(html).toContain('Hi Earth Interior Design team,');
    expect(subject).toBe('Your AI support assistant demo for Earth Interior Design');
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

describe('development mode safety', () => {
  it('defaults to dev mode enabled (fails closed)', () => {
    expect(isColdEmailDevMode({})).toBe(true);
    expect(isColdEmailDevMode({ COLD_EMAIL_DEV_MODE: 'false' })).toBe(true); // requires NODE_ENV=production too
    expect(isColdEmailDevMode({ COLD_EMAIL_DEV_MODE: 'false', NODE_ENV: 'production' })).toBe(true); // requires confirmation
    expect(
      isColdEmailDevMode({
        COLD_EMAIL_DEV_MODE: 'false',
        NODE_ENV: 'production',
        COLD_EMAIL_PRODUCTION_CONFIRMED: 'true',
      }),
    ).toBe(false);
  });

  it('returns default approved dev inboxes', () => {
    expect(getColdEmailDevInboxes({})).toEqual([
      'vinothjv4.tech@gmail.com',
      'thinaakark2004@gmail.com',
    ]);
  });

  it('parses custom dev inboxes or throws if invalid', () => {
    expect(
      getColdEmailDevInboxes({
        COLD_EMAIL_DEV_INBOXES: 'test1@example.com, test2@example.com',
      }),
    ).toEqual(['test1@example.com', 'test2@example.com']);

    expect(() => getColdEmailDevInboxes({ COLD_EMAIL_DEV_INBOXES: 'invalid-email' })).toThrow(
      /invalid_dev_inbox/,
    );
  });
});
