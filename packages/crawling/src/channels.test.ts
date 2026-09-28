import { describe, expect, it } from 'vitest';
import { extractChannelsFromHtml, messagingChannelOf } from './channels';

describe('messagingChannelOf', () => {
  it('classifies messaging-app links', () => {
    expect(messagingChannelOf('https://wa.me/6591234567')).toBe('whatsapp');
    expect(messagingChannelOf('https://api.whatsapp.com/send?phone=65')).toBe('whatsapp');
    expect(messagingChannelOf('whatsapp://send?phone=65')).toBe('whatsapp');
    expect(messagingChannelOf('https://m.me/smileclinic')).toBe('messenger');
    expect(messagingChannelOf('https://www.messenger.com/t/smileclinic')).toBe('messenger');
    expect(messagingChannelOf('https://t.me/smile')).toBe('telegram');
    expect(messagingChannelOf('https://line.me/R/ti/p/@smile')).toBe('line');
    expect(messagingChannelOf('https://lin.ee/abc')).toBe('line');
    expect(messagingChannelOf('viber://chat?number=65')).toBe('viber');
  });

  it('ignores lookalikes and plain social pages', () => {
    expect(messagingChannelOf('https://chat.me/x')).toBeNull();
    expect(messagingChannelOf('https://www.facebook.com/smileclinic')).toBeNull();
    expect(messagingChannelOf('https://example.com/whatsapp')).toBeNull();
  });
});

describe('extractChannelsFromHtml', () => {
  it('extracts messaging, tel, email, booking and contact channels', () => {
    const html = `
      <a href="tel:+6560000000">Call</a>
      <a href="mailto:hi@clinic.sg">Email</a>
      <a href="https://wa.me/6591234567">WhatsApp</a>
      <a href="https://m.me/clinic">Messenger</a>
      <a href="https://t.me/clinic">Telegram</a>
      <a href="/book-appointment">Book</a>
      <a href="/contact-us">Contact</a>
      <a href="https://wa.me/6591234567">dup</a>`;
    const types = extractChannelsFromHtml(html, 'https://clinic.sg/').map((c) => c.type);
    expect(types).toEqual(['tel', 'email', 'whatsapp', 'messenger', 'telegram', 'booking_link', 'contact_form']);
  });
});
