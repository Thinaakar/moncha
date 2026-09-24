import type { AssistantKind } from '../ports';

export type AuditConfig = {
  classifierVersion: string;
  minConfidence: number;
  /** Kinds that count as "has assistant" for disqualification. */
  disqualifyingKinds: AssistantKind[];
  /** Cap on LLM-derived confidence stored on the audit. */
  llmMaxConfidence: number;
  /** When false (default), LLM "no assistant" never qualifies — goes to Needs review. */
  llmCanQualify: boolean;
  /** Min LLM confidence for yes → HAS_ASSISTANT. */
  llmYesMinConfidence: number;
  /** Min LLM confidence for no → NO_ASSISTANT (still gated by llmCanQualify). */
  llmNoMinConfidence: number;
  llmPromptVersion: string;
  reauditAfterDays: number;
};

export const DEFAULT_AUDIT_CONFIG: AuditConfig = {
  classifierVersion: 'assistants-v1',
  minConfidence: 0.8,
  disqualifyingKinds: ['AI_CHATBOT', 'LIVE_CHAT'],
  llmMaxConfidence: 0.85,
  llmCanQualify: false,
  llmYesMinConfidence: 0.7,
  llmNoMinConfidence: 0.85,
  llmPromptVersion: 'assistant-classify-v1',
  reauditAfterDays: 30,
};

export function isDisqualifyingKind(kind: AssistantKind, config: AuditConfig = DEFAULT_AUDIT_CONFIG): boolean {
  return config.disqualifyingKinds.includes(kind);
}
