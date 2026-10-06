'use client';

import { useState } from 'react';

export function WebsiteCheckButton({ leadId, disabled = false }: { leadId: string; disabled?: boolean }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setMsg('Queuing website audit…');
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/website-check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error?.message || data.error || 'Failed to queue audit');
        return;
      }
      setMsg(`Website audit job ${data.id} (${data.status}). Worker will process it when available.`);
    } catch {
      setMsg('Failed to queue website audit');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="check-action">
      <button type="button" onClick={run} disabled={busy || disabled}>
        {busy ? 'Queuing…' : 'Check again'}
      </button>
      {disabled ? <p className="muted">Connect a database to run website checks.</p> : null}
      {msg ? <div className="notice">{msg}</div> : null}
    </div>
  );
}
