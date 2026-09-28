import { describe, expect, it } from 'vitest';
import { firstPartyDomain, isDirectoryDomain, registrableDomain } from './http';

describe('registrableDomain', () => {
  it('handles country second-level domains', () => {
    expect(registrableDomain('www.clinic.com.sg')).toBe('clinic.com.sg');
    expect(registrableDomain('shop.example.co.uk')).toBe('example.co.uk');
    expect(registrableDomain('booking.clinic.sg')).toBe('clinic.sg');
    expect(registrableDomain('clinic.example')).toBe('clinic.example');
  });
});

describe('directory detection', () => {
  it('flags social, directory and country variants', () => {
    expect(isDirectoryDomain('facebook.com')).toBe(true);
    expect(isDirectoryDomain('m.facebook.com')).toBe(true);
    expect(isDirectoryDomain('yelp.com.sg')).toBe(true);
    expect(isDirectoryDomain('tripadvisor.com.sg')).toBe(true);
    expect(isDirectoryDomain('maps.app.goo.gl')).toBe(true);
    expect(isDirectoryDomain('wa.me')).toBe(true);
  });

  it('keeps real company domains', () => {
    expect(isDirectoryDomain('smiledental.com.sg')).toBe(false);
    expect(isDirectoryDomain('clinic.wixsite.com')).toBe(false);
    expect(firstPartyDomain('https://www.smiledental.com.sg/contact')).toBe('smiledental.com.sg');
  });
});
