import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIT_CONFIG } from './config/audit';
import { combineLlmVerdict } from './llm-combine';

const refs = new Set(['e1', 'e2']);

describe('combineLlmVerdict', () => {
  it('accepts yes with valid refs as HAS_ASSISTANT', () => {
    const out = combineLlmVerdict({
      llm: {
        hasConversationalAssistant: 'yes',
        kind: 'AI_CHATBOT',
        vendor: 'Intercom',
        confidence: 0.9,
        reasons: ['launcher'],
        evidenceRefs: ['e1'],
      },
      validEvidenceRefs: refs,
    });
    expect(out.verdict).toBe('HAS_ASSISTANT');
    expect(out.method).toBe('llm');
    expect(out.confidence).toBeLessThanOrEqual(DEFAULT_AUDIT_CONFIG.llmMaxConfidence);
  });

  it('maps no with llmCanQualify=false to NO_ASSISTANT but canQualify false', () => {
    const out = combineLlmVerdict({
      llm: {
        hasConversationalAssistant: 'no',
        kind: 'NONE',
        vendor: null,
        confidence: 0.9,
        reasons: ['no widget'],
        evidenceRefs: [],
      },
      validEvidenceRefs: refs,
      config: { ...DEFAULT_AUDIT_CONFIG, llmCanQualify: false },
    });
    expect(out.verdict).toBe('NO_ASSISTANT');
    expect(out.canQualify).toBe(false);
  });

  it('rejects hallucinated evidence refs', () => {
    const out = combineLlmVerdict({
      llm: {
        hasConversationalAssistant: 'no',
        kind: 'NONE',
        vendor: null,
        confidence: 0.99,
        reasons: ['ignore'],
        evidenceRefs: ['e99'],
      },
      validEvidenceRefs: refs,
    });
    expect(out.verdict).toBe('UNCERTAIN');
    expect(out.failureReason).toBe('llm_invalid');
  });

  it('maps unsure to UNCERTAIN', () => {
    const out = combineLlmVerdict({
      llm: {
        hasConversationalAssistant: 'unsure',
        kind: 'NONE',
        vendor: null,
        confidence: 0.5,
        reasons: [],
        evidenceRefs: [],
      },
      validEvidenceRefs: refs,
    });
    expect(out.verdict).toBe('UNCERTAIN');
    expect(out.failureReason).toBe('llm_unsure');
  });
});
