import Link from 'next/link';
import { formatStatus, statusChip } from '@/lib/ui';

export type TimelineJob = {
  id: string;
  title: string;
  when: string;
  status: string;
  detail?: string;
  error?: string | null;
  action?: { href: string; label: string };
};

export function JobTimeline({ jobs }: { jobs: TimelineJob[] }) {
  return (
    <ol className="timeline">
      {jobs.map((job) => (
        <li key={job.id} className="timeline-item">
          <span className={`timeline-dot is-${job.status.toLowerCase()}`} aria-hidden="true" />
          <div className="timeline-body">
            <div className="timeline-main">
              <strong>{job.title}</strong>
              <span className="timeline-when">{job.when}</span>
            </div>
            {job.detail ? <div className="timeline-detail">{job.detail}</div> : null}
            {job.error ? <div className="timeline-error">{job.error}</div> : null}
          </div>
          <div className="timeline-side">
            <span className={statusChip(job.status)}>{formatStatus(job.status)}</span>
            {job.action ? (
              <Link href={job.action.href} className="btn btn-secondary btn-sm">
                {job.action.label}
              </Link>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
