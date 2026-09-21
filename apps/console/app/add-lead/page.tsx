'use client';

import { useState } from 'react';

export default function AddLead() {
  const [msg, setMsg] = useState('');

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const value = (name: string) => {
      const raw = String(f.get(name) || '').trim();
      return raw || undefined;
    };
    const res = await fetch('/api/v1/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: value('name'),
        domain: value('domain'),
        country: value('country'),
        city: value('city'),
        phone: value('phone'),
        address: value('address'),
      }),
    });
    const data = await res.json();
    setMsg(res.ok ? `Created ${data.company?.name}` : data.error?.message || data.error);
  }

  return (
    <main>
      <h1>Add lead</h1>
      <div className="card">
        <form onSubmit={submit}>
          {['name', 'domain', 'country', 'city', 'phone', 'address'].map((x) => (
            <div key={x} style={{ marginBottom: 10 }}>
              <input name={x} placeholder={x} required={x === 'name'} />
            </div>
          ))}
          <button>Create</button>
        </form>
        {msg && <p>{msg}</p>}
      </div>
    </main>
  );
}
