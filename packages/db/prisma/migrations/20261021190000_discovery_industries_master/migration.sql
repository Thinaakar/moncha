-- AlterTable DiscoverySchedule: add industries array
ALTER TABLE "DiscoverySchedule" ADD COLUMN IF NOT EXISTS "industries" TEXT[] NOT NULL DEFAULT '{}';

-- CreateTable DiscoveryIndustry
CREATE TABLE IF NOT EXISTS "DiscoveryIndustry" (
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
);

-- Partial unique indexes:
-- 1. Exactly one global default per slug (tenantId IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveryIndustry_global_slug_key" 
ON "DiscoveryIndustry"("slug") 
WHERE "tenantId" IS NULL;

-- 2. Unique per tenant for custom industries (tenantId IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS "DiscoveryIndustry_tenant_slug_key" 
ON "DiscoveryIndustry"("tenantId", "slug") 
WHERE "tenantId" IS NOT NULL;

-- Query performance indexes
CREATE INDEX IF NOT EXISTS "DiscoveryIndustry_tenantId_isActive_idx" ON "DiscoveryIndustry"("tenantId", "isActive");
CREATE INDEX IF NOT EXISTS "DiscoveryIndustry_category_idx" ON "DiscoveryIndustry"("category");
CREATE INDEX IF NOT EXISTS "DiscoveryIndustry_slug_idx" ON "DiscoveryIndustry"("slug");

-- Foreign key to Tenant
DO $$ BEGIN
  ALTER TABLE "DiscoveryIndustry" ADD CONSTRAINT "DiscoveryIndustry_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Seed the 30 standard industries with tenantId = NULL
INSERT INTO "DiscoveryIndustry" ("id", "tenantId", "name", "slug", "category", "isDefault", "isActive", "createdAt", "updatedAt")
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
ON CONFLICT ("slug") WHERE "tenantId" IS NULL DO NOTHING;
