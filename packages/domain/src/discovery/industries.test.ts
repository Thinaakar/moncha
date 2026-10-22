import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INDUSTRIES,
  DEFAULT_INDUSTRY_ITEMS,
  normalizeIndustrySlug,
} from './industries';

describe('industries domain catalog', () => {
  it('contains exactly 30 default industries', () => {
    expect(DEFAULT_INDUSTRY_ITEMS).toHaveLength(30);
    expect(DEFAULT_INDUSTRIES).toHaveLength(30);
  });

  it('has unique slugs and non-empty categories for every default industry', () => {
    const slugs = new Set<string>();
    for (const item of DEFAULT_INDUSTRY_ITEMS) {
      expect(item.name.trim()).toBeTruthy();
      expect(item.slug.trim()).toBeTruthy();
      expect(item.category.trim()).toBeTruthy();
      expect(slugs.has(item.slug)).toBe(false);
      slugs.add(item.slug);
    }
  });

  it('maps DEFAULT_INDUSTRIES exactly to the slugs in DEFAULT_INDUSTRY_ITEMS', () => {
    const expected = DEFAULT_INDUSTRY_ITEMS.map((i) => i.slug);
    expect(DEFAULT_INDUSTRIES).toEqual(expected);
  });

  describe('normalizeIndustrySlug', () => {
    it('trims and lowercases input', () => {
      expect(normalizeIndustrySlug('  Medical Clinic  ')).toBe('medical clinic');
      expect(normalizeIndustrySlug('DENTIST')).toBe('dentist');
    });

    it('collapses multiple whitespace and punctuation', () => {
      expect(normalizeIndustrySlug('Solar   Panel   Cleaning')).toBe('solar panel cleaning');
      expect(normalizeIndustrySlug('Pet-Grooming_Service')).toBe('pet grooming service');
    });

    it('removes special characters and symbols', () => {
      expect(normalizeIndustrySlug('Car Wash & Detailing!')).toBe('car wash detailing');
      expect(normalizeIndustrySlug('Law #1 Firm')).toBe('law 1 firm');
    });
  });
});
