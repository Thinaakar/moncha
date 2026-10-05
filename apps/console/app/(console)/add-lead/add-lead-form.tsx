'use client';

import Link from 'next/link';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Icon } from '@/components/icon';
import { formatStatus, statusChip } from '@/lib/ui';

type Fields = { name: string; domain: string; phone: string; city: string; address: string };
type Saved = { name: string; leadId: string | null; queue: string; duplicate: boolean };

const EMPTY: Fields = { name: '', domain: '', phone: '', city: '', address: '' };
const COUNTRIES = [
  { code: 'SG', name: 'Singapore' },
  { code: 'MY', name: 'Malaysia' },
  { code: 'JP', name: 'Japan' },
];
const OTHER = 'other';

function cleanDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#]/)[0];
}

function looksLikeDomain(value: string) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value);
}

function NextSteps() {
  return (
    <>
      <h3>What happens next</h3>
      <ol className="add-lead-steps">
        <li>Lead is saved</li>
        <li>Website gets checked</li>
        <li>Moves to Qualified, Review or Has bot</li>
      </ol>
      <hr />
      <h3>Tips</h3>
      <ul className="add-lead-tips">
        <li>Same website means same company, so no duplicate is created.</li>
        <li>No website? The lead goes to &ldquo;No site&rdquo; and isn&apos;t checked.</li>
      </ul>
    </>
  );
}

