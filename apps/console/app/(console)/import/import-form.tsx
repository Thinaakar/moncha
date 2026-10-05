'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Icon } from '@/components/icon';

const MAX_ROWS = 5000;
const PREVIEW_ROWS = 8;
const POLL_MS = 2000;
const POLL_LIMIT = 40;

const STEPS = ['Upload', 'Check', 'Import'] as const;

const COLUMNS = [
  { key: 'name', label: 'name', aliases: ['name', 'company', 'company_name'], required: true },
  { key: 'website', label: 'website', aliases: ['domain', 'website', 'url', 'website_url'], required: false },
  { key: 'country', label: 'country', aliases: ['country'], required: false },
  { key: 'city', label: 'city', aliases: ['city'], required: false },
  { key: 'phone', label: 'phone', aliases: ['phone', 'telephone'], required: false },
  { key: 'address', label: 'address', aliases: ['address'], required: false },
] as const;

type ColumnKey = (typeof COLUMNS)[number]['key'];
type RowStatus = 'ready' | 'nosite' | 'skip';
type Row = Record<ColumnKey, string> & { status: RowStatus };
type Parsed = { fileName: string; csv: string; rows: Row[]; found: Record<ColumnKey, boolean> };
type Job = {
  id: string;
  status: string;
  error?: string;
  result?: { created?: number; duplicates?: number; skipped?: number; noWebsite?: number };
};

const TEMPLATE =
  'name,website,country,city,phone,address\n' +
  'Smile Dental,smiledental.com.sg,Singapore,Singapore,+65 6123 4567,1 Orchard Rd\n';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((value) => value.trim() !== ''));
}

function toRows(header: string[], body: string[][]): Pick<Parsed, 'rows' | 'found'> {
  const normalized = header.map((cell) => cell.trim().toLowerCase());
  const indexes = Object.fromEntries(
    COLUMNS.map((column) => [column.key, normalized.findIndex((cell) => (column.aliases as readonly string[]).includes(cell))]),
  ) as Record<ColumnKey, number>;
  const found = Object.fromEntries(COLUMNS.map((column) => [column.key, indexes[column.key] >= 0])) as Record<
    ColumnKey,
    boolean
  >;
  const rows = body.map((cells) => {
    const values = Object.fromEntries(
      COLUMNS.map((column) => [column.key, indexes[column.key] >= 0 ? cells[indexes[column.key]]?.trim() || '' : '']),
    ) as Record<ColumnKey, string>;
    const status: RowStatus = !values.name ? 'skip' : !values.website ? 'nosite' : 'ready';
    return { ...values, status };
  });
  return { rows, found };
}

