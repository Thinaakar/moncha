-- Primary contact email for a company, filled from website-copy brand extraction.
ALTER TABLE "Company" ADD COLUMN IF NOT EXISTS "email" TEXT;
