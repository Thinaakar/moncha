import { describe, expect, it } from 'vitest';
import { BrandExtractionError, type SiteEvidence } from '@moncha/domain';
import type { CompleteJsonWithImagesInput, MultimodalJsonClient } from './openrouter';
import { GeminiBrandExtractor, groundBrand } from './site-brand';

const evidence: SiteEvidence = {
  title: 'Smile Dental',
  description: 'Family dentist in Kuala Lumpur',
  lang: 'en',
  visibleText: 'Smile Dental. Call +60 3-1234 5678 or email hello@smile.my. Open Mon-Fri 9am-6pm.',
  meta: { 'og:site_name': 'Smile Dental' },
  jsonLd: [{ '@type': 'Dentist', name: 'Smile Dental', sameAs: ['https://www.instagram.com/smiledental/'] }],
  links: { tel: ['+60312345678'], mailto: ['hello@smile.my'], whatsapp: ['https://wa.me/60123456789'], social: ['https://facebook.com/smiledental'] },
  colors: [{ value: '#0ea5e9', usage: 'button-background', count: 4 }],
  fonts: [{ family: 'Inter', usage: 'body' }],
  logoCandidates: [{ assetId: 'a_logo', url: 'https://smile.my/logo.png', inHeader: true, source: 'img' }],
  sourceTextLength: 100,
  renderedTextLength: 100,
};

const company = { name: 'Smile Dental Sdn Bhd', domain: 'smile.my', phone: null, address: null, country: 'MY' };

const goodReply = {
  businessName: 'Smile Dental',
  logo: { assetId: 'a_logo' },
  colors: { primary: '#0EA5E9', secondary: null, accent: 'blue', background: '#ffffff', text: '#111111' },
  fonts: { heading: 'Inter', body: 'Inter' },
  contact: {
    phones: ['+60 3-1234 5678', '+60 9-9999 9999'],
    emails: ['hello@smile.my', 'fake@smile.my'],
    address: null,
    whatsapp: 'https://wa.me/60123456789',
  },
  services: ['Braces', 'Cleaning'],
  hours: [{ days: 'Mon-Fri', opens: '09:00', closes: '18:00' }],
  hoursText: null,
  socialLinks: [
    { platform: 'facebook', url: 'https://www.facebook.com/smiledental/' },
    { platform: 'instagram', url: 'https://instagram.com/smiledental' },
    { platform: 'tiktok', url: 'https://tiktok.com/@made-up' },
  ],
  language: 'en',
  tone: 'friendly',
  chatbot: { greeting: 'Hi! How can Smile Dental help?', faqs: [{ question: 'Are you open Saturday?', answer: 'We are open Mon-Fri.' }] },
  confidence: 0.8,
  notes: null,
};

class FakeClient implements MultimodalJsonClient {
  calls: CompleteJsonWithImagesInput<unknown>[] = [];
  constructor(private replies: Array<unknown | Error>) {}
  async completeJsonWithImages<T>(input: CompleteJsonWithImagesInput<T>) {
    this.calls.push(input as CompleteJsonWithImagesInput<unknown>);
    const next = this.replies.shift();
    if (next instanceof Error) throw next;
    return { data: input.parse(next), usage: { promptTokens: 100, completionTokens: 50 }, model: 'google/gemini-3.5-flash' };
  }
}

function budget(limit: number) {
  const state = { calls: 0, failed: 0 };
  return {
    state,
    budget: {
      allow: async () => state.calls < limit,
      record: async (failed: boolean) => {
        state.calls += 1;
        if (failed) state.failed += 1;
      },
    },
  };
}

describe('GeminiBrandExtractor', () => {
  it('validates, normalizes and grounds the reply', async () => {
    const client = new FakeClient([goodReply]);
    const b = budget(10);
    const result = await new GeminiBrandExtractor({ client }).extract({
      evidence,
      company,
      screenshots: { desktopViewport: new Uint8Array([1]), mobileViewport: new Uint8Array([2]) },
      budget: b.budget,
    });
    expect(client.calls[0]!.images).toHaveLength(2);
    expect(result.brand.colors.primary).toBe('#0ea5e9');
    expect(result.brand.colors.accent).toBeNull();
    expect(result.brand.contact.phones).toEqual(['+60 3-1234 5678']);
    expect(result.brand.contact.emails).toEqual(['hello@smile.my']);
    expect(result.brand.socialLinks.map((s) => s.platform)).toEqual(['facebook', 'instagram']);
    expect(result.brand.logo).toEqual({ assetId: 'a_logo' });
    expect(result.brand.source).toBe('llm');
    expect(result.warnings).toEqual(expect.arrayContaining(['brand_dropped_phones:1', 'brand_dropped_emails:1', 'brand_dropped_social:1']));
    expect(result.usage).toEqual({ promptTokens: 100, completionTokens: 50 });
    expect(b.state).toEqual({ calls: 1, failed: 0 });
  });

  it('makes one repair call on a schema failure', async () => {
    const client = new FakeClient([{ businessName: 'x' }, goodReply]);
    const b = budget(10);
    const result = await new GeminiBrandExtractor({ client }).extract({ evidence, company, screenshots: {}, budget: b.budget });
    expect(client.calls).toHaveLength(2);
    expect(client.calls[1]!.text).toContain('did not match');
    expect(result.usage.promptTokens).toBe(200);
    expect(b.state.calls).toBe(2);
  });

  it('fails after a second invalid reply', async () => {
    const client = new FakeClient([{}, {}]);
    await expect(new GeminiBrandExtractor({ client }).extract({ evidence, company, screenshots: {} })).rejects.toMatchObject({
      reason: 'invalid_output',
    });
  });

  it('refuses to call when the budget is exhausted', async () => {
    const client = new FakeClient([goodReply]);
    const b = budget(0);
    const error = await new GeminiBrandExtractor({ client })
      .extract({ evidence, company, screenshots: {}, budget: b.budget })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BrandExtractionError);
    expect((error as BrandExtractionError).reason).toBe('budget_exhausted');
    expect(client.calls).toHaveLength(0);
  });

  it('records failed calls against the budget', async () => {
    const client = new FakeClient([new Error('openrouter_http_500: boom')]);
    const b = budget(10);
    await expect(new GeminiBrandExtractor({ client }).extract({ evidence, company, screenshots: {}, budget: b.budget })).rejects.toMatchObject({
      reason: 'llm_failed',
    });
    expect(b.state).toEqual({ calls: 1, failed: 1 });
  });
});

describe('groundBrand', () => {
  it('drops an unknown logo id and WhatsApp number', () => {
    const { brand, warnings } = groundBrand(
      {
        ...(goodReply as never),
        logo: { assetId: 'a_made_up' },
        contact: { phones: [], emails: [], address: null, whatsapp: '+1 555 0100' },
        source: 'llm',
      },
      evidence,
      company,
    );
    expect(brand.logo).toBeNull();
    expect(brand.contact.whatsapp).toBeNull();
    expect(warnings).toEqual(expect.arrayContaining(['brand_dropped_logo', 'brand_dropped_whatsapp']));
  });
});