function plural(count: number, word: string) {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

function downloadTemplate() {
  const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'moncha-import-template.csv';
  link.click();
  URL.revokeObjectURL(url);
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="import-steps" aria-label="Import progress">
      {STEPS.map((label, index) => {
        const state = index < step ? 'is-done' : index === step ? 'is-current' : '';
        return (
          <li key={label} className={state} aria-current={index === step ? 'step' : undefined}>
            <span className="import-step-dot">{index < step ? <Icon name="check" size={14} /> : index + 1}</span>
            <span className="import-step-label">{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function HelpPanel() {
  return (
    <aside className="card import-aside">
      <h3>How it works</h3>
      <ol className="import-how">
        <li>Upload your CSV</li>
        <li>We check every row</li>
        <li>Companies become leads, then their websites get checked</li>
      </ol>
      <hr />
      <h3>Columns</h3>
      <ul className="import-columns">
        {COLUMNS.map((column) => (
          <li key={column.key}>
            <code>{column.label}</code>
            <span className={column.required ? 'import-req is-required' : 'import-req'}>
              {column.required ? '● required' : '○ optional'}
            </span>
          </li>
        ))}
      </ul>
      <hr />
      <button type="button" className="secondary import-template" onClick={downloadTemplate}>
        <Icon name="download" size={16} />
        Download template
      </button>
    </aside>
  );
}

export function ImportForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [job, setJob] = useState<Job | null>(null);

  const jobId = job?.id;
  const jobFinished = job ? job.status === 'done' || job.status === 'failed' : false;

  useEffect(() => {
    if (!jobId || jobFinished) return;
    let cancelled = false;
    let attempts = 0;
    const timer = window.setInterval(async () => {
      attempts += 1;
      if (attempts > POLL_LIMIT) {
        window.clearInterval(timer);
        return;
      }
      try {
        const res = await fetch(`/api/v1/source-imports/${encodeURIComponent(jobId)}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setJob({ id: jobId, status: data.status, error: data.error || undefined, result: data.result || undefined });
        if (data.status === 'done' || data.status === 'failed') window.clearInterval(timer);
      } catch {
        // keep polling; the next tick may succeed
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [jobId, jobFinished]);

  async function readFile(file: File | undefined) {
    setError('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setError('Choose a .csv file.');
      return;
    }
    const csv = await file.text();
    const [header = [], ...body] = parseCsv(csv);
    if (!body.length) {
      setError('This file has no rows under the header.');
      return;
    }
    if (body.length > MAX_ROWS) {
      setError(`This file has ${body.length.toLocaleString()} rows. Split it into files of up to ${MAX_ROWS.toLocaleString()} rows.`);
      return;
    }
    setProblemsOnly(false);
    setParsed({ fileName: file.name, csv, ...toRows(header, body) });
  }

  function onDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    void readFile(event.dataTransfer.files[0]);
  }

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    void readFile(event.target.files?.[0]);
  }

  function reset() {
    setParsed(null);
    setJob(null);
    setError('');
    setProblemsOnly(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function submit() {
    if (!parsed) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/v1/source-imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'csv', csv: parsed.csv }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setJob({ id: data.id, status: data.status || 'pending' });
      } else {
        setError((typeof data.error === 'string' ? data.error : data.error?.message) || 'Import failed');
      }
    } catch {
      setError('Import failed. Is the backend running?');
    } finally {
      setBusy(false);
    }
  }

  const step = job ? 2 : parsed ? 1 : 0;
  const counts = parsed
    ? {
        ready: parsed.rows.filter((row) => row.status === 'ready').length,
        nosite: parsed.rows.filter((row) => row.status === 'nosite').length,
        skip: parsed.rows.filter((row) => row.status === 'skip').length,
      }
    : { ready: 0, nosite: 0, skip: 0 };
  const importable = counts.ready + counts.nosite;
  const visibleRows = parsed
    ? (problemsOnly ? parsed.rows.filter((row) => row.status !== 'ready') : parsed.rows).slice(0, PREVIEW_ROWS)
    : [];
  const filteredTotal = parsed ? (problemsOnly ? counts.nosite + counts.skip : parsed.rows.length) : 0;

  return (
    <>
      <div className="card import-stepper-card">
        <Stepper step={step} />
      </div>

      {step === 0 ? (
        <div className="import-layout">
          <div className="card import-main">
            <label
              className={dragging ? 'dropzone is-dragging' : 'dropzone'}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <input ref={inputRef} type="file" accept=".csv,text/csv" onChange={onChange} className="visually-hidden" />
              <span className="dropzone-icon" aria-hidden="true">
                <Icon name="import" size={24} />
              </span>
              <strong>Drag and drop your CSV file here</strong>
              <span className="dropzone-or">
                or <span className="dropzone-choose">Choose file</span>
              </span>
              <span className="muted">.csv only · up to {MAX_ROWS.toLocaleString()} rows</span>
            </label>
            {error ? <div className="notice error">{error}</div> : null}
          </div>
          <HelpPanel />
        </div>
      ) : null}

      {step === 1 && parsed ? (
        <div className="import-layout">
          <div className="card import-main">
            <div className="import-file">
              <span className="import-file-icon">
                <Icon name="file" size={18} />
              </span>
              <strong>{parsed.fileName}</strong>
              <span className="muted">{plural(parsed.rows.length, 'row')}</span>
              <button type="button" className="import-file-clear" onClick={reset} disabled={busy} aria-label="Remove file" title="Remove file">
                <Icon name="close" size={16} />
              </button>
            </div>

            <div className="import-counts">
              <div className="import-count stat-tone-green">
                <strong>{counts.ready.toLocaleString()}</strong>
                <span>Ready</span>
              </div>
              <div className="import-count stat-tone-amber">
                <strong>{counts.nosite.toLocaleString()}</strong>
                <span>No website</span>
              </div>
              <div className="import-count stat-tone-red">
                <strong>{counts.skip.toLocaleString()}</strong>
                <span>No name</span>
              </div>
            </div>

            <div className="import-preview-head">
              <h2>Preview</h2>
              <div className="segmented" role="group" aria-label="Preview filter">
                <button type="button" className={problemsOnly ? '' : 'is-active'} onClick={() => setProblemsOnly(false)}>
                  All
                </button>
                <button type="button" className={problemsOnly ? 'is-active' : ''} onClick={() => setProblemsOnly(true)}>
                  Problems only
                </button>
              </div>
            </div>

            {visibleRows.length ? (
              <div className="table-wrap">
                <table className="table import-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Website</th>
                      <th>Country</th>
                      <th>City</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, index) => (
                      <tr key={index} className={`import-row is-${row.status}`}>
                        <td>{row.name || '—'}</td>
                        <td>{row.website || '—'}</td>
                        <td>{row.country || '—'}</td>
                        <td>{row.city || '—'}</td>
                        <td>
                          <span className={`import-status is-${row.status}`}>
                            {row.status === 'ready' ? '✓ Ready' : row.status === 'nosite' ? '⚠ No website' : '✕ Skipped'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted import-empty">No problems found. Every row is ready.</p>
            )}
            {filteredTotal > PREVIEW_ROWS ? (
              <p className="muted import-more">
                Showing first {PREVIEW_ROWS} of {filteredTotal.toLocaleString()}
              </p>
            ) : null}

            {error ? <div className="notice error">{error}</div> : null}

            <div className="import-actions">
              <button type="button" className="secondary" onClick={reset} disabled={busy}>
                ← Back
              </button>
              <button type="button" onClick={submit} disabled={busy || importable === 0}>
                {busy ? 'Importing…' : `Import ${plural(importable, 'row')} →`}
              </button>
            </div>
          </div>

          <aside className="card import-aside">
            <h3>Check result</h3>
            <ul className="import-check">
              <li className="is-ready">✓ {counts.ready.toLocaleString()} ready to import</li>
              <li className="is-nosite">⚠ {counts.nosite.toLocaleString()} without website (imported, not checked)</li>
              <li className="is-skip">✕ {counts.skip.toLocaleString()} skipped (no name)</li>
            </ul>
            <hr />
            <h3>Columns found</h3>
            <ul className="import-columns">
              {COLUMNS.map((column) => (
                <li key={column.key}>
                  <code>{column.label}</code>
                  <span className={parsed.found[column.key] ? 'import-found is-yes' : 'import-found'}>
                    {parsed.found[column.key] ? '✓ found' : column.required ? '✕ missing' : '— not in file'}
                  </span>
                </li>
              ))}
            </ul>
          </aside>
        </div>
      ) : null}

      {step === 2 && job ? (
        <div className="card import-done">
          <span className={job.status === 'failed' ? 'import-done-icon is-failed' : 'import-done-icon'}>
            <Icon name={job.status === 'failed' ? 'close' : 'check'} size={28} />
          </span>
          <h2>
            {job.status === 'failed' ? 'Import failed' : job.status === 'done' ? 'Import finished' : 'Import started'}
          </h2>
          <p className="muted">
            Job <code>{job.id}</code> · {job.status}
          </p>
          {job.status === 'failed' && job.error ? <div className="notice error">{job.error}</div> : null}

          <div className="import-counts">
            {job.status === 'done' && job.result ? (
              <>
                <div className="import-count stat-tone-green">
                  <strong>{(job.result.created ?? 0).toLocaleString()}</strong>
                  <span>New leads</span>
                </div>
                <div className="import-count stat-tone-gray">
                  <strong>{(job.result.duplicates ?? 0).toLocaleString()}</strong>
                  <span>Already saved</span>
                </div>
                <div className="import-count stat-tone-amber">
                  <strong>{(job.result.noWebsite ?? 0).toLocaleString()}</strong>
                  <span>No website</span>
                </div>
                <div className="import-count stat-tone-red">
                  <strong>{(job.result.skipped ?? 0).toLocaleString()}</strong>
                  <span>Skipped</span>
                </div>
              </>
            ) : (
              <>
                <div className="import-count stat-tone-blue">
                  <strong>{importable.toLocaleString()}</strong>
                  <span>Sent</span>
                </div>
                <div className="import-count stat-tone-amber">
                  <strong>{counts.nosite.toLocaleString()}</strong>
                  <span>No website</span>
                </div>
                <div className="import-count stat-tone-red">
                  <strong>{counts.skip.toLocaleString()}</strong>
                  <span>Skipped</span>
                </div>
              </>
            )}
          </div>

          <div className="import-done-actions">
            <Link href="/leads?queue=PENDING_AUDIT" className="btn">
              View new leads →
            </Link>
            <Link href="/jobs" className="btn btn-secondary">
              View jobs
            </Link>
            <button type="button" className="secondary" onClick={reset}>
              Import another file
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
