import type { AuditConfig } from './config/audit';
import { DEFAULT_AUDIT_CONFIG } from './config/audit';
import type { AssistantKind, AssistantVerdict, AuditMethod } from './ports';

export type LlmClassifyOutput = {
  hasConversationalAssistant: 'yes' | 'no' | 'unsure';
  kind: AssistantKind;
  vendor: string | null;
  confidence: number;
  reasons: string[];
  evidenceRefs: string[];
};

export type LlmCombineInput = {
  llm: LlmClassifyOutput;
  validEvidenceRefs: Set<string>;
  config?: AuditConfig;
};

export type LlmCombineResult = {
  verdict: AssistantVerdict;
  kind: AssistantKind;
  vendor: string | null;
  confidence: number;
  method: AuditMethod;
  failureReason?: string;
  /** When false, queue must be NEEDS_REVIEW even if verdict is NO_ASSISTANT. */
  canQualify: boolean;
};

/**
 * Combine a validated Pass-3 LLM result into a verdict.
 * Invalid refs → caller should treat as invalid (retry / UNCERTAIN), not call this.
 */
export function combineLlmVerdict(input: LlmCombineInput): LlmCombineResult {
  const config = input.config ?? DEFAULT_AUDIT_CONFIG;
  const { llm, validEvidenceRefs } = input;

  for (const ref of llm.evidenceRefs) {
    if (!validEvidenceRefs.has(ref)) {
      return {
        verdict: 'UNCERTAIN',
        kind: 'NONE',
        vendor: null,
        confidence: 0,
        method: 'llm',
        failureReason: 'llm_invalid',
        canQualify: false,
      };
    }
  }

  const capped = Math.min(llm.confidence, config.llmMaxConfidence);

  if (llm.hasConversationalAssistant === 'yes' && llm.confidence >= config.llmYesMinConfidence) {
    return {
      verdict: 'HAS_ASSISTANT',
      kind: llm.kind === 'NONE' ? 'AI_CHATBOT' : llm.kind,
      vendor: llm.vendor,
      confidence: capped,
      method: 'llm',
      canQualify: false,
    };
  }

  if (llm.hasConversationalAssistant === 'no' && llm.confidence >= config.llmNoMinConfidence) {
    return {
      verdict: 'NO_ASSISTANT',
      kind: 'NONE',
      vendor: null,
      confidence: capped,
      method: 'llm',
      canQualify: config.llmCanQualify,
    };
  }

  return {
    verdict: 'UNCERTAIN',
    kind: 'NONE',
    vendor: null,
    confidence: capped,
    method: 'llm',
    failureReason: 'llm_unsure',
    canQualify: false,
  };
}
