import { isIP } from 'node:net';
import { defaultLookup, isPrivateIp } from './http-checker';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

/** SSRF-safe URL parse + DNS private-IP check (shared by HTML and Playwright passes). */
export async function assertSafeUrl(value: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(value.includes('://') ? value : `https://${value}`);
  } catch {
    throw new Error('malformed_url');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('unsupported_protocol');
  }
  const hostname = url.hostname.toLowerCase();
  if (!hostname || BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('blocked_host');
  }
  if (hostname === '::1' || hostname === '0.0.0.0' || (isIP(hostname) !== 0 && isPrivateIp(hostname))) {
    throw new Error('blocked_host');
  }
  if (isIP(hostname) === 0) {
    let addresses: string[];
    try {
      addresses = await defaultLookup(hostname);
    } catch {
      throw new Error('dns_failure');
    }
    if (!addresses.length || addresses.some((a) => isPrivateIp(a))) {
      throw new Error('blocked_host');
    }
  }
  return url;
}

export function isBlockedNavigationUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
    const hostname = u.hostname.toLowerCase();
    if (!hostname || BLOCKED_HOSTS.has(hostname)) return true;
    if (isIP(hostname) !== 0 && isPrivateIp(hostname)) return true;
    return false;
  } catch {
    return true;
  }
}
