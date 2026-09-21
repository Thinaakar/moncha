import { describe, expect, it } from 'vitest';
import {
  canonicalDomain,
  normalizeCity,
  normalizeCompanyName,
  normalizeCountry,
  normalizeWebsiteUrl,
} from './company';

describe('company normalization', () => {
  it('normalizes company names', () => {
    expect(normalizeCompanyName('  Acme   Dental  ')).toBe('Acme Dental');
  });

  it('normalizes country and city', () => {
    expect(normalizeCountry('  Singapore ')).toBe('Singapore');
    expect(normalizeCity('  Singapore  City ')).toBe('Singapore City');
  });

  it('normalizes website URLs', () => {
    expect(normalizeWebsiteUrl('https://www.example.com/')).toBe('https://www.example.com');
    expect(normalizeWebsiteUrl('EXAMPLE.COM')).toBe('https://example.com');
  });

  it('extracts one canonical domain from equivalent URLs', () => {
    const values = [
      'https://example.com',
      'http://www.example.com/',
      'EXAMPLE.COM',
      'https://www.example.com/',
      'http://EXAMPLE.COM',
    ];
    const domains = values.map((value) => canonicalDomain(value));
    expect(new Set(domains)).toEqual(new Set(['example.com']));
  });

  it('rejects non-http URLs', () => {
    expect(canonicalDomain('ftp://example.com')).toBeUndefined();
    expect(normalizeWebsiteUrl('javascript:alert(1)')).toBeUndefined();
  });
});
