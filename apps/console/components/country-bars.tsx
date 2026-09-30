import Link from 'next/link';

export type CountryCount = { country: string | null; count: number };

export function CountryBars({ rows }: { rows: CountryCount[] }) {
  const max = Math.max(1, ...rows.map((row) => row.count));

  return (
    <ul className="country-bars">
      {rows.map((row) => {
        const name = row.country || 'Unknown';
        return (
          <li key={name}>
            {row.country ? (
              <Link href={`/leads?queue=ALL&country=${encodeURIComponent(row.country)}`}>{name}</Link>
            ) : (
              <span className="muted">{name}</span>
            )}
            <span className="bar-track" aria-hidden="true">
              <span className="bar-fill" style={{ width: `${(row.count / max) * 100}%` }} />
            </span>
            <strong>{row.count}</strong>
          </li>
        );
      })}
    </ul>
  );
}
