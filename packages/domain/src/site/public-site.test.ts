import { describe, expect, it } from 'vitest';
import { parsePublicSitePath, publicSiteUrl } from './public-site';

const ID = 'cmv4xvpje00rzny0urf1ewcu5';

describe('publicSiteUrl', () => {
  it('builds the demo link under the base', () => {
    expect(publicSiteUrl('https://moncha-sites.pages.dev/', 'spacerent.sg', ID)).toBe(
      `https://moncha-sites.pages.dev/sites/spacerent.sg/${ID}/demo.html`,
    );
  });
});

describe('parsePublicSitePath', () => {
  it('reads the domain, copy and file', () => {
    expect(parsePublicSitePath(`spacerent.sg/${ID}/assets/cdn.example.com/app~a1b2.css`)).toEqual({
      domain: 'spacerent.sg',
      copyId: ID,
      file: 'assets/cdn.example.com/app~a1b2.css',
    });
  });

  it('treats the copy root as no file', () => {
    expect(parsePublicSitePath(`spacerent.sg/${ID}`)?.file).toBeNull();
    expect(parsePublicSitePath(`spacerent.sg/${ID}/`)?.file).toBeNull();
  });

  it('decodes encoded file names', () => {
    expect(parsePublicSitePath(`a.com/${ID}/assets/a.com/my%20logo.png`)?.file).toBe('assets/a.com/my logo.png');
  });

  it('rejects paths that could leave the copy', () => {
    for (const rest of [
      `a.com/${ID}/../other/demo.html`,
      `a.com/${ID}/assets/%2e%2e/x`,
      `a.com/${ID}/assets//x`,
      `a.com/${ID}/a%2Fb`,
      `a.com/${ID}/a%5Cb`,
      `a.com/${ID}/%E0%A4%A`,
      `a.com/not-an-id/demo.html`,
      `bad_domain!/${ID}/demo.html`,
      `a.com`,
    ]) {
      expect(parsePublicSitePath(rest), rest).toBeNull();
    }
  });
});
