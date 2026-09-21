import type { DiscoverySource, Logger } from '@moncha/domain';
import { CompositeDiscoverySource } from './composite';
import { FoursquareDiscoverySource } from './foursquare';
import { GooglePlacesDiscoverySource } from './google-places';
import { createSearchDiscoverySource } from './search';
import { YelpDiscoverySource } from './yelp';

export const LIVE_DISCOVERY_SOURCES = ['google_places', 'yelp', 'foursquare', 'search', 'all'] as const;
export type LiveDiscoverySourceName = (typeof LIVE_DISCOVERY_SOURCES)[number];

export function isLiveDiscoverySource(value: string): value is LiveDiscoverySourceName {
  return (LIVE_DISCOVERY_SOURCES as readonly string[]).includes(value);
}

export function createLiveDiscoverySource(
  name: LiveDiscoverySourceName,
  env: Record<string, string | undefined>,
  logger?: Logger,
  fetchImpl: typeof fetch = fetch,
): DiscoverySource {
  if (name === 'all') {
    return new CompositeDiscoverySource(configuredSources(env, logger, fetchImpl), logger);
  }
  if (name === 'google_places') return new GooglePlacesDiscoverySource(env.GOOGLE_PLACES_API_KEY || '', logger, fetchImpl);
  if (name === 'yelp') return new YelpDiscoverySource(env.YELP_API_KEY || '', logger, fetchImpl);
  if (name === 'foursquare') return new FoursquareDiscoverySource(env.FOURSQUARE_API_KEY || '', logger, fetchImpl);
  return createSearchDiscoverySource(env, logger, fetchImpl);
}

function configuredSources(
  env: Record<string, string | undefined>,
  logger: Logger | undefined,
  fetchImpl: typeof fetch,
) {
  const sources: Array<{ name: string; source: DiscoverySource }> = [];
  if (env.GOOGLE_PLACES_API_KEY) {
    sources.push({ name: 'google_places', source: new GooglePlacesDiscoverySource(env.GOOGLE_PLACES_API_KEY, logger, fetchImpl) });
  }
  if (env.YELP_API_KEY) {
    sources.push({ name: 'yelp', source: new YelpDiscoverySource(env.YELP_API_KEY, logger, fetchImpl) });
  }
  if (env.FOURSQUARE_API_KEY) {
    sources.push({ name: 'foursquare', source: new FoursquareDiscoverySource(env.FOURSQUARE_API_KEY, logger, fetchImpl) });
  }
  try {
    sources.push({ name: 'search', source: createSearchDiscoverySource(env, logger, fetchImpl) });
  } catch {
    // Search credentials are optional in "all" mode.
  }
  if (!sources.length) {
    throw new Error('No discovery providers configured');
  }
  return sources;
}
