import Link from 'next/link';

export type QueueSlice = { queue: string; label: string; count: number; color: string };

const RADIUS = 15.9155;

export function QueueDonut({ slices, total }: { slices: QueueSlice[]; total: number }) {
  let offset = 0;
  const segments = slices
    .filter((slice) => slice.count > 0 && total > 0)
    .map((slice) => {
      const share = (slice.count / total) * 100;
      const segment = { ...slice, share, start: offset };
      offset += share;
      return segment;
    });

  return (
    <div className="donut-wrap">
      <div className="donut">
        <svg viewBox="0 0 42 42" role="img" aria-label={`${total} leads by queue`}>
          <circle cx="21" cy="21" r={RADIUS} fill="none" className="donut-track" strokeWidth="5" />
          {segments.map((segment) => (
            <circle
              key={segment.queue}
              cx="21"
              cy="21"
              r={RADIUS}
              fill="none"
              stroke={segment.color}
              strokeWidth="5"
              strokeDasharray={`${segment.share} ${100 - segment.share}`}
              strokeDashoffset={25 - segment.start}
            />
          ))}
        </svg>
        <div className="donut-center">
          <strong>{total}</strong>
          <span>leads</span>
        </div>
      </div>

      <ul className="donut-legend">
        {slices.map((slice) => (
          <li key={slice.queue} className={slice.count === 0 ? 'is-empty' : undefined}>
            <span className="legend-dot" style={{ background: slice.color }} aria-hidden="true" />
            <Link href={`/leads?queue=${slice.queue}`}>{slice.label}</Link>
            <strong>{slice.count}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
