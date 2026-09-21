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
    return discovered;
  }
}
