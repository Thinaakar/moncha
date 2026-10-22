const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const statements = [
  // 1. AlterTable DiscoverySchedule
  `ALTER TABLE "DiscoverySchedule" ADD COLUMN IF NOT EXISTS "industries" TEXT[] NOT NULL DEFAULT '{}'`,

  // 2. CreateTable DiscoveryIndustry
  `CREATE TABLE IF NOT EXISTS "DiscoveryIndustry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'General',
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DiscoveryIndustry_pkey" PRIMARY KEY ("id")
  )`,

  // 3. Unique index for global defaults
  `CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveryIndustry_global_slug_key" 
   ON "DiscoveryIndustry"("slug") 
   WHERE "tenantId" IS NULL`,

  // 4. Unique index for custom industries per tenant
  `CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveryIndustry_tenant_slug_key" 
   ON "DiscoveryIndustry"("tenantId", "slug") 
   WHERE "tenantId" IS NOT NULL`,

  // 5. Indexes
  `CREATE INDEX IF NOT EXISTS "DiscoveryIndustry_tenantId_isActive_idx" ON "DiscoveryIndustry"("tenantId", "isActive")`,
  `CREATE INDEX IF NOT EXISTS "DiscoveryIndustry_category_idx" ON "DiscoveryIndustry"("category")`,
  `CREATE INDEX IF NOT EXISTS "DiscoveryIndustry_slug_idx" ON "DiscoveryIndustry"("slug")`,

  // 6. Foreign key to Tenant
  `DO $$ BEGIN
    ALTER TABLE "DiscoveryIndustry" ADD CONSTRAINT "DiscoveryIndustry_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  EXCEPTION WHEN duplicate_object THEN NULL; END $$`,

  // 7. Seed the 30 standard industries
  `INSERT INTO "DiscoveryIndustry" ("id", "tenantId", "name", "slug", "category", "isDefault", "isActive", "createdAt", "updatedAt")
   VALUES
    ('ind_dentist', NULL, 'Dentist', 'dentist', 'Healthcare & Medical', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_medical_clinic', NULL, 'Medical Clinic', 'medical clinic', 'Healthcare & Medical', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_physiotherapy_clinic', NULL, 'Physiotherapy Clinic', 'physiotherapy clinic', 'Healthcare & Medical', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_chiropractor', NULL, 'Chiropractor', 'chiropractor', 'Healthcare & Medical', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_veterinary_clinic', NULL, 'Veterinary Clinic', 'veterinary clinic', 'Healthcare & Medical', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_aesthetic_clinic', NULL, 'Aesthetic Clinic', 'aesthetic clinic', 'Healthcare & Medical', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_hair_salon', NULL, 'Hair Salon', 'hair salon', 'Beauty & Wellness', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_beauty_salon', NULL, 'Beauty Salon', 'beauty salon', 'Beauty & Wellness', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_spa', NULL, 'Spa', 'spa', 'Beauty & Wellness', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_gym', NULL, 'Gym', 'gym', 'Fitness & Recreation', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_yoga_studio', NULL, 'Yoga Studio', 'yoga studio', 'Fitness & Recreation', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_restaurant', NULL, 'Restaurant', 'restaurant', 'Food, Dining & Hospitality', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_cafe', NULL, 'Cafe', 'cafe', 'Food, Dining & Hospitality', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_bakery', NULL, 'Bakery', 'bakery', 'Food, Dining & Hospitality', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_hotel', NULL, 'Hotel', 'hotel', 'Food, Dining & Hospitality', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_real_estate_agency', NULL, 'Real Estate Agency', 'real estate agency', 'Professional & Financial Services', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_law_firm', NULL, 'Law Firm', 'law firm', 'Professional & Financial Services', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_accounting_firm', NULL, 'Accounting Firm', 'accounting firm', 'Professional & Financial Services', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_insurance_agency', NULL, 'Insurance Agency', 'insurance agency', 'Professional & Financial Services', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_car_repair', NULL, 'Car Repair', 'car repair', 'Automotive', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_car_dealer', NULL, 'Car Dealer', 'car dealer', 'Automotive', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_plumber', NULL, 'Plumber', 'plumber', 'Home, Trades & Maintenance', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_electrician', NULL, 'Electrician', 'electrician', 'Home, Trades & Maintenance', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_interior_design', NULL, 'Interior Design', 'interior design', 'Home, Trades & Maintenance', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_cleaning_service', NULL, 'Cleaning Service', 'cleaning service', 'Home, Trades & Maintenance', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_tuition_centre', NULL, 'Tuition Centre', 'tuition centre', 'Education & Training', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_language_school', NULL, 'Language School', 'language school', 'Education & Training', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_driving_school', NULL, 'Driving School', 'driving school', 'Education & Training', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_wedding_planner', NULL, 'Wedding Planner', 'wedding planner', 'Events & Lifestyle', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('ind_florist', NULL, 'Florist', 'florist', 'Events & Lifestyle', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
   ON CONFLICT ("slug") WHERE "tenantId" IS NULL DO NOTHING`,
];

async function run() {
  console.log('Applying migration 20261021190000_discovery_industries_master via PrismaClient...');
  for (let i = 0; i < statements.length; i++) {
    console.log(`Executing statement [${i + 1}/${statements.length}]...`);
    await prisma.$executeRawUnsafe(statements[i]);
  }

  console.log('Migration applied successfully!');
  const count = await prisma.discoveryIndustry.count();
  console.log('DiscoveryIndustry total rows in DB:', count);
}

run()
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
