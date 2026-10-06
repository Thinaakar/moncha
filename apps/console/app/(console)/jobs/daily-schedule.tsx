'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { EmptyState } from '@/components/empty-state';

type Schedule = {
  id: string;
  countryCode: string;
  country: string;
  time: string;
  timezone: string;
  nextRunAt: string;
  nextRunDay: string;
  lastRunAt: string | null;
};

type ScheduleGroup = { countryCode: string; country: string; timesPerDay: number; schedules: Schedule[] };
type ScheduleRun = {
  id: string;
  day: string;
  country: string;
  time: string;
  timezone: string;
  trigger: string;
  status: string;
  found: number;
  saved: number;
  skipped: number;
  error: string | null;
  startedAt: string;
};

const COUNTRY_OPTIONS = [
  { country: 'Singapore', timezone: 'Asia/Singapore' },
  { country: 'Malaysia', timezone: 'Asia/Kuala_Lumpur' },
  { country: 'Japan', timezone: 'Asia/Tokyo' },
];

function errorMessage(data: unknown, fallback: string) {
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error?: { message?: string } | string }).error;
    if (typeof error === 'string') return error;
    if (error?.message) return error.message;
  }
  return fallback;
}

function dateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString() : 'Never';
}

export function DailySchedule() {
  const [groups, setGroups] = useState<ScheduleGroup[]>([]);
  const [runs, setRuns] = useState<ScheduleRun[]>([]);
  const [country, setCountry] = useState('Singapore');
  const [time, setTime] = useState('10:00');
  const [timezone, setTimezone] = useState('Asia/Singapore');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  async function load() {
    setLoading(true);
    setFailed(false);
    try {
      const [scheduleResponse, runsResponse] = await Promise.all([
        fetch('/api/v1/schedules', { cache: 'no-store' }),
        fetch('/api/v1/schedules/runs?limit=50', { cache: 'no-store' }),
      ]);
      const scheduleData = await scheduleResponse.json();
      if (!scheduleResponse.ok) throw new Error(errorMessage(scheduleData, 'Could not load schedules'));
      setGroups(Array.isArray(scheduleData.countries) ? scheduleData.countries : []);

      const runsData = await runsResponse.json();
      if (runsResponse.ok) setRuns(Array.isArray(runsData.runs) ? runsData.runs : []);
      else setRuns([]);
    } catch (error) {
      setFailed(true);
      setMessage(error instanceof Error ? error.message : 'Could not connect to schedules service');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      const response = await fetch('/api/v1/schedules', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ country, time, timezone }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(errorMessage(data, 'Could not create schedule'));
      setMessage(`Daily schedule created for ${country}.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not create schedule');
    } finally {
      setSaving(false);
    }
  }

  async function remove(schedule: Schedule) {
    if (!window.confirm(`Delete the ${schedule.country} schedule at ${schedule.time}?`)) return;
    setMessage('');
    try {
      const response = await fetch(`/api/v1/schedules/${encodeURIComponent(schedule.id)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(errorMessage(data, 'Could not delete schedule'));
      setMessage(`Schedule for ${schedule.country} deleted.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete schedule');
    }
  }

  async function removeCountry(group: ScheduleGroup) {
    if (!window.confirm(`Delete every ${group.country} schedule?`)) return;
    setMessage('');
    try {
      const response = await fetch(`/api/v1/schedules?country=${encodeURIComponent(group.country)}`, { method: 'DELETE' });
      const data = await response.json();
      if (!response.ok) throw new Error(errorMessage(data, 'Could not delete country schedules'));
      setMessage(`${data.deleted ?? 0} ${group.country} schedule(s) deleted.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not delete country schedules');
    }
  }

  return (
    <>
      <section className="card">
        <h2>Create daily schedule</h2>
        <form className="discover-form" onSubmit={create}>
          <label className="discover-field">
            Country
            <select
              value={country}
              onChange={(event) => {
                const option = COUNTRY_OPTIONS.find((item) => item.country === event.target.value);
                setCountry(event.target.value);
                if (option) setTimezone(option.timezone);
              }}
            >
              {COUNTRY_OPTIONS.map((item) => <option key={item.country} value={item.country}>{item.country}</option>)}
            </select>
          </label>
          <label className="discover-field">
            Daily run time
            <input type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
          </label>
          <label className="discover-field">
            Timezone
            <select value={timezone} onChange={(event) => setTimezone(event.target.value)}>
              {COUNTRY_OPTIONS.map((item) => <option key={item.timezone} value={item.timezone}>{item.timezone}</option>)}
            </select>
          </label>
          <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Create schedule'}</button>
        </form>
        {message ? <p className={failed ? 'notice error' : 'notice'} role="status">{message}</p> : null}
      </section>

      <section className="card">
        <div className="card-head">
          <h2>Schedules by country</h2>
          <button type="button" className="secondary" onClick={() => void load()} disabled={loading}>Refresh</button>
        </div>
        {loading ? <p className="muted">Loading schedules…</p> : failed ? (
          <EmptyState title="Schedules unavailable">Check the backend URL and try refreshing.</EmptyState>
        ) : groups.length === 0 ? (
          <EmptyState title="No schedules yet">Create a daily schedule above.</EmptyState>
        ) : (
          <div className="saved-schedules">
            {groups.map((group) => (
              <section key={group.countryCode} className="saved-schedule">
                <div className="saved-schedule-top">
                  <strong>{group.country} ({group.countryCode})</strong>
                  <span className="chip chip-blue">{group.timesPerDay} per day</span>
                  <button type="button" className="btn-danger" onClick={() => void removeCountry(group)}>Delete country schedules</button>
                </div>
                {group.schedules.map((schedule) => (
                  <article className="saved-schedule-meta" key={schedule.id}>
                    <span>{schedule.time} · {schedule.timezone}</span>
                    <span>Next: {schedule.nextRunDay}, {dateLabel(schedule.nextRunAt)}</span>
                    <span>Last run: {dateLabel(schedule.lastRunAt)}</span>
                    <button type="button" className="btn-danger" onClick={() => void remove(schedule)}>Delete</button>
                  </article>
                ))}
              </section>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <h2>Schedule run history</h2>
        {runs.length === 0 ? <EmptyState title="No runs recorded">Run history will appear after scheduled or manual discovery.</EmptyState> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Country</th><th>Started</th><th>Trigger</th><th>Status</th><th>Found</th><th>Saved</th><th>Skipped</th></tr></thead>
              <tbody>{runs.map((run) => (
                <tr key={run.id}>
                  <td>{run.country}</td><td>{dateLabel(run.startedAt)}</td><td>{run.trigger}</td><td>{run.status}</td>
                  <td>{run.found}</td><td>{run.saved}</td><td>{run.skipped}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
