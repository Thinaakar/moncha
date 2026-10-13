import { describe, expect, it } from 'vitest';
import { websiteAuditJobLeadId } from './runWebsiteAuditJob';

describe('websiteAuditJobLeadId', () => {
  it('reads the leadId column', () => {
    expect(websiteAuditJobLeadId({ leadId: 'lead1', payload: { leadId: 'other' } })).toBe('lead1');
  });

  it('falls back to payload.leadId for jobs queued before the column existed', () => {
    expect(websiteAuditJobLeadId({ leadId: null, payload: { leadId: 'lead1' } })).toBe('lead1');
    expect(websiteAuditJobLeadId({ payload: { leadId: 'lead1' } })).toBe('lead1');
  });

  it('returns null when neither has a lead', () => {
    expect(websiteAuditJobLeadId({ leadId: null, payload: {} })).toBeNull();
    expect(websiteAuditJobLeadId({ leadId: null, payload: null })).toBeNull();
    expect(websiteAuditJobLeadId({ payload: { leadId: 42 } })).toBeNull();
  });
});
