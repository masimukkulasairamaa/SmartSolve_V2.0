-- Phase 9: government dashboard, analytics, trusted ratings and moderation
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE TYPE moderation_status AS ENUM ('VISIBLE','HIDDEN','REMOVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS organization_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review TEXT NOT NULL DEFAULT '' CHECK (char_length(review) <= 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, reviewer_id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_org_ratings_org ON organization_ratings(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS challenge_moderation (
  challenge_id UUID PRIMARY KEY REFERENCES challenges(id) ON DELETE CASCADE,
  status moderation_status NOT NULL DEFAULT 'VISIBLE',
  reason TEXT NOT NULL DEFAULT '',
  moderated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  moderated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_challenge_moderation_status ON challenge_moderation(status);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS moderation_status moderation_status NOT NULL DEFAULT 'VISIBLE';
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS verified_by UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_challenges_district_status ON challenges(district, status);
CREATE INDEX IF NOT EXISTS idx_projects_created_status ON projects(created_at, status);

CREATE OR REPLACE VIEW organization_rating_summary AS
SELECT o.id AS organization_id, COALESCE(ROUND(AVG(r.rating)::numeric,2),0) AS average_rating,
       COUNT(r.id)::int AS rating_count
FROM organizations o LEFT JOIN organization_ratings r ON r.organization_id=o.id
GROUP BY o.id;
