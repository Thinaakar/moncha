import { humanize } from '@/lib/format';

const FAILURES: Record<string, string> = {
  blocked_host: 'The site resolves to a private or blocked address.',
  robots_disallowed: "The site's robots.txt does not allow crawlers on the homepage.",
  blocked_or_captcha: 'The site showed a captcha or bot challenge instead of the homepage.',
  too_many_redirects: 'The homepage redirected more than 5 times.',
  not_html: 'The homepage did not return an HTML page.',
  source_too_large: 'The homepage HTML is larger than 5 MB.',
  fetch_failed: 'The homepage could not be downloaded.',
  timeout: 'The copy took longer than the time limit.',
  render_failed: 'The browser could not open the homepage.',
  worker_shutdown: 'The worker restarted during the copy; it will be retried.',
  snapshot_missing: 'The copy record was removed before the job ran.',
  invalid_payload: 'The job was queued without a URL.',
};

export function failureText(reason: string | null | undefined) {
  if (!reason) return null;
  const http = /^http_(\d{3})$/.exec(reason);
  if (http) return `The homepage answered HTTP ${http[1]}.`;
  return FAILURES[reason] ?? humanize(reason);
}

const WARNINGS: Record<string, string> = {
  js_rendered_site: 'Built with JavaScript: the served HTML has little content, so the offline copy may look incomplete.',
  meta_csp_present: 'The page has its own Content-Security-Policy tag, which may block parts of the offline copy.',
  meta_csp_neutralized: 'The page CSP tag was disabled in demo.html only, so the widget can run.',
  base_href_neutralized: 'The <base href> tag was pointed at the copy so local assets resolve.',
  rewrite_skipped_utf16: 'UTF-16 page: index.html is an unmodified copy of the source.',
  asset_limit_reached: 'Asset limit reached; some files were not copied.',
  size_limit_reached: 'Size limit reached; some files were not copied.',
  evidence_unavailable: 'Page details for the brand could not be read from the browser.',
  'llm_skipped:budget_exhausted': 'Daily AI budget used up: brand details come from the page data only.',
  'llm_skipped:llm_failed': 'The AI call failed: brand details come from the page data only.',
  'llm_skipped:invalid_output': 'The AI answer was invalid: brand details come from the page data only.',
  'llm_skipped:not_configured': 'No AI key configured: brand details come from the page data only.',
  brand_dropped_logo: 'The AI picked a logo that is not on the page; it was removed.',
  brand_dropped_whatsapp: 'The AI returned a WhatsApp link that is not on the page; it was removed.',
};

export function warningText(warning: string) {
  if (WARNINGS[warning]) return WARNINGS[warning];
  const [key, value] = warning.split(':', 2) as [string, string | undefined];
  const dropped = /^brand_dropped_(phones|emails|social)$/.exec(key);
  if (dropped) return `${value ?? 'Some'} ${dropped[1] === 'social' ? 'social link(s)' : dropped[1]} not found on the page were removed from the brand.`;
  if (key === 'mobile_capture_failed') return 'The mobile screenshot could not be taken.';
  return humanize(warning);
}

const SKIPS: Record<string, string> = {
  tracking: 'Tracking or analytics',
  too_large: 'File too large',
  limit_reached: 'Limit reached',
  blocked_host: 'Blocked host',
  http_4xx: 'Not found (4xx)',
  http_5xx: 'Server error (5xx)',
  timeout: 'Timed out',
  fetch_error: 'Download failed',
  blob_url: 'blob: URL',
  iframe_embed: 'Embedded frame',
  unsupported_scheme: 'Unsupported URL',
  inline: 'Inline data',
  fragment: 'Fragment link',
};

export function skipReasonText(reason: string) {
  return SKIPS[reason] ?? humanize(reason);
}
