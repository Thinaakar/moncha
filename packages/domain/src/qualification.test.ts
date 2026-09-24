import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIT_CONFIG } from './config/audit';
import { qualifyLead, type QualificationInput } from './qualification';

const cases: Array<{ name: string; input: QualificationInput; queue: string; review: boolean }> = [
  {
    name: 'missing website',
    input: { websiteStatus: 'MISSING', verdict: 'NOT_APPLICABLE', confidence: 1 },
    queue: 'NO_WEBSITE',
    review: false,
  },
  {
    name: 'parked',
    input: { websiteStatus: 'PARKED', verdict: 'NOT_APPLICABLE', confidence: 1 },
    queue: 'INACTIVE',
    review: false,
  },
  {
    name: 'inaccessible',
    input: { websiteStatus: 'INACCESSIBLE', verdict: 'UNCERTAIN', confidence: 0 },
    queue: 'INACTIVE',
    review: false,
  },
  {
    name: 'unchecked',
    input: { websiteStatus: 'UNCHECKED', verdict: 'NOT_APPLICABLE', confidence: 0 },
    queue: 'PENDING_AUDIT',
    review: false,
  },
  {
    name: 'has assistant',
    input: { websiteStatus: 'ACTIVE', verdict: 'HAS_ASSISTANT', confidence: 0.99 },
    queue: 'HAS_ASSISTANT',
    review: false,
  },
  {
    name: 'no assistant at threshold',
    input: { websiteStatus: 'ACTIVE', verdict: 'NO_ASSISTANT', confidence: 0.8 },
    queue: 'QUALIFIED',
    review: false,
  },
  {
    name: 'no assistant just below threshold',
    input: { websiteStatus: 'ACTIVE', verdict: 'NO_ASSISTANT', confidence: 0.799 },
    queue: 'NEEDS_REVIEW',
    review: true,
  },
  {
    name: 'uncertain',
    input: { websiteStatus: 'ACTIVE', verdict: 'UNCERTAIN', confidence: 0.5 },
    queue: 'NEEDS_REVIEW',
    review: true,
  },
];

describe('qualifyLead', () => {
  for (const c of cases) {
    it(c.name, () => {
      const out = qualifyLead(c.input, DEFAULT_AUDIT_CONFIG);
      expect(out.queue).toBe(c.queue);
      expect(out.needsReviewTask).toBe(c.review);
    });
  }
});
