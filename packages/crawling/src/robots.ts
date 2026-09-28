import { assertSafeUrl } from './url-safety';

const ROBOTS_TIMEOUT_MS = 8_000;
const UA_TOKEN = 'MonChaLeadEngine';

export type RobotsCheckResult = {
  allowed: boolean;
  failureReason?: string;
};

/**
 * Minimal robots.txt check for the homepage path.
 * If robots.txt is missing/unreachable → allow (common for small business sites).
 * If Disallow applies to our UA or `*` for `/` → not allowed.
 */
export async function checkRobotsAllowed(pageUrl: string): Promise<RobotsCheckResult> {
  let page: URL;
  try {
    page = await assertSafeUrl(pageUrl);
  } catch (error) {
    return {
      allowed: false,
      failureReason: error instanceof Error ? error.message : 'blocked_host',
    };
  }

  const robotsUrl = new URL('/robots.txt', page.origin).toString();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
    const response = await fetch(robotsUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'user-agent': `${UA_TOKEN}/1.0 (+website-audit)` },
    });
    clearTimeout(timer);

    if (response.status === 404 || response.status === 410) {
      return { allowed: true };
    }
    if (!response.ok) {
      // Unreadable robots → allow crawl (do not block audits on flaky robots).
      return { allowed: true };
    }

    const text = (await response.text()).slice(0, 100_000);
    const allowed = isPathAllowedByRobots(text, page.pathname || '/', UA_TOKEN);
    return allowed
      ? { allowed: true }
      : { allowed: false, failureReason: 'robots_disallowed' };
  } catch {
    return { allowed: true };
  }
}

/** Parse robots.txt groups; return false if the matching UA group disallows the path. */
export function isPathAllowedByRobots(robotsText: string, path: string, userAgent: string): boolean {
  const lines = robotsText.split(/\r?\n/).map((l) => l.replace(/#.*$/, '').trim());
  type Group = { agents: string[]; rules: Array<{ allow: boolean; prefix: string }> };
  const groups: Group[] = [];
  let current: Group | null = null;

  for (const line of lines) {
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      const agent = value.toLowerCase();
      if (!current || current.rules.length > 0) {
        current = { agents: [agent], rules: [] };
        groups.push(current);
      } else {
        current.agents.push(agent);
      }
      continue;
    }
    if (!current) continue;
    if (key === 'disallow') {
      current.rules.push({ allow: false, prefix: value });
    } else if (key === 'allow') {
      current.rules.push({ allow: true, prefix: value });
    }
  }

  const ua = userAgent.toLowerCase();
  const matching =
    groups.find((g) => g.agents.some((a) => a !== '*' && (ua.includes(a) || a.includes(ua)))) ??
    groups.find((g) => g.agents.includes('*'));

  if (!matching) return true;

  // Longest matching prefix wins (Allow can override Disallow).
  let best: { allow: boolean; len: number } | null = null;
  for (const rule of matching.rules) {
    if (rule.prefix === '') continue; // Disallow: with empty = allow all
    if (!path.startsWith(rule.prefix) && rule.prefix !== '/') continue;
    const len = rule.prefix.length;
    if (!best || len > best.len) best = { allow: rule.allow, len };
  }
  if (!best) return true;
  return best.allow;
}
