const WHITESPACE = /\s+/g;

export function normalizeWhitespace(value: string): string {
  return value.trim().replace(WHITESPACE, ' ');
}

export function normalizeCompanyName(value: string): string {
  return normalizeWhitespace(value);
}

export function normalizeCountry(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeWhitespace(value);
  return normalized || undefined;
}

export function normalizeCity(value?: string): string | undefined {
  if (!value) return undefined;
  const normalized = normalizeWhitespace(value);
  return normalized || undefined;
}

function stripDefaultPort(url: URL): void {
  if (
    (url.protocol === 'https:' && url.port === '443') ||
    (url.protocol === 'http:' && url.port === '80')
  ) {
    url.port = '';
  }
}

export function parseHttpUrl(value?: string): URL | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  try {
    const url = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    if (!url.hostname) return undefined;
    url.hostname = url.hostname.toLowerCase();
    stripDefaultPort(url);
    return url;
  } catch {
    return undefined;
  }
}

export function normalizeWebsiteUrl(value?: string): string | undefined {
  const url = parseHttpUrl(value);
  if (!url) return undefined;
  url.hash = '';
  let href = url.toString();
  if (url.pathname === '/' && !url.search) {
    href = href.replace(/\/$/, '');
  }
  return href;
}

export function canonicalDomain(value?: string): string | undefined {
  const url = parseHttpUrl(value);
  if (!url) return undefined;
  const host = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
  return host || undefined;
}
