import Link from 'next/link';
import type { ReactNode } from 'react';

export type Tone = 'blue' | 'green' | 'amber' | 'orange' | 'gray' | 'red' | 'violet' | 'teal';

export function StatCard({
  label,
  value,
  tone = 'blue',
  icon,
  href,
  hint,
}: {
  label: string;
  value: number | string;
  tone?: Tone;
  icon?: ReactNode;
  href?: string;
  hint?: string;
}) {
  const body = (
    <>
      <div className="stat-card-top">
        <span className="label">{label}</span>
        {icon ? (
          <span className="stat-icon" aria-hidden="true">
            {icon}
          </span>
        ) : null}
      </div>
      <div className="stat">{value}</div>
      {hint ? <div className="stat-hint">{hint}</div> : null}
    </>
  );

  const className = `stat-card stat-tone-${tone}${href ? ' is-link' : ''}`;
  return href ? (
    <Link href={href} className={className}>
      {body}
    </Link>
  ) : (
    <div className={className}>{body}</div>
  );
}
