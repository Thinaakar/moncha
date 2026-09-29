export type DummyLead = {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  city: string | null;
  phone: string | null;
  address: string | null;
  queue: string;
  websiteStatus: string | null;
  createdAt: string;
  source: string;
};

export const DUMMY_LEADS: DummyLead[] = [
  {
    id: 'dummy-1',
    name: 'Harbor Dental',
    domain: 'harbordental.example',
    country: 'United States',
    city: 'Austin',
    phone: '+1 512 555 0142',
    address: '120 Congress Ave, Austin, TX',
    queue: 'QUALIFIED',
    websiteStatus: 'ACTIVE',
    createdAt: '2026-09-12',
    source: 'google_places',
  },
  {
    id: 'dummy-2',
    name: 'Northwind Clinic',
    domain: 'northwindclinic.example',
    country: 'Canada',
    city: 'Toronto',
    phone: '+1 416 555 0198',
    address: '88 King St W, Toronto, ON',
    queue: 'NEEDS_REVIEW',
    websiteStatus: 'ACTIVE',
    createdAt: '2026-09-14',
    source: 'google_places',
  },
  {
    id: 'dummy-3',
    name: 'Bright Path Realty',
    domain: 'brightpath.example',
    country: 'United Kingdom',
    city: 'London',
    phone: '+44 20 7946 0991',
    address: '14 Baker Street, London',
    queue: 'HAS_ASSISTANT',
    websiteStatus: 'ACTIVE',
    createdAt: '2026-09-16',
    source: 'yelp',
  },
  {
    id: 'dummy-4',
    name: 'Oak Street Bakery',
    domain: null,
    country: 'United States',
    city: 'Portland',
    phone: '+1 503 555 0177',
    address: '410 Oak Street, Portland, OR',
    queue: 'NO_WEBSITE',
    websiteStatus: null,
    createdAt: '2026-09-18',
    source: 'csv_import',
  },
  {
    id: 'dummy-5',
    name: 'Summit Auto Care',
    domain: 'summitautocare.example',
    country: 'Australia',
    city: 'Sydney',
    phone: '+61 2 5550 1844',
    address: '22 George Street, Sydney',
    queue: 'PENDING_AUDIT',
    websiteStatus: 'UNCHECKED',
    createdAt: '2026-09-20',
    source: 'google_places',
  },
];

export function findDummyLead(id: string) {
  return DUMMY_LEADS.find((lead) => lead.id === id);
}
