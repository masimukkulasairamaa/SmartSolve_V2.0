CREATE EXTENSION IF NOT EXISTS "pgcrypto";

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM (
  'CITIZEN',
  'STUDENT',
  'FACULTY',
  'ORGANIZATION_ADMIN',
  'INDUSTRY_MEMBER',
  'GOVERNMENT',
  'SUPER_ADMIN'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE organization_type AS ENUM (
  'COLLEGE',
  'UNIVERSITY',
  'INDUSTRY',
  'STARTUP',
  'MSME',
  'CSR',
  'RESEARCH_LAB',
  'INNOVATION_HUB',
  'COMMUNITY_ORG',
  'PANCHAYAT',
  'ULB',
  'GOVERNMENT_AGENCY'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  organization_type organization_type NOT NULL,
  description TEXT DEFAULT '',
  district TEXT,
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role user_role NOT NULL,
  organization_id UUID REFERENCES organizations(id) ON DELETE SET NULL,
  phone TEXT,
  preferred_language TEXT DEFAULT 'en',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS request_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL
);

CREATE TABLE IF NOT EXISTS organization_categories (
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, category_id)
);

CREATE TABLE IF NOT EXISTS organization_request_types (
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  request_type_id UUID REFERENCES request_types(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, request_type_id)
);

CREATE INDEX IF NOT EXISTS idx_users_org ON users(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_location ON organizations(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_org_type ON organizations(organization_type);
