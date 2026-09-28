import { describe, expect, it } from 'vitest';
import { matchAssistantSignatures, looksParked, looksLikeEmptySpa } from './signatures';
import { htmlPassToAuditResult } from './html-pass';

describe('assistant signatures', () => {
  it('detects Intercom', () => {
    const hits = matchAssistantSignatures('<script src="https://widget.intercom.io/widget/abc"></script>');
    expect(hits[0]?.vendor).toBe('Intercom');
  });

  it('does not treat WhatsApp / Facebook / Telegram / LINE / Viber links as assistants', () => {
    const html = `
      <a href="https://wa.me/6591234567" class="whatsapp-widget whatsapp-float"><i class="fa-whatsapp"></i></a>
      <a href="https://api.whatsapp.com/send?phone=65">Chat</a>
      <a href="https://m.me/smileclinic">Messenger</a>
      <div class="fb-customerchat"></div>
      <script src="https://connect.facebook.net/en_US/sdk.js"></script>
      <a href="https://t.me/smile">Telegram</a>
      <a href="https://line.me/R/ti/p/@smile">LINE</a>
      <a href="viber://chat?number=65">Viber</a>`;
    expect(matchAssistantSignatures(html)).toEqual([]);
  });

  it('does not flag Zendesk Help Center assets or HubSpot tracking as chat', () => {
    expect(matchAssistantSignatures('<script src="https://static.zdassets.com/hc/assets/app.js"></script>')).toEqual([]);
    expect(matchAssistantSignatures('<script src="https://js.hs-scripts.com/123.js"></script>')).toEqual([]);
  });

  it('still detects Zendesk chat and HubSpot conversations', () => {
    expect(
      matchAssistantSignatures('<script id="ze-snippet" src="https://static.zdassets.com/ekr/snippet.js?key=x"></script>')[0]
        ?.vendor,
    ).toBe('Zendesk');
    expect(matchAssistantSignatures('<script src="https://js.usemessages.com/conversations-embed.js"></script>')[0]?.vendor).toBe(
      'HubSpot',
    );
  });

  it('detects providers ported from phase1', () => {
    const cases: Array<[string, string]> = [
      ['<script src="//code.jivosite.com/widget/abc"></script>', 'JivoChat'],
      ['<script src="https://www.smartsuppchat.com/loader.js"></script>', 'Smartsupp'],
      ['<script src="https://beacon-v2.helpscout.net"></script>', 'Help Scout'],
      ['<script src="https://cdn.botpress.cloud/webchat/v2/inject.js"></script>', 'Botpress'],
      ['<script src="https://leadbooster-chat.pipedrive.com/assets/loader.js"></script>', 'Pipedrive LeadBooster'],
    ];
    for (const [html, vendor] of cases) {
      expect(matchAssistantSignatures(html)[0]?.vendor).toBe(vendor);
    }
  });

  it('detects parked pages', () => {
    expect(looksParked('This domain is for sale', 'Parked')).toBe(true);
  });

  it('detects empty SPA shells', () => {
    expect(looksLikeEmptySpa('<html><body><div id="root"></div><script src="app.js"></script></body></html>')).toBe(
      true,
    );
  });
});

describe('htmlPassToAuditResult', () => {
  it('never returns NO_ASSISTANT for inaccessible', () => {
    const result = htmlPassToAuditResult({
      ok: false,
      websiteStatus: 'INACCESSIBLE',
      failureReason: 'timeout',
      assistantHits: [],
      channels: [],
      ambiguous: true,
    });
    expect(result.verdict).toBe('NOT_APPLICABLE');
    expect(result.verdict).not.toBe('NO_ASSISTANT');
  });

  it('generic-only HTML hits are UNCERTAIN, not HAS_ASSISTANT', () => {
    const result = htmlPassToAuditResult({
      ok: true,
      websiteStatus: 'ACTIVE',
      finalUrl: 'https://example.com',
      httpStatus: 200,
      html: '<div data-chat-widget></div>',
      assistantHits: matchAssistantSignatures('<div data-chat-widget></div>'),
      channels: [],
      ambiguous: false,
    });
    expect(result.verdict).toBe('UNCERTAIN');
    expect(result.failureReason).toBe('generic_pattern_only');
  });

  it('caps Pass-1-only no-assistant at 0.6 (below qualify threshold)', () => {
    const result = htmlPassToAuditResult({
      ok: true,
      websiteStatus: 'ACTIVE',
      finalUrl: 'https://example.com',
      httpStatus: 200,
      html: '<html><body><h1>Dental clinic Singapore</h1><p>Book an appointment with our dentists today.</p></body></html>',
      assistantHits: [],
      channels: [],
      ambiguous: false,
      contentHash: 'abc',
    });
    expect(result.verdict).toBe('NO_ASSISTANT');
    expect(result.confidence).toBe(0.6);
    expect(result.confidence).toBeLessThan(0.8);
  });
});
