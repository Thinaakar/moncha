import { JP_CITIES, MY_CITIES } from './cities.generated';

export type CountryProfile = {
  code: string;
  name: string;
  aliases: readonly string[];
  regionCode: string;
  languageCode: string;
  /** Search areas, largest first. Each is appended to the country in the provider query. */
  cities: readonly string[];
};

/** URA planning areas, minus water catchments, offshore islands and reclaimed sea areas. */
const SG_PLANNING_AREAS = [
  'Bedok', 'Jurong West', 'Tampines', 'Woodlands', 'Sengkang', 'Hougang', 'Yishun', 'Choa Chu Kang',
  'Punggol', 'Ang Mo Kio', 'Bukit Merah', 'Bukit Batok', 'Bukit Panjang', 'Toa Payoh', 'Pasir Ris',
  'Queenstown', 'Geylang', 'Serangoon', 'Kallang', 'Clementi', 'Jurong East', 'Sembawang', 'Bishan',
  'Bukit Timah', 'Marine Parade', 'Novena', 'Tanglin', 'Downtown Core', 'Orchard', 'River Valley',
  'Outram', 'Rochor', 'Newton', 'Singapore River', 'Museum', 'Marina South', 'Paya Lebar', 'Changi',
  'Tengah', 'Boon Lay', 'Pioneer', 'Tuas', 'Seletar', 'Mandai', 'Sungei Kadut', 'Lim Chu Kang',
] as const;

/** GeoNames lists only a few of Tokyo's 23 special wards at municipality level. */
const TOKYO_SPECIAL_WARDS = [
  'Setagaya', 'Nerima', 'Ota', 'Edogawa', 'Adachi', 'Suginami', 'Itabashi', 'Koto', 'Katsushika',
  'Shinagawa', 'Kita', 'Shinjuku', 'Nakano', 'Toshima', 'Meguro', 'Sumida', 'Minato', 'Shibuya',
  'Arakawa', 'Bunkyo', 'Taito', 'Chuo', 'Chiyoda',
].map((ward) => `${ward}, Tokyo`);

function uniqueCities(...lists: ReadonlyArray<readonly string[]>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const city of lists.flat()) {
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(city);
  }
  return out;
}

export const COUNTRY_PROFILES: readonly CountryProfile[] = [
  {
    code: 'SG',
    name: 'Singapore',
    aliases: ['sg', 'sgp', 'singapore'],
    regionCode: 'SG',
    languageCode: 'en',
    cities: SG_PLANNING_AREAS,
  },
  {
    code: 'MY',
    name: 'Malaysia',
    aliases: ['my', 'mys', 'malaysia'],
    regionCode: 'MY',
    languageCode: 'en',
    cities: MY_CITIES,
  },
  {
    code: 'JP',
    name: 'Japan',
    aliases: ['jp', 'jpn', 'japan', 'nippon', 'nihon'],
    regionCode: 'JP',
    languageCode: 'ja',
    cities: uniqueCities(['Tokyo'], TOKYO_SPECIAL_WARDS, JP_CITIES),
  },
];

export function resolveCountry(input: string): CountryProfile | null {
  const key = input.trim().toLowerCase();
  if (!key) return null;
  return COUNTRY_PROFILES.find((p) => p.aliases.includes(key) || p.code.toLowerCase() === key) ?? null;
}

export function supportedCountries(): string[] {
  return COUNTRY_PROFILES.map((p) => `${p.name} (${p.code})`);
}
