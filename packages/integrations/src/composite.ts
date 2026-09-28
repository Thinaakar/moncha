import type { DiscoveredCompany, DiscoverySource, Logger } from '@moncha/domain';

export class CompositeDiscoverySource implements DiscoverySource {
  constructor(
    private sources: Array<{ name: string; source: DiscoverySource }>,
    private logger?: Logger,
  ) {
    if (!sources.length) throw new Error('No discovery providers configured');
  }

  async discover(input: { country: string; city: string; keyword: string }): Promise<DiscoveredCompany[]> {
    const settled = await Promise.allSettled(
      this.sources.map(async ({ name, source }) => {
        const rows = await source.discover(input);
        return { name, rows };
      }),
    );

    const discovered: DiscoveredCompany[] = [];
    const errors: string[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        this.logger?.info('discovery_provider_results', {
          provider: result.value.name,
          found: result.value.rows.length,
        });
        discovered.push(...result.value.rows);
      } else {
        const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
        errors.push(message);
        this.logger?.error('discovery_provider_failed', { message });
      }
    }

    if (!discovered.length && errors.length === this.sources.length) {
      throw new Error(errors[0] || 'All discovery providers failed');
    }
    return linkWebsitesAcrossSources(discovered);
  }
}

function nameKey(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\u00c0-\uffff]+/g, '');
}

function phoneKey(phone?: string): string | undefined {
  const digits = (phone || '').replace(/\D+/g, '');
  return digits.length >= 7 ? digits.slice(-8) : undefined;
}

/**
 * Rows without a website (e.g. Yelp) borrow the website of a same-name / same-phone row from
 * another provider, so ingest dedupes them by domain and keeps both source records.
 * Remaining website-less duplicates (same name + phone) are dropped.
 */
export function linkWebsitesAcrossSources(rows: DiscoveredCompany[]): DiscoveredCompany[] {
  const byName = new Map<string, DiscoveredCompany>();
  const byPhone = new Map<string, DiscoveredCompany>();
  for (const row of rows) {
    if (!row.domain) continue;
    const n = nameKey(row.name);
    const p = phoneKey(row.phone);
    if (n && !byName.has(n)) byName.set(n, row);
    if (p && !byPhone.has(p)) byPhone.set(p, row);
  }

  const out: DiscoveredCompany[] = [];
  const seenNoDomain = new Set<string>();
  for (const row of rows) {
    if (row.domain) {
      out.push(row);
      continue;
    }
    const p = phoneKey(row.phone);
    const match = (p && byPhone.get(p)) || byName.get(nameKey(row.name));
    if (match) {
      out.push({ ...row, websiteUrl: match.websiteUrl, domain: match.domain });
      continue;
    }
    const key = `${nameKey(row.name)}:${p ?? ''}`;
    if (seenNoDomain.has(key)) continue;
    seenNoDomain.add(key);
    out.push(row);
  }
  return out;
}
