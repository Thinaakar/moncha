'use client';

import { useState } from 'react';

export function WebsiteCheckButton({ leadId }: { leadId: string }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setMsg('Queuing website check…');
    try {
      const res = await fetch(`/api/v1/leads/${leadId}/website-check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        setMsg(data.error?.message || data.error || 'Failed to queue check');
        return;
      }
      setMsg(`Website check job ${data.id} (${data.status}). Refresh in a few seconds.`);
    } catch {
      setMsg('Failed to queue website check');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={run} disabled={busy}>
        {busy ? 'Queuing…' : 'Run website check'}
      </button>
      {msg && <div className="notice" style={{ marginTop: 10 }}>{msg}</div>}
    </div>
  );
}
