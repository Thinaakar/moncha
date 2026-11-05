import { describe, expect, it } from 'vitest';
import { sumCrawlResults } from './repositories/crawl-pipeline';

describe('sumCrawlResults', () => {
  it("adds up found and duplicate places from today's crawl results", () => {
    expect(
      sumCrawlResults([
        { found: 40, created: 30, duplicates: 10 },
        { found: 12, duplicates: 2, stoppedReason: 'max_searches_reached' },
      ]),
    ).toEqual({ found: 52, duplicates: 12 });
  });

  it('ignores crawls that are still running or have a malformed result', () => {
    expect(sumCrawlResults([null, undefined, {}, 'oops', { found: '5', duplicates: Number.NaN }, { found: 3 }])).toEqual({
      found: 3,
      duplicates: 0,
    });
  });
});
