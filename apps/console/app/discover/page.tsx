'use client';

import { useState } from 'react';

export default function Discover() {
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const res = await fetch('/api/v1/source-imports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        source: String(f.get('source') || 'google_places'),
        country: String(f.get('country')),
        city: String(f.get('city')),
        keyword: String(f.get('keyword')),
      }),
    });
    const data = await res.json();
    setMsg(res.ok ? `Job created: ${data.id} (${data.status})` : data.error?.message || data.error);
  }

  return (
    <main>
      <h1>Discover</h1>
      <div className="card">
        <form onSubmit={submit}>
          <select name="source" defaultValue="google_places">
            <option value="google_places">Google Places</option>
            <option value="yelp">Yelp</option>
            <option value="foursquare">Foursquare</option>
            <option value="search">Search API</option>
            <option value="all">All configured sources</option>
          </select>
          <br />
          <br />
          <input name="country" placeholder="Country" defaultValue="Singapore" required />
          <br />
          <br />
          <input name="city" placeholder="City" defaultValue="Singapore" required />
          <br />
          <br />
          <input name="keyword" placeholder="Keyword / industry" defaultValue="dental clinics" required />
          <br />
          <br />
          <button>Start auto discovery</button>
        </form>
        <p>All sources share the same normalize → canonical domain → dedupe → Neon → website check pipeline.</p>
        {msg && <p>{msg}</p>}
      </div>
    </main>
  );
}
