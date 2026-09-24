'use client';

import Link from 'next/link';
import { useState } from 'react';

export default function ImportPage() {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = (e.currentTarget.elements.namedItem('file') as HTMLInputElement)?.files?.[0];
    if (!file) {
      setOk(false);
      setMsg('Choose a CSV file');
      return;
    }
    setBusy(true);
    setOk(false);
    try {
      const csv = await file.text();
      const res = await fetch('/api/v1/source-imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'csv', csv }),
      });
      const data = await res.json();
      if (res.ok) {
        setOk(true);
        setMsg(`Job created: ${data.id} (${data.status}). Check Jobs or Leads shortly.`);
      } else {
        setMsg(data.error?.message || data.error || 'Import failed');
      }
    } catch {
      setMsg('Import failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main>
      <div className="page-head">
        <div>
          <h1>Import CSV</h1>
          <p>Secondary fallback only. Prefer Discover for new company lists.</p>
        </div>
        <Link href="/discover" className="btn">
          Prefer Discover
        </Link>
      </div>

      <div className="card">
        <p className="muted">
          Columns: <code>name</code>, <code>domain</code>/<code>website</code>, <code>country</code>,{' '}
          <code>city</code>, <code>phone</code>, <code>address</code>.
        </p>
        <form className="form-grid" onSubmit={submit} style={{ marginTop: 14 }}>
          <label>
            CSV file
            <input name="file" type="file" accept=".csv,text/csv" required />
          </label>
          <button disabled={busy}>{busy ? 'Importing…' : 'Import CSV'}</button>
        </form>
        {msg && <div className={ok ? 'notice success' : 'notice error'}>{msg}</div>}
      </div>
    </main>
  );
}
