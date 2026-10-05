import type { Mailer, PasswordResetEmail } from '@moncha/domain';

const RESEND_URL = 'https://api.resend.com/emails';
/** Resend's shared test sender; it only delivers to the Resend account owner's address. */
const DEFAULT_FROM = 'MonCha <onboarding@resend.dev>';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function passwordResetEmailContent(email: PasswordResetEmail) {
  const minutes = Math.max(1, Math.round((email.expiresAt.getTime() - Date.now()) / 60_000));
  const greeting = email.name ? `Hi ${email.name},` : 'Hi,';
  const text = [
    greeting,
    '',
    'We received a request to reset your MonCha password. Open this link to choose a new one:',
    email.resetUrl,
    '',
    `The link works once and expires in ${minutes} minutes.`,
    "If you didn't ask for this, you can ignore this email; your password stays the same.",
  ].join('\n');
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">
<p>${escapeHtml(greeting)}</p>
<p>We received a request to reset your MonCha password.</p>
<p><a href="${escapeHtml(email.resetUrl)}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;text-decoration:none;border-radius:6px">Reset password</a></p>
<p style="color:#555">Or paste this link into your browser:<br><a href="${escapeHtml(email.resetUrl)}">${escapeHtml(email.resetUrl)}</a></p>
<p style="color:#555">The link works once and expires in ${minutes} minutes. If you didn't ask for this, you can ignore this email.</p>
</div>`;
  return { subject: 'Reset your MonCha password', text, html };
}

export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string = DEFAULT_FROM,
    // Wrapped: Cloudflare Workers throw "Illegal invocation" when fetch is called as a method.
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init),
  ) {}

  async sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    const content = passwordResetEmailContent(email);
    const response = await this.fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: this.from, to: [email.to], ...content }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new Error(`resend_${response.status}: ${detail}`);
    }
  }
}

/** Null when RESEND_API_KEY is unset, so callers can report "email not configured". */
export function createResendMailerFromEnv(env: Record<string, unknown>): ResendMailer | null {
  const apiKey = typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '';
  if (!apiKey) return null;
  const from = typeof env.EMAIL_FROM === 'string' && env.EMAIL_FROM.trim() ? env.EMAIL_FROM.trim() : undefined;
  return new ResendMailer(apiKey, from);
}
