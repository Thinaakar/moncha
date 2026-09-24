import type { AuditConfig } from './config/audit';
import { DEFAULT_AUDIT_CONFIG } from './config/audit';
import type { AssistantVerdict, LeadQueue, WebsiteStatus } from './ports';

export type QualificationInput = {
  websiteStatus: WebsiteStatus;
  verdict: AssistantVerdict;
  confidence: number;
};

export type QualificationOutcome = {
  queue: LeadQueue;
  needsReviewTask: boolean;
  reason: string;
};

/**
 * Pure qualification rule (FR-020..027 first segment).
 * qualified ≡ queue === QUALIFIED (derived in contracts; never stored).
 */
export function qualifyLead(
  input: QualificationInput,
  config: AuditConfig = DEFAULT_AUDIT_CONFIG,
): QualificationOutcome {
  const { websiteStatus, verdict, confidence } = input;

  if (websiteStatus === 'MISSING') {
    return { queue: 'NO_WEBSITE', needsReviewTask: false, reason: 'no_website' };
  }

  if (websiteStatus === 'UNCHECKED') {
    return { queue: 'PENDING_AUDIT', needsReviewTask: false, reason: 'pending_audit' };
  }

  if (websiteStatus === 'INACTIVE' || websiteStatus === 'PARKED' || websiteStatus === 'INACCESSIBLE') {
    return {
      queue: 'INACTIVE',
      needsReviewTask: false,
      reason: `website_${websiteStatus.toLowerCase()}`,
    };
  }

  if (verdict === 'NOT_APPLICABLE') {
    return { queue: 'NO_WEBSITE', needsReviewTask: false, reason: 'no_website' };
  }

  // ACTIVE
  if (verdict === 'HAS_ASSISTANT') {
    return { queue: 'HAS_ASSISTANT', needsReviewTask: false, reason: 'has_assistant' };
  }

  if (verdict === 'NO_ASSISTANT') {
    if (confidence >= config.minConfidence) {
      return { queue: 'QUALIFIED', needsReviewTask: false, reason: 'no_assistant_high_confidence' };
    }
    return {
      queue: 'NEEDS_REVIEW',
      needsReviewTask: true,
      reason: 'no_assistant_below_confidence',
    };
  }

  // UNCERTAIN
  return { queue: 'NEEDS_REVIEW', needsReviewTask: true, reason: 'uncertain' };
}
