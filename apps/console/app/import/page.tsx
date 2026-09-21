'use client';

import { useState } from 'react';

export default function ImportPage() {
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const file = (e.currentTarget.elements.namedItem('file') as HTMLInputElement)?.files?.[0];
    if (!file) {
      setMsg('Choose a CSV file');
      return;
    }
    const csv = await file.text();
    const res = await fetch('/api/v1/source-imports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'csv', csv }),
    });
    const data = await res.json();
    setMsg(res.ok ? `Job created: ${data.id} (${data.status})` : data.error?.message || data.error);
  }

  return (
    <main>
      <h1>Import CSV</h1>
      <div className="card">
        <p>CSV is a secondary fallback. Columns: name, domain/website, country, city, phone, address.</p>
        <form onSubmit={submit}>
          <input name="file" type="file" accept=".csv,text/csv" required />
          <br />
          <br />
          <button>Import</button>
        </form>
        {msg && <p>{msg}</p>}
      </div>
    </main>
  );
}
