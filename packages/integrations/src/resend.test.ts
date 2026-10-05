import { describe, expect, it } from 'vitest';
import { createResendMailerFromEnv, passwordResetEmailContent, ResendMailer } from './resend';

const email = {
  to: 'ana@example.com',
  name: 'Ana <b>',
  resetUrl: 'https://console.example.com/reset-password?token=abc&x=1',
  expiresAt: new Date(Date.now() + 30 * 60_000),
};

describe('ResendMailer', () => {
  it('posts the reset email to Resend with the API key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response('{"id":"e1"}', { status: 200 });
    }) as unknown as typeof fetch;
    await new ResendMailer('re_test', 'MonCha <no-reply@moncha.io>', fetchImpl).sendPasswordReset(email);

    expect(calls[0]!.url).toBe('https://api.resend.com/emails');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer re_test');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body).toMatchObject({ from: 'MonCha <no-reply@moncha.io>', to: ['ana@example.com'] });
    expect(body.text).toContain(email.resetUrl);
    expect(body.html).toContain('token=abc&amp;x=1');
    expect(body.html).not.toContain('<b>');
  });

  it('throws with the Resend status when sending fails', async () => {
    const fetchImpl = (async () => new Response('{"message":"invalid key"}', { status: 403 })) as unknown as typeof fetch;
    await expect(new ResendMailer('bad', undefined, fetchImpl).sendPasswordReset(email)).rejects.toThrow(/resend_403/);
  });

  it('is only created when RESEND_API_KEY is set', () => {
    expect(createResendMailerFromEnv({})).toBeNull();
    expect(createResendMailerFromEnv({ RESEND_API_KEY: '  ' })).toBeNull();
    expect(createResendMailerFromEnv({ RESEND_API_KEY: 're_x' })).toBeInstanceOf(ResendMailer);
  });

  it('says how long the link lasts', () => {
    expect(passwordResetEmailContent(email).text).toMatch(/expires in 30 minutes/);
  });
});
