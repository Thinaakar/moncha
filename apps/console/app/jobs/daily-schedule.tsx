'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { statusChip } from '@/lib/ui';

const STORAGE_KEY = 'moncha-daily-schedule';
const ZONE = 'Asia/Kuala_Lumpur';

type Schedule = {
  id: string;
  country: string;
  time: string;
};

type HistoryRow = {
  id: string;
  country: string;
  day: string;
  time: string;
  status: 'done';
  found: number;
  saved: number;
  skipped: number;
};

type Draft = { country: string; time: string };

const DEFAULT_DRAFT: Draft = { country: 'Malaysia', time: '10:00' };

function loadSchedules(): Schedule[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Schedule[] | Schedule;
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list
      .filter((row) => row && typeof row === 'object')
      .map((row, index) => ({
        id: 'id' in row && row.id ? String(row.id) : `row-${index}`,
        country: String(row.country || ''),
        time: String(row.time || '10:00'),
      }))
      .filter((row) => row.country && row.time);
  } catch {
    return [];
  }
}

function displayCountry(country: string) {
  return country
    .trim()
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function nextRunText(time: string) {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value || 0);
  const nowMinutes = read('hour') * 60 + read('minute');
  const target = hour * 60 + minute;
  const when = target > nowMinutes ? 'Today' : 'Tomorrow';
  return `${when} at ${time}`;
}

type CountryGroup = { key: string; name: string; rows: Schedule[] };

function groupByCountry(schedules: Schedule[]): CountryGroup[] {
  const groups = new Map<string, CountryGroup>();
  for (const row of schedules) {
    const key = row.country.trim().toLowerCase();
    const group = groups.get(key) ?? { key, name: displayCountry(row.country), rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => a.time.localeCompare(b.time)),
  }));
}

function sampleHistory(schedules: Schedule[]): HistoryRow[] {
  return schedules.flatMap((schedule, index) => [
    {
      id: `${schedule.id}-today`,
      country: schedule.country,
      day: 'Today',
      time: schedule.time,
      status: 'done' as const,
      found: 40 - index * 4,
      saved: 12 - index * 2,
      skipped: 28,
    },
    {
      id: `${schedule.id}-yesterday`,
      country: schedule.country,
      day: 'Yesterday',
      time: schedule.time,
      status: 'done' as const,
      found: 36 - index * 4,
      saved: 8 - index,
      skipped: 28,
    },
  ]);
}

export function DailySchedule() {
  const [savedRows, setSavedRows] = useState<Schedule[]>([]);
  const [draft, setDraft] = useState<Draft>(DEFAULT_DRAFT);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setSavedRows(loadSchedules());
  }, []);

  const history = useMemo(() => sampleHistory(savedRows), [savedRows]);
  const groups = useMemo(() => groupByCountry(savedRows), [savedRows]);

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setMessage(null);
  }

  function save(event: FormEvent) {
    event.preventDefault();
    const country = draft.country.trim();
    if (!country || !draft.time) return;
    const key = `${country.toLowerCase()}|${draft.time}`;
    if (savedRows.some((row) => `${row.country.trim().toLowerCase()}|${row.time}` === key)) {
      setMessage('Already scheduled. Pick a different time or country.');
      return;
    }
    const next = [...savedRows, { id: `row-${Date.now()}`, country, time: draft.time }];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSavedRows(next);
    setMessage(`Added ${displayCountry(country)} at ${draft.time}.`);
  }

  function removeSaved(ids: string[]) {
    const drop = new Set(ids);
    const next = savedRows.filter((item) => !drop.has(item.id));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setSavedRows(next);
    setMessage(null);
  }

  function deleteTime(row: Schedule) {
    if (!window.confirm(`Delete the ${displayCountry(row.country)} ${row.time} schedule?`)) return;
    removeSaved([row.id]);
  }

  function deleteCountry(group: CountryGroup) {
    const times = group.rows.length === 1 ? 'schedule' : `${group.rows.length} schedules`;
    if (!window.confirm(`Delete ${group.name} and its ${times}?`)) return;
    removeSaved(group.rows.map((row) => row.id));
  }

  return (
    <>
      <div className="card schedule-card">
        <div className="schedule-head">
          <div>
            <h2>Daily schedule</h2>
            <p className="muted">
              Each save adds to your schedules. Change the time and save again to run the same country twice.
            </p>
          </div>
        </div>
        <form onSubmit={save}>
          <div className="schedule-columns">
            <span>Country</span>
            <span>Time · Malaysia</span>
            <span />
          </div>
          <div className="schedule-row">
            <input
              aria-label="Country"
              value={draft.country}
              placeholder="Country"
              onChange={(event) => updateDraft({ country: event.target.value })}
              required
            />
            <input
              aria-label="Time in Malaysia"
              type="time"
              value={draft.time}
              onChange={(event) => updateDraft({ time: event.target.value })}
              required
            />
            <button type="submit">Save schedule</button>
          </div>
          {message ? <p className="schedule-message">{message}</p> : null}
        </form>
      </div>

      <div className="card">
        <h2>Saved schedules</h2>
        {savedRows.length === 0 ? (
          <div className="empty">No schedules yet. Add a country and time above.</div>
        ) : (
          <div className="saved-list">
            {groups.map((group) => (
              <div className="saved-item" key={group.key}>
                <div className="saved-item-head">
                  <div className="saved-item-text">
                    <strong>{group.name}</strong>
                    <span>
                      {group.rows.length === 1 ? '1 time' : `${group.rows.length} times`} every day · Malaysia time
                    </span>
                  </div>
                  <button type="button" className="btn btn-danger" onClick={() => deleteCountry(group)}>
                    Delete country
                  </button>
                </div>
                <div className="saved-times">
                  {group.rows.map((row) => (
                    <div className="saved-time" key={row.id}>
                      <div className="saved-time-text">
                        <strong>{row.time}</strong>
                        <span>Next run: {nextRunText(row.time)}</span>
                      </div>
                      <button
                        type="button"
                        className="saved-time-delete"
                        onClick={() => deleteTime(row)}
                        aria-label={`Delete ${group.name} ${row.time}`}
                        title="Delete this time"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Run history</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          Each row is an automatic daily fetch. Skipped companies were already saved.
        </p>
        <div className="table-wrap">
          <table className="table schedule-table">
            <thead>
              <tr>
                <th>Day</th>
                <th>Country</th>
                <th>Time</th>
                <th>Status</th>
                <th className="num">Found</th>
                <th className="num">Saved</th>
                <th className="num">Skipped</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    No runs yet. Save a schedule to start the daily fetch.
                  </td>
                </tr>
              ) : null}
              {history.map((row) => (
                <tr key={row.id}>
                  <td>{row.day}</td>
                  <td>{displayCountry(row.country)}</td>
                  <td>{row.time} Malaysia</td>
                  <td>
                    <span className={statusChip(row.status)}>{row.status}</span>
                  </td>
                  <td className="num">{row.found}</td>
                  <td className="num">{row.saved}</td>
                  <td className="num">{row.skipped}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
