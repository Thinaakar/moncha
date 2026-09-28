import type { ChannelType, DetectedChannelInput } from '@moncha/domain';

export type MessagingChannel = 'whatsapp' | 'messenger' | 'telegram' | 'line' | 'viber';

const MESSAGING_HOSTS: Array<{ type: MessagingChannel; hosts: string[]; pathPrefix?: string }> = [
  { type: 'whatsapp', hosts: ['wa.me', 'wa.link', 'api.whatsapp.com', 'chat.whatsapp.com'] },
  { type: 'whatsapp', hosts: ['web.whatsapp.com'], pathPrefix: '/send' },
  { type: 'messenger', hosts: ['m.me'] },
  { type: 'messenger', hosts: ['messenger.com', 'www.messenger.com'], pathPrefix: '/t/' },
  { type: 'messenger', hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com'], pathPrefix: '/messages/' },
  { type: 'telegram', hosts: ['t.me', 'telegram.me'] },
  { type: 'line', hosts: ['line.me', 'lin.ee', 'page.line.me'] },
  { type: 'viber', hosts: ['invite.viber.com', 'chats.viber.com'] },
];

const MESSAGING_SCHEMES: Array<{ type: MessagingChannel; scheme: string }> = [
  { type: 'whatsapp', scheme: 'whatsapp:' },
  { type: 'messenger', scheme: 'fb-messenger:' },
  { type: 'telegram', scheme: 'tg:' },
  { type: 'line', scheme: 'line:' },
  { type: 'viber', scheme: 'viber:' },
];

/** Classify a messaging-app link. Returns null for anything that is not a messaging app. */
export function messagingChannelOf(href: string): MessagingChannel | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  const scheme = url.protocol.toLowerCase();
  const byScheme = MESSAGING_SCHEMES.find((s) => s.scheme === scheme);
  if (byScheme) return byScheme.type;
  if (scheme !== 'http:' && scheme !== 'https:') return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  for (const entry of MESSAGING_HOSTS) {
    if (!entry.hosts.includes(host)) continue;
    if (entry.pathPrefix && !path.startsWith(entry.pathPrefix)) continue;
    return entry.type;
  }
  return null;
}

/** Map an href to a contact channel type (tel/email/messaging/booking/contact). */
export function classifyChannelHref(href: string, baseUrl: string): { type: ChannelType; url: string } | null {
  const lower = href.trim().toLowerCase();
  if (!lower || lower.startsWith('javascript:') || lower.startsWith('#')) return null;
  let abs: string;
  try {
    abs = new URL(href.trim(), baseUrl).toString();
  } catch {
    return null;
  }
  if (lower.startsWith('tel:')) return { type: 'tel', url: abs };
  if (lower.startsWith('mailto:')) return { type: 'email', url: abs };
  const messaging = messagingChannelOf(abs);
  if (messaging) return { type: messaging, url: abs };
  if (/book|appointment|reserv/i.test(lower)) return { type: 'booking_link', url: abs };
  if (/contact/i.test(lower)) return { type: 'contact_form', url: abs };
  return null;
}

export function extractChannelsFromHtml(html: string, baseUrl: string): DetectedChannelInput[] {
  const channels: DetectedChannelInput[] = [];
  const seen = new Set<string>();
  const hrefRe = /href=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = hrefRe.exec(html))) {
    const classified = classifyChannelHref(m[1] || '', baseUrl);
    if (!classified) continue;
    const key = `${classified.type}:${classified.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    channels.push({ ...classified, sourcePage: baseUrl });
  }
  return channels.slice(0, 20);
}
