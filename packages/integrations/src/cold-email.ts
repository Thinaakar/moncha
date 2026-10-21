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

/** What the visitor-facing assistant does, in the business owner's terms. */
const BENEFITS: Array<{ title: string; text: string }> = [
  { title: 'Accurate answers', text: 'Replies only from your own website content and shows where each answer comes from.' },
  { title: 'Available 24/7', text: 'Answers common questions instantly, day or night, in 24 languages.' },
  { title: 'Leads and bookings', text: 'Captures enquiries and appointment requests and passes them to your team.' },
];

const NAME_BREAKS = [' - ', ' – ', ' — ', ' | ', ' @ ', '(', ','];
const LEGAL_SUFFIX = /\s+(pte\.?\s*ltd\.?|sdn\.?\s*bhd\.?|private\s+limited|ltd\.?|llc|inc\.?)$/i;

/** "Earth Interior Design Pte Ltd" -> "Earth Interior Design"; "Pepper Kitchen - Causeway Point" -> "Pepper Kitchen". */
export function shortCompanyName(name: string): string {
  let short = name.trim();
  for (const sep of NAME_BREAKS) {
    const at = short.indexOf(sep);
    if (at > 0) short = short.slice(0, at);
  }
  return short.trim().replace(LEGAL_SUFFIX, '').trim() || name.trim();
}

export function coldEmailContent(input: ColdEmailContentInput) {
  const name = shortCompanyName(input.companyName) || 'there';
  const greeting = name === 'there' ? 'Hi there,' : `Hi ${name} team,`;
  const subject = `Your AI support assistant demo for ${name}`;
  const intro = `We have built an AI support assistant for ${name}, trained on the content of your website. It answers your visitors' questions around the clock and hands over to your team whenever it cannot help.`;
  const note = input.note?.trim();
  const demoUrl = input.demoUrl;
  const text = [
    greeting,
    '',
    intro,
    ...(note ? ['', note] : []),
    '',
    'What your assistant can do:',
    ...BENEFITS.map((b) => `- ${b.title}: ${b.text}`),
    '',
    'Click to view demo:',
    demoUrl,
    '',
    'Best regards,',
    'The MonCha team',
    'https://moncha.co/',
  ].join('\n');

  const benefits = BENEFITS.map(
    (b, i) => `
<tr>
  <td width="28" style="width:28px;padding:${i ? '14px' : '0'} 0 0;vertical-align:top">
    <div style="width:20px;height:20px;border-radius:10px;background:#e8f0fe;color:#2563eb;font-size:12px;font-weight:700;line-height:20px;text-align:center">&#10003;</div>
  </td>
  <td style="padding:${i ? '14px' : '0'} 0 0;vertical-align:top">
    <p style="margin:0;font-size:15px;line-height:20px;font-weight:600;color:#0f172a">${escapeHtml(b.title)}</p>
    <p style="margin:2px 0 0;font-size:14px;line-height:1.5;color:#475569">${escapeHtml(b.text)}</p>
  </td>
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
          <td style="padding:36px 32px 8px">
            <h1 style="margin:0 0 24px;font-size:22px;line-height:1.35;color:#0f172a;font-weight:700">Your AI support assistant is ready</h1>
            <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#0f172a">${escapeHtml(greeting)}</p>
            <p style="margin:0 0 ${note ? '10px' : '28px'};font-size:15px;line-height:1.6;color:#334155">${escapeHtml(intro)}</p>
            ${note ? `<p style="margin:0 0 28px;font-size:13px;line-height:1.5;color:#94a3b8">${escapeHtml(note)}</p>` : ''}
            <p style="margin:0 0 16px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#64748b">What your assistant can do</p>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 32px">
              ${benefits}
            </table>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
              <tr><td style="padding:20px 22px">
                <p style="margin:0 0 6px;font-size:14px;font-weight:600;color:#0f172a">Click to view demo:</p>
                <p style="margin:0 0 18px;font-size:14px;line-height:1.5;word-break:break-all"><a href="${escapeHtml(demoUrl)}" style="color:#2563eb;text-decoration:underline">${escapeHtml(demoUrl)}</a></p>
                <a href="${escapeHtml(demoUrl)}" style="display:inline-block;padding:12px 24px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600">Open demo</a>
              </td></tr>
            </table>
            <p style="margin:32px 0 0;font-size:15px;line-height:1.6;color:#334155">Best regards,<br><span style="color:#0f172a;font-weight:600">The MonCha team</span></p>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 32px 32px">
            <p style="margin:0;padding-top:20px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.6;color:#94a3b8">
              MonCha · AI customer support for your website ·
              <a href="https://moncha.co/" style="color:#64748b;text-decoration:underline">moncha.co</a>
            </p>
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

/** The two approved development inboxes for testing without emailing real customers. */
export const APPROVED_DEV_INBOXES = ['vinothjv4.tech@gmail.com', 'thinaakark2004@gmail.com'] as const;

/**
 * Returns whether cold email is running in development mode (fails closed to true by default).
 * Only returns false if explicitly disabled with COLD_EMAIL_DEV_MODE=false AND NODE_ENV=production.
 */
export function isColdEmailDevMode(env: Record<string, unknown>): boolean {
  const devMode = env.COLD_EMAIL_DEV_MODE;
  if (devMode === 'false' || devMode === false) {
    if (env.NODE_ENV === 'production' && env.COLD_EMAIL_PRODUCTION_CONFIRMED === 'true') {
      return false;
    }
  }
  return true;
}

/**
 * Returns the approved development inboxes from env or defaults to APPROVED_DEV_INBOXES.
 * Validates each email; fails closed if any email is invalid.
 */
export function getColdEmailDevInboxes(env: Record<string, unknown>): string[] {
  const raw = typeof env.COLD_EMAIL_DEV_INBOXES === 'string' ? env.COLD_EMAIL_DEV_INBOXES.trim() : '';
  if (!raw) {
    return [...APPROVED_DEV_INBOXES];
  }
  const parts = raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length) {
    return [...APPROVED_DEV_INBOXES];
  }
  for (const email of parts) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new Error(`invalid_dev_inbox: "${email}" is not a valid email address`);
    }
  }
  return parts;
}

