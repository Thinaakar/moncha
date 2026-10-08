import type { SiteBrand } from '../ports/site';

export const DEMO_MARKER = 'data-moncha-demo';
export const WIDGET_FILE = 'moncha-widget.js';

export type DemoConfig = {
  businessName: string | null;
  greeting: string;
  faqs: { question: string; answer: string }[];
  colors: { primary: string | null; background: string | null; text: string | null };
  phone: string | null;
  email: string | null;
  whatsapp: string | null;
  language: string | null;
  logoPath: string | null;
};

export function demoConfigFromBrand(brand: SiteBrand, logoPath: string | null): DemoConfig {
  return {
    businessName: brand.businessName,
    greeting: brand.chatbot.greeting,
    faqs: brand.chatbot.faqs.slice(0, 8),
    colors: { primary: brand.colors.primary, background: brand.colors.background, text: brand.colors.text },
    phone: brand.contact.phones[0] ?? null,
    email: brand.contact.emails[0] ?? null,
    whatsapp: brand.contact.whatsapp,
    language: brand.language,
    logoPath,
  };
}

/** JSON that is safe inside an inline <script> in any ASCII-compatible charset: pure ASCII, no `<`. */
export function scriptSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[\u007f-\uffff<>&\u2028\u2029]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/** One char per byte, so string offsets are byte offsets and any charset round-trips unchanged. */
function latin1(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    out += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return out;
}

function fromLatin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

/** Replaces `<meta http-equiv="Content-Security-Policy">` so the page's own CSP cannot block the widget. */
export function neutralizeMetaCsp(html: string): { html: string; count: number } {
  let count = 0;
  const out = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?content-security-policy["']?[^>]*>/gi, () => {
    count += 1;
    return '<meta name="moncha-removed-csp">';
  });
  return { html: out, count };
}

/**
 * Builds demo.html from index.html bytes: the widget config and loader are inserted before the last
 * `</body>` (or appended when there is none). All other bytes stay as they are.
 */
export function injectDemo(indexBytes: Uint8Array, config: DemoConfig): { bytes: Uint8Array; cspNeutralized: number } {
  const { html, count } = neutralizeMetaCsp(latin1(indexBytes));
  const snippet =
    `<script>window.__MONCHA_DEMO__=${scriptSafeJson(config)};</script>` +
    `<script src="${WIDGET_FILE}" ${DEMO_MARKER}></script>`;
  const lower = html.toLowerCase();
  const at = lower.lastIndexOf('</body');
  const out = at >= 0 ? html.slice(0, at) + snippet + html.slice(at) : html + snippet;
  return { bytes: fromLatin1(out), cspNeutralized: count };
}
