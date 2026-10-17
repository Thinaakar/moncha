/** Digest-style cold outreach HTML (matches MonCha chat-summary mail layout). */

export type ColdEmailContentInput = {
  companyName: string;
  demoUrl: string;
  /** Optional secondary line under the intro. */
  note?: string;
  /** Header logo; must be a public https PNG (Gmail and Outlook do not show SVG). Defaults to COLD_EMAIL_LOGO_URL. */
  logoUrl?: string;
};

/** The console's favicon as a 112 px PNG (apps/console/public/brand/mark-email.png), public without login. */
export const COLD_EMAIL_LOGO_URL = 'https://moncha-console.vinothjv4-tech.workers.dev/brand/mark-email.png';

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const FEATURES: Array<{ label: string; value: string }> = [
  { label: 'Grounded answers', value: 'Only from your knowledge base, with sources' },
  { label: 'Fair quotas', value: 'One message = one answer — questions are free' },
  { label: 'Independent bots', value: 'Own knowledge, design, and embed per bot' },
];

const SERVICES =
  'Website widget · Voice · WhatsApp · Email inbox · Leads · Tickets · Bookings · Analytics';

export function coldEmailContent(input: ColdEmailContentInput) {
  const name = input.companyName.trim() || 'there';
  const greeting = `Hi ${name},`;
  const subject = `We built a MonCha support demo for ${name}`;
  const note =
    input.note?.trim() ||
    'Open the live demo to see how MonCha would answer visitors from your own site content.';
  const text = [
    greeting,
    '',
    `We trained a MonCha AI support agent on your website and published a live demo.`,
    note,
    '',
    'Highlights:',
    ...FEATURES.map((f) => `- ${f.label}: ${f.value}`),
    '',
    `Services: ${SERVICES}`,
    '',
    `Open demo: ${input.demoUrl}`,
    '',
    '— MonCha',
    'https://moncha.co/',
  ].join('\n');

  const rows = FEATURES.map(
    (f, i) => `
<tr>
  <td style="padding:12px 0;${i < FEATURES.length - 1 ? 'border-bottom:1px solid #e5e7eb;' : ''}font-size:14px;color:#4b5563">${escapeHtml(f.label)}</td>
  <td style="padding:12px 0;${i < FEATURES.length - 1 ? 'border-bottom:1px solid #e5e7eb;' : ''}font-size:14px;color:#111827;font-weight:600;text-align:right">${escapeHtml(f.value)}</td>
</tr>`,
  ).join('');

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.06)">
        <tr>
          <td style="background:#2563eb;padding:20px 28px">
            <table role="presentation" cellpadding="0" cellspacing="0"><tr>
              <td style="width:28px;height:28px;vertical-align:middle"><img src="${escapeHtml(input.logoUrl?.trim() || COLD_EMAIL_LOGO_URL)}" width="28" height="28" alt="MonCha" style="display:block;width:28px;height:28px;border:0;border-radius:6px"></td>
              <td style="padding-left:10px;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.02em">MonCha</td>
            </tr></table>
          </td>
        </tr>
        <tr>
          <td style="padding:32px 28px 8px">
            <h1 style="margin:0 0 20px;font-size:24px;line-height:1.3;color:#0f172a;font-weight:700">Boost your support with MonCha AI</h1>
            <p style="margin:0 0 12px;font-size:15px;line-height:1.5;color:#111827">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 8px;font-size:15px;line-height:1.5;color:#374151">We trained a MonCha AI support agent on your website and published a live demo for you.</p>
            <p style="margin:0 0 24px;font-size:13px;line-height:1.5;color:#9ca3af">${escapeHtml(note)}</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:10px;padding:4px 16px;margin:0 0 16px">
              ${rows}
            </table>
            <p style="margin:0 0 28px;font-size:13px;line-height:1.5;color:#6b7280">${escapeHtml(SERVICES)}</p>
            <a href="${escapeHtml(input.demoUrl)}" style="display:inline-block;padding:12px 22px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Open demo</a>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 28px 32px;font-size:12px;color:#9ca3af">
            <a href="https://moncha.co/" style="color:#2563eb;text-decoration:none">moncha.co</a>
            · Docs: <a href="https://moncha.co/docs/" style="color:#2563eb;text-decoration:none">moncha.co/docs</a>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}

/** Parse COLD_EMAIL_ALLOWLIST. Empty = nobody. `*` = any address (production open). */
export function parseColdEmailAllowlist(raw: string | undefined | null): { open: boolean; emails: Set<string> } {
  const parts = (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (parts.includes('*')) return { open: true, emails: new Set() };
  return { open: false, emails: new Set(parts) };
}

export function coldEmailSendingEnabled(env: Record<string, unknown>): boolean {
  const v = env.COLD_EMAIL_SENDING_ENABLED;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.trim().toLowerCase());
  return false;
}

export function isColdEmailRecipientAllowed(to: string, env: Record<string, unknown>): boolean {
  if (!coldEmailSendingEnabled(env)) return false;
  const allow = parseColdEmailAllowlist(
    typeof env.COLD_EMAIL_ALLOWLIST === 'string' ? env.COLD_EMAIL_ALLOWLIST : '',
  );
  if (allow.open) return true;
  return allow.emails.has(to.trim().toLowerCase());
}
