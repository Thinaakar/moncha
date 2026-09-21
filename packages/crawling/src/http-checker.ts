import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { WebsiteChecker, WebsiteResult } from '@moncha/domain';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_BYTES = 512_000;
const MAX_REDIRECTS = 3;

export type DnsResolver = (hostname: string) => Promise<string[]>;
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

const BLOCKED_HOSTS = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata',
]);

export function isPrivateIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map(Number);
    const [a, b] = parts;
    if (a === undefined || b === undefined) return true;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    if (normalized.startsWith('fe80')) return true;
    if (normalized.startsWith('::ffff:')) {
      return isPrivateIp(normalized.slice(7));
    }
    return false;
  }
  return true;
}

export async function defaultLookup(hostname: string): Promise<string[]> {
  const results = await lookup(hostname, { all: true });
  return results.map((item) => item.address);
}

export class BasicHttpWebsiteChecker implements WebsiteChecker {
  constructor(
    private options: {
      timeoutMs?: number;
      maxBytes?: number;
      lookup?: DnsResolver;
      fetch?: FetchLike;
    } = {},
  ) {}

  async check(url: string): Promise<WebsiteResult> {
    try {
      const target = await this.assertSafeUrl(url);
      return await this.fetchFollow(target, 0);
    } catch (error) {
      return {
        reachable: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async fetchFollow(url: URL, hops: number): Promise<WebsiteResult> {
    await this.assertResolved(url);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      const fetchImpl = this.options.fetch ?? fetch;
      const response = await fetchImpl(url.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': 'MonChaLeadEngine/1.0' },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return { reachable: false, httpStatus: response.status, finalUrl: url.toString(), error: 'redirect_missing_location' };
        }
        if (hops >= MAX_REDIRECTS) {
          return { reachable: false, httpStatus: response.status, finalUrl: url.toString(), error: 'too_many_redirects' };
        }
        const next = new URL(location, url);
        const safeNext = await this.assertSafeUrl(next.toString());
        return this.fetchFollow(safeNext, hops + 1);
      }

      const title = await this.readTitle(response);
      return {
        reachable: response.ok,
        finalUrl: url.toString(),
        httpStatus: response.status,
        title,
        error: response.ok ? undefined : `http_${response.status}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof Error && (error.name === 'AbortError' || message.toLowerCase().includes('abort'))) {
        return { reachable: false, error: 'timeout' };
      }
      return { reachable: false, error: message };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async readTitle(response: Response): Promise<string | undefined> {
    const maxBytes = this.options.maxBytes ?? DEFAULT_MAX_BYTES;
    const reader = response.body?.getReader();
    if (!reader) {
      const text = (await response.text()).slice(0, maxBytes);
      return extractTitle(text);
    }
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (received < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      received += value.byteLength;
    }
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
    const merged = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
    return extractTitle(merged.subarray(0, maxBytes).toString('utf8'));
  }

  private async assertSafeUrl(value: string): Promise<URL> {
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
    return url;
  }

  private async assertResolved(url: URL): Promise<void> {
    const hostname = url.hostname;
    if (isIP(hostname)) {
      if (isPrivateIp(hostname)) throw new Error('blocked_host');
      return;
    }
    const lookupFn = this.options.lookup ?? defaultLookup;
    let addresses: string[];
    try {
      addresses = await lookupFn(hostname);
    } catch {
      throw new Error('dns_failure');
    }
    if (!addresses.length || addresses.some((address) => isPrivateIp(address))) {
      throw new Error('blocked_host');
    }
  }
}

export function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = match?.[1]?.replace(/\s+/g, ' ').trim();
  return title || undefined;
}
