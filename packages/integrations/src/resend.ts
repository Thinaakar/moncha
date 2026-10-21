import type { ColdEmailPayload, Mailer, PasswordResetEmail } from '@moncha/domain';
import {
  coldEmailContent,
  getColdEmailDevInboxes,
  isColdEmailDevMode,
  isColdEmailRecipientAllowed,
} from './cold-email';

const RESEND_URL = 'https://api.resend.com/emails';
/** Resend's shared test sender; it only delivers to the Resend account owner's address. */
const DEFAULT_FROM = 'MonCha <onboarding@resend.dev>';
const COLD_FROM_DEFAULT = 'Moncha <support@jobteacher.pro>';

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

export type ColdEmailSendResult = { id: string };

export class ResendMailer implements Mailer {
  constructor(
    private apiKey: string,
    private from: string = DEFAULT_FROM,
    // Wrapped: Cloudflare Workers throw "Illegal invocation" when fetch is called as a method.
    private fetchImpl: typeof fetch = (input, init) => fetch(input, init),
    private coldFrom: string = COLD_FROM_DEFAULT,
  ) {}

  async sendPasswordReset(email: PasswordResetEmail): Promise<void> {
    const content = passwordResetEmailContent(email);
    await this.postEmail({ from: this.from, to: [email.to], ...content });
  }

  /**
   * Sends a cold outreach email to one or multiple recipients.
   * In development mode, all recipients must be approved dev inboxes.
   * All recipients must pass the allowlist / kill-switch check (`isColdEmailRecipientAllowed`).
   */
  async sendColdEmail(email: ColdEmailPayload, env: Record<string, unknown> = process.env): Promise<ColdEmailSendResult> {
    const rawList = Array.isArray(email.to) ? email.to : [email.to];
    const recipients = rawList
      .flatMap((s) => (typeof s === 'string' ? s.split(',') : []))
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (!recipients.length) {
      throw new Error('cold_email_blocked: no recipients specified');
    }

    if (isColdEmailDevMode(env)) {
      const devInboxes = getColdEmailDevInboxes(env);
      for (const r of recipients) {
        if (!devInboxes.includes(r)) {
          throw new Error(`cold_email_blocked: recipient ${r} is not an approved development inbox`);
        }
      }
    }

    for (const r of recipients) {
      if (!isColdEmailRecipientAllowed(r, env)) {
        throw new Error(`cold_email_blocked: recipient ${r} is not on COLD_EMAIL_ALLOWLIST or sending is disabled`);
      }
    }

    const content = coldEmailContent({
      companyName: email.companyName,
      demoUrl: email.demoUrl,
      note: email.note,
      logoUrl: typeof env.COLD_EMAIL_LOGO_URL === 'string' ? env.COLD_EMAIL_LOGO_URL : undefined,
    });
    const id = await this.postEmail({
      from: this.coldFrom,
      to: recipients,
      subject: email.subject ?? content.subject,
      text: content.text,
      html: content.html,
    });
    return { id };
  }

  private async postEmail(body: Record<string, unknown>): Promise<string> {
    const response = await this.fetchImpl(RESEND_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    const raw = await response.text().catch(() => '');
    if (!response.ok) {
      throw new Error(`resend_${response.status}: ${raw.slice(0, 300)}`);
    }
    try {
      const parsed = JSON.parse(raw) as { id?: string };
      return typeof parsed.id === 'string' ? parsed.id : '';
    } catch {
      return '';
    }
  }
}

/** Null when RESEND_API_KEY is unset, so callers can report "email not configured". */
export function createResendMailerFromEnv(env: Record<string, unknown>): ResendMailer | null {
  const apiKey = typeof env.RESEND_API_KEY === 'string' ? env.RESEND_API_KEY.trim() : '';
  if (!apiKey) return null;
  const from = typeof env.EMAIL_FROM === 'string' && env.EMAIL_FROM.trim() ? env.EMAIL_FROM.trim() : undefined;
  const coldFrom =
    typeof env.COLD_EMAIL_FROM === 'string' && env.COLD_EMAIL_FROM.trim()
      ? env.COLD_EMAIL_FROM.trim()
      : from && from.includes('support@jobteacher.pro')
        ? from
        : COLD_FROM_DEFAULT;
  return new ResendMailer(apiKey, from, (input, init) => fetch(input, init), coldFrom);
}
