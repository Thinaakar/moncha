'use client';

import { useState, type ChangeEvent, type FormEvent } from 'react';
import { locationText } from '@/lib/ui';

type Fields = { name: string; domain: string; phone: string; city: string; country: string; address: string };

const EMPTY: Fields = { name: '', domain: '', phone: '', city: '', country: '', address: '' };

export function AddLeadForm() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [ok, setOk] = useState(false);

  function update(event: ChangeEvent<HTMLInputElement>) {
    setFields((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setOk(false);
    const value = (name: keyof Fields) => fields[name].trim() || undefined;
    try {
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
      if (res.ok) {
        setOk(true);
        setMsg(
          data.duplicate
            ? `Existing company reused: ${data.company?.name}`
            : `Created ${data.company?.name}`,
        );
        setFields(EMPTY);
      } else {
        setMsg(data.error?.message || data.error || 'Failed to create lead');
      }
    } catch {
      setMsg('Failed to create lead');
    } finally {
      setBusy(false);
    }
  }

  const name = fields.name.trim();
  const domain = fields.domain.trim();

  return (
    <div className="add-lead-layout">
      <form className="card add-lead-form" onSubmit={submit}>
        <fieldset className="form-section">
          <legend>Company</legend>
          <div className="form-grid two">
            <label>
              Company name
              <input name="name" placeholder="Harbor Dental" value={fields.name} onChange={update} required />
            </label>
            <label>
              Domain / website
              <input name="domain" placeholder="example.com" value={fields.domain} onChange={update} />
            </label>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Contact</legend>
          <label>
            Phone
            <input name="phone" placeholder="+65 6221 4480" value={fields.phone} onChange={update} />
          </label>
        </fieldset>

        <fieldset className="form-section">
          <legend>Location</legend>
          <div className="form-grid two">
            <label>
              City
              <input name="city" placeholder="Kuala Lumpur" value={fields.city} onChange={update} />
            </label>
            <label>
              Country
              <input name="country" placeholder="Malaysia" value={fields.country} onChange={update} />
            </label>
          </div>
          <label>
            Address
            <input name="address" placeholder="163 Jalan Ampang" value={fields.address} onChange={update} />
          </label>
        </fieldset>

        <div className="form-actions">
          <button disabled={busy}>{busy ? 'Saving…' : 'Save lead'}</button>
        </div>
        {msg ? <div className={ok ? 'notice success' : 'notice error'}>{msg}</div> : null}
      </form>

      <aside className="card lead-preview" aria-label="Preview">
        <div className="lead-preview-label">Preview</div>
        <div className="lead-preview-head">
          <span className="lead-avatar lead-avatar-lg" aria-hidden="true">
            {(name.charAt(0) || '?').toUpperCase()}
          </span>
          <div>
            <strong>{name || 'Company name'}</strong>
            <span>{domain || 'No website'}</span>
          </div>
        </div>
        <span className="chip chip-amber">Pending audit</span>
        <div className="kv">
          <div className="kv-row">
            <span>Location</span>
            <span>{locationText(fields.city.trim(), fields.country.trim())}</span>
          </div>
          <div className="kv-row">
            <span>Phone</span>
            <span>{fields.phone.trim() || '—'}</span>
          </div>
        </div>
        <p className="muted">New leads start in Pending audit until their website is checked.</p>
      </aside>
    </div>
  );
}
