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
    country: 'Singapore',
    city: 'Singapore',
    phone: '+65 6221 4480',
    address: '80 Robinson Road, Singapore 068898',
    queue: 'QUALIFIED',
    websiteStatus: 'ACTIVE',
    createdAt: '2026-09-12',
    source: 'google_places',
  },
  {
    id: 'dummy-2',
    name: 'Northwind Clinic',
    domain: 'northwindclinic.example',
    country: 'Malaysia',
    city: 'Kuala Lumpur',
    phone: '+60 3 2141 5520',
    address: '163 Jalan Ampang, 50450 Kuala Lumpur',
    queue: 'NEEDS_REVIEW',
    websiteStatus: 'ACTIVE',
    createdAt: '2026-09-14',
    source: 'google_places',
  },
  {
    id: 'dummy-3',
    name: 'Bright Path Realty',
    domain: 'brightpath.example',
    country: 'United Arab Emirates',
    city: 'Dubai',
    phone: '+971 4 331 2200',
    address: 'Sheikh Zayed Road, Trade Centre, Dubai',
    queue: 'HAS_ASSISTANT',
    websiteStatus: 'ACTIVE',
    createdAt: '2026-09-16',
    source: 'yelp',
  },
  {
    id: 'dummy-4',
    name: 'Oak Street Bakery',
    domain: null,
    country: 'Malaysia',
    city: 'George Town',
    phone: '+60 4 226 1877',
    address: '42 Lebuh Chulia, 10200 George Town, Penang',
    queue: 'NO_WEBSITE',
    websiteStatus: null,
    createdAt: '2026-09-18',
    source: 'csv_import',
  },
  {
    id: 'dummy-5',
    name: 'Summit Auto Care',
    domain: 'summitautocare.example',
    country: 'Saudi Arabia',
    city: 'Riyadh',
    phone: '+966 11 464 0300',
    address: 'King Fahd Road, Al Olaya, Riyadh',
    queue: 'PENDING_AUDIT',
    websiteStatus: 'UNCHECKED',
    createdAt: '2026-09-20',
    source: 'google_places',
  },
];

export type DummyJob = {
  id: string;
  type: string;
  status: string;
  when: string;
  detail?: string;
  error?: string;
};

export const DUMMY_JOBS: DummyJob[] = [
  { id: 'job-1', type: 'places_discovery', status: 'done', when: 'Today 10:02', detail: '25 found · 18 saved' },
  { id: 'job-2', type: 'csv_import', status: 'running', when: 'Today 09:40', detail: '48 rows in file' },
  {
    id: 'job-3',
    type: 'places_discovery',
    status: 'failed',
    when: 'Today 09:10',
    error: 'Google Places quota reached',
  },
  { id: 'job-4', type: 'website_audit', status: 'done', when: 'Yesterday 18:00', detail: '12 sites checked' },
];

export function findDummyLead(id: string) {
  return DUMMY_LEADS.find((lead) => lead.id === id);
}
