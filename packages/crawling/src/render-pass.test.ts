import { describe, expect, it } from 'vitest';
import { COOKIE_BUTTON_RE, renderPassToAuditResult, pickExtraPageUrls, type RenderPassResult } from './render-pass';
import { isPathAllowedByRobots } from './robots';

function basePass(over: Partial<RenderPassResult> = {}): RenderPassResult {
  return {
    ok: true,
    websiteStatus: 'ACTIVE',
    finalUrl: 'https://example.com',
    httpStatus: 200,
    httpsOk: true,
    robotsAllowed: true,
    title: 'Example',
    html: '<html><body>Hello clinic</body></html>',
    contentHash: 'abc',
    assistantHits: [],
    networkHits: [],
    channels: [],
    renderComplete: true,
    pagesVisited: ['https://example.com'],
    ...over,
  };
}

describe('renderPassToAuditResult', () => {
  it('never returns NO_ASSISTANT when render is incomplete', () => {
    const result = renderPassToAuditResult(
      basePass({
        ok: false,
        renderComplete: false,
        failureReason: 'render_timeout',
        websiteStatus: 'INACCESSIBLE',
      }),
    );
    expect(result.renderRan).toBe(true);
    expect(result.verdict).toBe('UNCERTAIN');
    expect(result.verdict).not.toBe('NO_ASSISTANT');
    expect(result.method).toBe('render');
  });

  it('returns UNCERTAIN for robots_disallowed without labeling NO_ASSISTANT', () => {
    const result = renderPassToAuditResult(
      basePass({
        ok: false,
        renderComplete: false,
        robotsAllowed: false,
        websiteStatus: 'ACTIVE',
        failureReason: 'robots_disallowed',
      }),
    );
    expect(result.verdict).toBe('UNCERTAIN');
    expect(result.failureReason).toBe('robots_disallowed');
    expect(result.robotsAllowed).toBe(false);
  });

  it('detects HAS_ASSISTANT from network hits', () => {
    const result = renderPassToAuditResult(
      basePass({
        networkHits: [
          {
            vendor: 'Intercom',
            kind: 'AI_CHATBOT',
            matched: 'https://widget.intercom.io/widget/x',
            type: 'network_request',
          },
        ],
      }),
    );
    expect(result.verdict).toBe('HAS_ASSISTANT');
    expect(result.vendor).toBe('Intercom');
    expect(result.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('returns UNCERTAIN when only generic-pattern hits', () => {
    const result = renderPassToAuditResult(
      basePass({
        assistantHits: [
          {
            vendor: 'GenericChat',
            kind: 'LIVE_CHAT',
            matched: 'live-chat-widget',
            type: 'page_excerpt',
            generic: true,
          },
        ],
      }),
    );
    expect(result.verdict).toBe('UNCERTAIN');
    expect(result.failureReason).toBe('generic_pattern_only');
  });

  it('returns high-confidence NO_ASSISTANT after successful clean render', () => {
    const result = renderPassToAuditResult(basePass());
    expect(result.verdict).toBe('NO_ASSISTANT');
    expect(result.renderRan).toBe(true);
    expect(result.confidence).toBe(0.9);
  });
});

describe('pickExtraPageUrls', () => {
  it('prefers contact + booking links from homepage', () => {
    const html = `
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/appointment">Book</a>
      <a href="/services">Services</a>
    `;
    const urls = pickExtraPageUrls(html, 'https://clinic.example/');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('/contact');
    expect(urls[1]).toMatch(/appointment|services|book/);
  });
});

describe('cookie consent button labels', () => {
  it('matches common multilingual accept labels', () => {
    for (const label of ['Accept all', 'I agree', 'Got it', 'Terima', 'Setuju', 'Benarkan semua', '接受', '同意', 'ยอมรับ', 'قبول', 'موافق']) {
      expect(COOKIE_BUTTON_RE.test(label)).toBe(true);
    }
  });

  it('does not match unrelated buttons', () => {
    for (const label of ['Book now', 'Reject all', 'Manage preferences', 'Continue to checkout', 'Contact us']) {
      expect(COOKIE_BUTTON_RE.test(label)).toBe(false);
    }
  });
});

describe('robots.txt', () => {
  it('blocks when Disallow: / for *', () => {
    const robots = `User-agent: *\nDisallow: /\n`;
    expect(isPathAllowedByRobots(robots, '/', 'MonChaLeadEngine')).toBe(false);
  });

  it('allows when Disallow is empty', () => {
    const robots = `User-agent: *\nDisallow:\n`;
    expect(isPathAllowedByRobots(robots, '/', 'MonChaLeadEngine')).toBe(true);
  });

  it('honors longer Allow over Disallow', () => {
    const robots = `User-agent: *\nDisallow: /\nAllow: /public\n`;
    expect(isPathAllowedByRobots(robots, '/public/page', 'MonChaLeadEngine')).toBe(true);
    expect(isPathAllowedByRobots(robots, '/private', 'MonChaLeadEngine')).toBe(false);
  });
});
