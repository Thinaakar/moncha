import { describe, expect, it } from 'vitest';
import { followUpPreview, hourLabel, zoneLabel } from './follow-up-time';

describe('follow-up time preview', () => {
  it("counts business days on the business's own calendar", () => {
    // Friday 17:00 UTC is already Saturday 01:00 in Singapore: the next business day there is Monday.
    const sentAt = new Date('2026-10-23T17:00:00Z');
    expect(followUpPreview(sentAt, 1, 'business_days', 10, 'Asia/Singapore')).toBe('Mon, Oct 26, 10:00 Singapore time');
    expect(followUpPreview(sentAt, 1, 'calendar_days', 9, 'Asia/Singapore')).toBe('Sun, Oct 25, 09:00 Singapore time');
    expect(followUpPreview(sentAt, 1, 'business_days', 10, 'UTC')).toBe('Mon, Oct 26, 10:00 UTC');
  });

  it('waits at least one day', () => {
    expect(followUpPreview(new Date('2026-10-22T03:00:00Z'), 0, 'calendar_days', 10, 'Asia/Tokyo')).toBe(
      'Fri, Oct 23, 10:00 Tokyo time',
    );
  });

  it('labels hours and zones', () => {
    expect(hourLabel(9)).toBe('09:00');
    expect(zoneLabel('Asia/Kuala_Lumpur')).toBe('Kuala Lumpur time');
    expect(zoneLabel('UTC')).toBe('UTC');
  });
});
