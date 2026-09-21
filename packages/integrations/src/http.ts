import { canonicalDomain } from '@moncha/domain';

const DIRECTORY_DOMAINS = new Set([
  'yelp.com',
  'foursquare.com',
  'facebook.com',
  'instagram.com',
  'twitter.com',
  'x.com',
  'linkedin.com',
  'tripadvisor.com',
  'google.com',
  'maps.google.com',
  'goo.gl',
  'bing.com',
  'apple.com',
]);

export function firstPartyWebsite(value?: string): string | undefined {
  const domain = canonicalDomain(value);
  if (!domain) return undefined;
  const root = domain.split('.').slice(-2).join('.');
  if (DIRECTORY_DOMAINS.has(domain) || DIRECTORY_DOMAINS.has(root)) return undefined;
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
