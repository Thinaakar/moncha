import { describe, expect, it } from 'vitest';
import { omitChatbotSitesEnabled } from './flags';

describe('omitChatbotSitesEnabled', () => {
  it('defaults to false', () => {
    expect(omitChatbotSitesEnabled({})).toBe(false);
  });

  it('reads OMIT_CHATBOT_SITES and omit_chatbot_sites', () => {
    expect(omitChatbotSitesEnabled({ OMIT_CHATBOT_SITES: 'true' })).toBe(true);
    expect(omitChatbotSitesEnabled({ omit_chatbot_sites: 'true' })).toBe(true);
    expect(omitChatbotSitesEnabled({ OMIT_CHATBOT_SITES: 'false' })).toBe(false);
  });
});
