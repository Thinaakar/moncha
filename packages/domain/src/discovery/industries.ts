export type IndustryCategory =
  | 'Healthcare & Medical'
  | 'Beauty & Wellness'
  | 'Fitness & Recreation'
  | 'Food, Dining & Hospitality'
  | 'Professional & Financial Services'
  | 'Automotive'
  | 'Home, Trades & Maintenance'
  | 'Education & Training'
  | 'Events & Lifestyle'
  | 'Custom'
  | 'General';

export type DefaultIndustryItem = {
  name: string;
  slug: string;
  category: IndustryCategory;
};

/** Normalizes an industry name into a search keyword slug (e.g., "Medical Clinic" -> "medical clinic"). */
export function normalizeIndustrySlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Pre-seeded catalog of 30 standard industries with categories and display names. */
export const DEFAULT_INDUSTRY_ITEMS: readonly DefaultIndustryItem[] = [
  // Healthcare & Medical
  { name: 'Dentist', slug: 'dentist', category: 'Healthcare & Medical' },
  { name: 'Medical Clinic', slug: 'medical clinic', category: 'Healthcare & Medical' },
  { name: 'Physiotherapy Clinic', slug: 'physiotherapy clinic', category: 'Healthcare & Medical' },
  { name: 'Chiropractor', slug: 'chiropractor', category: 'Healthcare & Medical' },
  { name: 'Veterinary Clinic', slug: 'veterinary clinic', category: 'Healthcare & Medical' },
  { name: 'Aesthetic Clinic', slug: 'aesthetic clinic', category: 'Healthcare & Medical' },

  // Beauty & Wellness
  { name: 'Hair Salon', slug: 'hair salon', category: 'Beauty & Wellness' },
  { name: 'Beauty Salon', slug: 'beauty salon', category: 'Beauty & Wellness' },
  { name: 'Spa', slug: 'spa', category: 'Beauty & Wellness' },

  // Fitness & Recreation
  { name: 'Gym', slug: 'gym', category: 'Fitness & Recreation' },
  { name: 'Yoga Studio', slug: 'yoga studio', category: 'Fitness & Recreation' },

  // Food, Dining & Hospitality
  { name: 'Restaurant', slug: 'restaurant', category: 'Food, Dining & Hospitality' },
  { name: 'Cafe', slug: 'cafe', category: 'Food, Dining & Hospitality' },
  { name: 'Bakery', slug: 'bakery', category: 'Food, Dining & Hospitality' },
  { name: 'Hotel', slug: 'hotel', category: 'Food, Dining & Hospitality' },

  // Professional & Financial Services
  { name: 'Real Estate Agency', slug: 'real estate agency', category: 'Professional & Financial Services' },
  { name: 'Law Firm', slug: 'law firm', category: 'Professional & Financial Services' },
  { name: 'Accounting Firm', slug: 'accounting firm', category: 'Professional & Financial Services' },
  { name: 'Insurance Agency', slug: 'insurance agency', category: 'Professional & Financial Services' },

  // Automotive
  { name: 'Car Repair', slug: 'car repair', category: 'Automotive' },
  { name: 'Car Dealer', slug: 'car dealer', category: 'Automotive' },

  // Home, Trades & Maintenance
  { name: 'Plumber', slug: 'plumber', category: 'Home, Trades & Maintenance' },
  { name: 'Electrician', slug: 'electrician', category: 'Home, Trades & Maintenance' },
  { name: 'Interior Design', slug: 'interior design', category: 'Home, Trades & Maintenance' },
  { name: 'Cleaning Service', slug: 'cleaning service', category: 'Home, Trades & Maintenance' },

  // Education & Training
  { name: 'Tuition Centre', slug: 'tuition centre', category: 'Education & Training' },
  { name: 'Language School', slug: 'language school', category: 'Education & Training' },
  { name: 'Driving School', slug: 'driving school', category: 'Education & Training' },

  // Events & Lifestyle
  { name: 'Wedding Planner', slug: 'wedding planner', category: 'Events & Lifestyle' },
  { name: 'Florist', slug: 'florist', category: 'Events & Lifestyle' },
];

/** Local-business search terms used when a country crawl is not given explicit keywords. */
export const DEFAULT_INDUSTRIES: readonly string[] = DEFAULT_INDUSTRY_ITEMS.map((item) => item.slug);
