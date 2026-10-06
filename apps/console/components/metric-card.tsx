import Link from 'next/link';
import { Icon, type IconName } from '@/components/icon';

export type Tone = 'blue' | 'green' | 'amber' | 'orange' | 'gray' | 'red' | 'violet' | 'teal';

export type MetricPill = { label: string; tone: Tone; href?: string };

export function MetricCard({
  label,
  value,
  hint,
  icon,
  tone,
  pill,
  loading = false,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: IconName;
  tone: Tone;
  pill?: MetricPill;
  loading?: boolean;
}) {
  return (
    <article className={`metric-card stat-tone-${tone}`}>
      <div className="metric-main">
        <span className="metric-icon" aria-hidden="true">
          <Icon name={icon} size={20} />
        </span>
        <div className="metric-text">
          <span className="metric-label">{label}</span>
          {loading ? (
            <>
              <span className="skeleton metric-skeleton-value" />
              <span className="skeleton metric-skeleton-hint" />
            </>
          ) : (
            <>
              <strong className="metric-value">{value}</strong>
              {hint ? <span className="metric-hint">{hint}</span> : null}
            </>
          )}
        </div>
      </div>
      {pill && !loading ? (
        <div className="metric-foot">
          {pill.href ? (
            <Link href={pill.href} className={`metric-pill stat-tone-${pill.tone}`}>
              {pill.label}
            </Link>
          ) : (
            <span className={`metric-pill stat-tone-${pill.tone}`}>{pill.label}</span>
          )}
        </div>
      ) : null}
    </article>
  );
}
