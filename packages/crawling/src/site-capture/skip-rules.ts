/** Analytics, tag managers, ad networks and session recorders: never needed to render the page. */
const TRACKING_HOSTS = [
  'google-analytics.com',
  'analytics.google.com',
  'googletagmanager.com',
  'googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'adservice.google.com',
  'stats.g.doubleclick.net',
  'connect.facebook.net',
  'facebook.com/tr',
  'hotjar.com',
  'hotjar.io',
  'clarity.ms',
  'segment.com',
  'segment.io',
  'mixpanel.com',
  'amplitude.com',
  'heap.io',
  'heapanalytics.com',
  'fullstory.com',
  'mouseflow.com',
  'crazyegg.com',
  'luckyorange.com',
  'quantserve.com',
  'scorecardresearch.com',
  'bat.bing.com',
  'snap.licdn.com',
  'px.ads.linkedin.com',
  'analytics.tiktok.com',
  'ads-twitter.com',
  'static.ads-twitter.com',
  'analytics.twitter.com',
  'cdn.mxpnl.com',
  'newrelic.com',
  'nr-data.net',
  'browser-intake-datadoghq.com',
  'sentry.io',
  'plausible.io',
  'matomo.cloud',
  'yandex.ru/metrika',
  'mc.yandex.ru',
  'adroll.com',
  'taboola.com',
  'outbrain.com',
  'criteo.com',
  'criteo.net',
];

export function isTrackingUrl(rawUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  const hostPath = `${host}${url.pathname}`.toLowerCase();
  return TRACKING_HOSTS.some((entry) =>
    entry.includes('/') ? hostPath.startsWith(entry) || hostPath.includes(`.${entry}`) : host === entry || host.endsWith(`.${entry}`),
  );
}

/** URLs that are inline or runtime-only and never fetched: left untouched in the copy. */
export function isInlineOrNonFetchable(value: string): 'inline' | 'blob' | 'unsupported' | 'fragment' | null {
  const v = value.trim().toLowerCase();
  if (!v) return 'unsupported';
  if (v.startsWith('#')) return 'fragment';
  if (v.startsWith('data:')) return 'inline';
  if (v.startsWith('blob:')) return 'blob';
  if (/^(javascript|about|mailto|tel|sms|chrome|file|filesystem|ws|wss):/.test(v)) return 'unsupported';
  return null;
}
