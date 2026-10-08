import type { SiteBrand, SiteEvidence } from '../ports/site';

type Company = { name: string; phone?: string | null; address?: string | null };

function flattenJsonLd(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) value.forEach((v) => flattenJsonLd(v, out));
  else if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    out.push(obj);
    if (obj['@graph']) flattenJsonLd(obj['@graph'], out);
  }
  return out;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

function addressText(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (v && typeof v === 'object') {
    const a = v as Record<string, unknown>;
    const parts = [a.streetAddress, a.addressLocality, a.addressRegion, a.postalCode, a.addressCountry]
      .map((p) => (typeof p === 'string' ? p : p && typeof p === 'object' ? str((p as Record<string, unknown>).name) : null))
      .filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }
  return null;
}

function platformOf(url: string): string {
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  })();
  const known: Record<string, string> = {
    'facebook.com': 'facebook',
    'instagram.com': 'instagram',
    'twitter.com': 'x',
    'x.com': 'x',
    'linkedin.com': 'linkedin',
    'youtube.com': 'youtube',
    'tiktok.com': 'tiktok',
    'threads.net': 'threads',
    'line.me': 'line',
    't.me': 'telegram',
  };
  for (const [domain, name] of Object.entries(known)) if (host === domain || host.endsWith(`.${domain}`)) return name;
  if (host.includes('pinterest.')) return 'pinterest';
  return host;
}

const pickColor = (evidence: SiteEvidence, usages: string[]) =>
  evidence.colors.find((c) => usages.includes(c.usage) && !/^#(f{6}|0{6})$/i.test(c.value))?.value ?? null;

/** Brand built only from page evidence (meta, JSON-LD, links, computed styles); used when the LLM is skipped. */
export function brandFromEvidence(evidence: SiteEvidence, company: Company): SiteBrand {
  const nodes = flattenJsonLd(evidence.jsonLd);
  const business = nodes.find((n) => {
    const type = ([] as unknown[]).concat(n['@type'] ?? []).join(' ');
    return /LocalBusiness|Organization|Store|Clinic|Dentist|Restaurant|Physician|Hotel|Service/i.test(type);
  });
  const ldPhone = str(business?.telephone);
  const ldEmail = str(business?.email)?.replace(/^mailto:/i, '') ?? null;
  const sameAs = ([] as unknown[]).concat(business?.sameAs ?? []).filter((u): u is string => typeof u === 'string');
  const social = [...new Set([...evidence.links.social, ...sameAs])].slice(0, 8);
  const name = str(business?.name) ?? evidence.meta['og:site_name'] ?? company.name ?? evidence.title;
  const logo = evidence.logoCandidates.find((c) => c.assetId && c.source === 'img' && c.inHeader) ??
    evidence.logoCandidates.find((c) => c.assetId && c.source === 'img') ??
    evidence.logoCandidates.find((c) => c.assetId);
  const phones = [...new Set([...evidence.links.tel, ...(ldPhone ? [ldPhone] : [])])].slice(0, 3);
  const emails = [...new Set([...evidence.links.mailto, ...(ldEmail ? [ldEmail] : [])])].slice(0, 3);
  const bodyFont = evidence.fonts.find((f) => f.usage === 'body')?.family ?? null;
  const headingFont = evidence.fonts.find((f) => f.usage === 'heading')?.family ?? bodyFont;
  const displayName = name ?? 'our team';

  return {
    businessName: name ?? null,
    logo: logo?.assetId ? { assetId: logo.assetId } : null,
    colors: {
      primary: pickColor(evidence, ['button-background', 'header-background', 'link']),
      secondary: pickColor(evidence, ['header-background', 'footer-background']),
      accent: pickColor(evidence, ['link', 'heading']),
      background: evidence.colors.find((c) => c.usage === 'body-background')?.value ?? null,
      text: evidence.colors.find((c) => c.usage === 'body-text')?.value ?? null,
    },
    fonts: { heading: headingFont, body: bodyFont },
    contact: {
      phones,
      emails,
      address: addressText(business?.address) ?? company.address ?? null,
      whatsapp: evidence.links.whatsapp[0] ?? null,
    },
    services: [],
    hours: [],
    hoursText: str(business?.openingHours) ?? null,
    socialLinks: social.map((url) => ({ platform: platformOf(url), url })),
    language: evidence.lang,
    tone: null,
    chatbot: {
      greeting: `Hi! Welcome to ${displayName}. How can we help you today?`,
      faqs: [],
    },
    confidence: 0.3,
    notes: 'Built from page evidence without the LLM.',
    source: 'evidence',
  };
}