export function AddLeadForm() {
  const nameRef = useRef<HTMLInputElement>(null);
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [countryChoice, setCountryChoice] = useState('');
  const [otherCountry, setOtherCountry] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [quickSaved, setQuickSaved] = useState<Saved | null>(null);

  const name = fields.name.trim();
  const domain = cleanDomain(fields.domain);
  const domainValid = !domain || looksLikeDomain(domain);
  const country = countryChoice === OTHER ? otherCountry.trim() : countryChoice;
  const city = fields.city.trim();
  const phone = fields.phone.trim();
  const previewQueue = domain ? 'PENDING_AUDIT' : 'NO_WEBSITE';
  const countryLabel = countryChoice === OTHER ? country : COUNTRIES.find((item) => item.name === country)?.code || '';
  const location = [city, countryLabel].filter(Boolean).join(', ');

  function update(event: ChangeEvent<HTMLInputElement>) {
    setFields((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function chooseCountry(value: string) {
    setCountryChoice((current) => (current === value ? '' : value));
  }

  function clearAll() {
    setFields(EMPTY);
    setCountryChoice('');
    setOtherCountry('');
    setError('');
    setQuickSaved(null);
    nameRef.current?.focus();
  }

  function addAnother() {
    setSaved(null);
    clearAll();
  }

  async function save(keepGoing: boolean) {
    if (!name) {
      setError('Company name is required.');
      nameRef.current?.focus();
      return;
    }
    if (!domainValid) {
      setError('The website doesn’t look right. Use something like example.com.');
      return;
    }
    setBusy(true);
    setError('');
    setQuickSaved(null);
    try {
      const res = await fetch('/api/v1/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          domain: domain || undefined,
          country: country || undefined,
          city: city || undefined,
          phone: phone || undefined,
          address: fields.address.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((typeof data.error === 'string' ? data.error : data.error?.message) || 'Failed to save lead');
        return;
      }
      const result: Saved = {
        name: data.company?.name || name,
        leadId: data.lead?.id || null,
        queue: data.lead?.queue || previewQueue,
        duplicate: Boolean(data.duplicate),
      };
      if (keepGoing) {
        setQuickSaved(result);
        setFields((current) => ({ ...EMPTY, city: current.city }));
        nameRef.current?.focus();
      } else {
        setSaved(result);
      }
    } catch {
      setError('Failed to save lead. Is the backend running?');
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(false);
  }

  if (saved) {
    const leadHref = saved.leadId ? `/leads/${encodeURIComponent(saved.leadId)}` : '/leads';
    return (
      <div className="card add-lead-done">
        <span className={saved.duplicate ? 'add-lead-done-icon is-info' : 'add-lead-done-icon'}>
          <Icon name={saved.duplicate ? 'info' : 'check'} size={26} />
        </span>
        <div className="add-lead-done-body">
          <h2>{saved.duplicate ? `${saved.name} is already saved` : `${saved.name} added`}</h2>
          <p className="muted">
            {saved.duplicate
              ? 'We matched the same website, so no duplicate was created. Empty details were filled in.'
              : saved.queue === 'NO_WEBSITE'
                ? 'It’s in No site because it has no website to check.'
                : 'It’s in Pending audit. The website check will run shortly.'}
          </p>
          <div className="add-lead-done-actions">
            <Link href={leadHref} className="btn">
              {saved.duplicate ? 'View existing lead →' : 'View lead →'}
            </Link>
            <button type="button" className="secondary" onClick={addAnother}>
              Add another
            </button>
            {saved.duplicate ? null : (
              <Link href="/leads" className="btn btn-secondary">
                Go to Leads
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="add-lead-layout">
      <form className="card add-lead-form" onSubmit={submit} noValidate>
        {quickSaved ? (
          <div className="notice success add-lead-quick">
            <span>
              {quickSaved.duplicate ? `${quickSaved.name} was already saved.` : `${quickSaved.name} added.`}
            </span>
            {quickSaved.leadId ? (
              <Link href={`/leads/${encodeURIComponent(quickSaved.leadId)}`}>View lead →</Link>
            ) : null}
          </div>
        ) : null}

        <fieldset className="form-section">
          <legend>
            <span className="add-lead-num">1</span> Company
          </legend>
          <label>
            <span>
              Company name <span className="add-lead-req">*</span>
            </span>
            <span className="field-input">
              <Icon name="building" />
              <input
                ref={nameRef}
                name="name"
                placeholder="Harbor Dental"
                value={fields.name}
                onChange={update}
                autoComplete="organization"
                autoFocus
                required
              />
            </span>
          </label>
          <label>
            Website
            <span className="field-input">
              <Icon name="globe" />
              <input
                name="domain"
                placeholder="harbordental.sg"
                value={fields.domain}
                onChange={update}
                autoComplete="url"
                inputMode="url"
              />
            </span>
            {!domain ? (
              <span className="field-hint">No website, so this lead will go to No site.</span>
            ) : domainValid ? (
              <span className="field-hint is-ok">✓ Will check: https://{domain}</span>
            ) : (
              <span className="field-hint is-bad">This doesn&apos;t look like a website. Try example.com.</span>
            )}
          </label>
        </fieldset>

        <fieldset className="form-section">
          <legend>
            <span className="add-lead-num">2</span> Contact
          </legend>
          <label>
            Phone
            <span className="field-input">
              <Icon name="phone" />
              <input
                name="phone"
                type="tel"
                placeholder="+65 6221 4480"
                value={fields.phone}
                onChange={update}
                autoComplete="tel"
              />
            </span>
          </label>
        </fieldset>

        <fieldset className="form-section">
          <legend>
            <span className="add-lead-num">3</span> Location
          </legend>
          <div className="add-lead-country">
            <span className="add-lead-label">Country</span>
            <div className="segmented" role="group" aria-label="Country">
              {COUNTRIES.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  className={countryChoice === item.name ? 'is-active' : ''}
                  onClick={() => chooseCountry(item.name)}
                  title={item.name}
                  aria-pressed={countryChoice === item.name}
                >
                  {item.code}
                </button>
              ))}
              <button
                type="button"
                className={countryChoice === OTHER ? 'is-active' : ''}
                onClick={() => chooseCountry(OTHER)}
                aria-pressed={countryChoice === OTHER}
              >
                Other…
              </button>
            </div>
            {countryChoice === OTHER ? (
              <input
                aria-label="Country name"
                placeholder="Country name"
                value={otherCountry}
                onChange={(event) => setOtherCountry(event.target.value)}
                autoFocus
              />
            ) : null}
          </div>
          <div className="form-grid two">
            <label>
              City
              <input name="city" placeholder="Singapore" value={fields.city} onChange={update} autoComplete="address-level2" />
            </label>
            <label>
              Address
              <input
                name="address"
                placeholder="1 Orchard Rd"
                value={fields.address}
                onChange={update}
                autoComplete="street-address"
              />
            </label>
          </div>
        </fieldset>

        {error ? <div className="notice error">{error}</div> : null}

        <div className="add-lead-actions">
          <button type="button" className="secondary" onClick={clearAll} disabled={busy}>
            Clear
          </button>
          <div className="add-lead-actions-right">
            <button type="button" className="secondary" onClick={() => void save(true)} disabled={busy || !name}>
              Save &amp; add another
            </button>
            <button type="submit" disabled={busy || !name}>
              {busy ? 'Saving…' : 'Save lead →'}
            </button>
          </div>
        </div>
      </form>

      <aside className="add-lead-side">
        <div className="card lead-preview" aria-label="Live preview">
          <div className="lead-preview-label">Live preview</div>
          <div className="lead-preview-head">
            <span className="lead-avatar lead-avatar-lg" aria-hidden="true">
              {(name.charAt(0) || '?').toUpperCase()}
            </span>
            <div>
              <strong>{name || 'Company name'}</strong>
              <span>{domain || 'No website'}</span>
            </div>
          </div>
          <span className={statusChip(previewQueue)}>● {formatStatus(previewQueue)}</span>
          <ul className="lead-preview-facts">
            <li>
              <Icon name="pin" size={16} />
              {location || 'No location'}
            </li>
            <li>
              <Icon name="phone" size={16} />
              {phone || 'No phone'}
            </li>
          </ul>
        </div>
        <div className="card add-lead-help">
          <NextSteps />
        </div>
      </aside>
    </div>
  );
}
