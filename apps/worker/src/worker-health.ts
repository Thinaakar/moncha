import type { CsvSqlClient } from './csv-import';

/** How often the worker writes its WorkerHeartbeat row. */
export const WORKER_HEARTBEAT_MS = 30_000;
/** No heartbeat for this long means the worker is offline. */
export const WORKER_STALE_SECONDS = 120;

const QUEUED_TYPES = ['website_audit', 'country_discovery', 'csv_import', 'site_snapshot'] as const;
type QueuedType = (typeof QUEUED_TYPES)[number];
const emptyCounts = () => Object.fromEntries(QUEUED_TYPES.map((t) => [t, 0])) as Record<QueuedType, number>;

export type WorkerHealth = {
  running: boolean;
  status: 'online' | 'offline';
  message: string;
  lastSeenAt: string | null;
  secondsSinceLastSeen: number | null;
  staleAfterSeconds: number;
  workers: Array<{ workerId: string; hostname: string | null; lastSeenAt: string; secondsSinceLastSeen: number; online: boolean }>;
  jobs: { pending: Record<QueuedType, number>; running: Record<QueuedType, number> };
};

/** Liveness from WorkerHeartbeat (global) plus this tenant's open job counts. */
export async function workerHealth(sql: Pick<CsvSqlClient, 'query'>, tenantId: string): Promise<WorkerHealth> {
  // Ages are computed in SQL: the columns are UTC timestamps without a zone, which Node would read as local time.
  const [heartbeats, jobRows]: [
    Array<{ workerId: string; hostname: string | null; lastSeenAt: string; ageSeconds: number }>,
    Array<{ type: string; status: string; n: number }>,
  ] = await Promise.all([
    sql.query(
      `SELECT "workerId", hostname,
              to_char("updatedAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "lastSeenAt",
              GREATEST(0, EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'UTC') - "updatedAt")))::int AS "ageSeconds"
       FROM "WorkerHeartbeat" ORDER BY "updatedAt" DESC LIMIT 5`,
    ),
    sql.query(
      `SELECT type, status, count(*)::int AS n FROM "JobRun"
       WHERE "tenantId" = $1 AND status IN ('pending', 'running') GROUP BY type, status`,
      [tenantId],
    ),
  ]);

  const jobs = { pending: emptyCounts(), running: emptyCounts() };
  for (const row of jobRows) {
    const bucket = row.status === 'running' ? jobs.running : jobs.pending;
    if (row.type in bucket) bucket[row.type as QueuedType] = Number(row.n);
  }

  const workers = heartbeats.map((h) => ({
    workerId: h.workerId,
    hostname: h.hostname,
    lastSeenAt: h.lastSeenAt,
    secondsSinceLastSeen: Number(h.ageSeconds),
    online: Number(h.ageSeconds) <= WORKER_STALE_SECONDS,
  }));
  const latest = workers[0];
  const running = Boolean(latest?.online);
  return {
    running,
    status: running ? 'online' : 'offline',
    message: running
      ? 'Background worker is running.'
      : 'Background worker is offline: discovery, schedules, website audits, website copies and large CSV imports wait until it starts.',
    lastSeenAt: latest?.lastSeenAt ?? null,
    secondsSinceLastSeen: latest?.secondsSinceLastSeen ?? null,
    staleAfterSeconds: WORKER_STALE_SECONDS,
    workers,
    jobs,
  };
}
