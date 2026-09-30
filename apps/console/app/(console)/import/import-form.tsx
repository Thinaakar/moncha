'use client';

import Link from 'next/link';
import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';

const PREVIEW_ROWS = 3;

type Parsed = { fileName: string; csv: string; header: string[]; rows: string[][]; missingName: number };

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
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
      if (char === '\r' && text[i + 1] === '\n') i += 1;
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

export function ImportForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function readFile(file: File | undefined) {
    setResult(null);
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.csv')) {
      setParsed(null);
      setResult({ ok: false, text: 'Choose a .csv file.' });
      return;
    }
    const csv = await file.text();
    const [header = [], ...rows] = parseCsv(csv);
    const nameIndex = header.findIndex((column) => column.trim().toLowerCase() === 'name');
    const missingName = nameIndex === -1 ? rows.length : rows.filter((r) => !r[nameIndex]?.trim()).length;
    setParsed({ fileName: file.name, csv, header, rows, missingName });
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
    setResult(null);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function submit() {
    if (!parsed) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/v1/source-imports', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source: 'csv', csv: parsed.csv }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({ ok: true, text: `Import job ${data.id} started (${data.status}).` });
      } else {
        setResult({ ok: false, text: data.error?.message || data.error || 'Import failed' });
      }
    } catch {
      setResult({ ok: false, text: 'Import failed. Is the backend running?' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
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
          ↑
        </span>
        <strong>{parsed ? parsed.fileName : 'Drag and drop your CSV file here'}</strong>
        <span className="muted">{parsed ? 'Drop another file to replace it' : 'or click to choose a file'}</span>
      </label>

      {parsed ? (
        <div className="import-preview">
          <div className="card-head">
            <h2>Preview</h2>
            <span className="muted">
              {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'}
              {parsed.rows.length > PREVIEW_ROWS ? ` · showing first ${PREVIEW_ROWS}` : ''}
            </span>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  {parsed.header.map((column, index) => (
                    <th key={`${column}-${index}`}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, PREVIEW_ROWS).map((row, rowIndex) => (
                  <tr key={rowIndex}>
                    {parsed.header.map((_, index) => (
                      <td key={index}>{row[index] || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.missingName > 0 ? (
            <div className="notice error">
              {parsed.missingName} row{parsed.missingName === 1 ? ' has' : 's have'} no <code>name</code> and will be
              skipped.
            </div>
          ) : null}
          <div className="import-actions">
            <button type="button" className="secondary" onClick={reset} disabled={busy}>
              Clear
            </button>
            <button type="button" onClick={submit} disabled={busy || parsed.rows.length === 0}>
              {busy ? 'Importing…' : `Import ${parsed.rows.length} row${parsed.rows.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      ) : null}

      {result ? (
        <div className={result.ok ? 'notice success result-card' : 'notice error'}>
          <span>{result.text}</span>
          {result.ok ? (
            <span className="result-links">
              <Link href="/jobs">View jobs</Link>
              <Link href="/leads?queue=PENDING_AUDIT">View new leads</Link>
            </span>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
