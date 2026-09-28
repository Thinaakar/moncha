import { canonicalDomain } from '@moncha/domain';

/** Registrable-domain labels of directories, social networks and maps — never a company's own site. */
const DIRECTORY_BRANDS = new Set([
  'yelp',
  'foursquare',
  'facebook',
  'fb',
  'instagram',
  'twitter',
  'x',
  'linkedin',
  'tiktok',
  'youtube',
  'pinterest',
  'tripadvisor',
  'google',
  'bing',
  'apple',
  'yellowpages',
  'practo',
  'healthgrades',
  'zocdoc',
  'booking',
  'agoda',
  'expedia',
  'grab',
  'foodpanda',
  'burpple',
  'hungrygowhere',
  'streetdirectory',
  'linktr',
  'whatsapp',
  'telegram',
]);

/** Exact hosts that are link shorteners / maps / messaging, regardless of label. */
const DIRECTORY_HOSTS = new Set(['goo.gl', 'maps.app.goo.gl', 'g.page', 'm.me', 't.me', 'wa.me', 'lin.ee', 'bit.ly']);

/** Second-level labels used under country TLDs, e.g. clinic.com.sg / shop.co.uk. */
const SECOND_LEVEL = new Set(['com', 'co', 'net', 'org', 'gov', 'edu', 'ac', 'or', 'ne', 'go', 'biz', 'info']);

/** Best-effort registrable domain without a public-suffix list: handles `x.com.sg`, `x.co.uk`. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const tld = parts[parts.length - 1]!;
  const sld = parts[parts.length - 2]!;
  if (tld.length === 2 && SECOND_LEVEL.has(sld)) return parts.slice(-3).join('.');
  return parts.slice(-2).join('.');
}

export function isDirectoryDomain(domain: string): boolean {
  const host = domain.toLowerCase();
  if (DIRECTORY_HOSTS.has(host)) return true;
  const label = registrableDomain(host).split('.')[0] ?? '';
  return DIRECTORY_BRANDS.has(label);
}

export function firstPartyWebsite(value?: string): string | undefined {
  const domain = canonicalDomain(value);
  if (!domain) return undefined;
  if (isDirectoryDomain(domain)) return undefined;
  return value;
}

export function firstPartyDomain(value?: string): string | undefined {
  const website = firstPartyWebsite(value);
  return website ? canonicalDomain(website) : undefined;
}

export async function readJson(response: Response, provider: string): Promise<unknown> {
  if (response.status === 429) throw new Error(`${provider} rate limited`);
  if (!response.ok) throw new Error(`${provider} HTTP ${response.status}`);
  return response.json();
}
