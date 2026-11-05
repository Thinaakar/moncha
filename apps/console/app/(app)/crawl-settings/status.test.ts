import { describe, expect, it } from 'vitest';
import { gate } from '@/test/fixtures';
import { emailDelivery } from './status';

describe('email delivery from the backend gate', () => {
  it('reports development mode first, whatever else is set', () => {
    const d = emailDelivery(gate({ isDevMode: true, allowlistOpen: true }), false);
    expect(d).toMatchObject({ label: 'Development mode', tone: 'info' });
    expect(d.detail).toContain('2 developer inboxes');
  });

  it('reports a missing Resend setup, sending off, allowlist and live delivery', () => {
    expect(emailDelivery(gate({ isDevMode: false, resendConfigured: false }), false).label).toBe('Not configured');
    expect(emailDelivery(gate({ isDevMode: false, sendingEnabled: false }), false).label).toBe('Sending off');
    expect(emailDelivery(gate({ isDevMode: false }), false)).toMatchObject({ label: 'Allowlist only', tone: 'warning' });
    expect(emailDelivery(gate({ isDevMode: false, allowlistOpen: true }), false)).toMatchObject({ label: 'Live', tone: 'success' });
  });

  it('says editors only for viewers and checking while loading', () => {
    expect(emailDelivery(undefined, true).label).toBe('Editors only');
    expect(emailDelivery(undefined, false).label).toBe('Checking…');
  });
});
