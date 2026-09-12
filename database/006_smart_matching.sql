-- Phase 5: Smart organization matching

CREATE UNIQUE INDEX IF NOT EXISTS uq_organizations_name ON organizations(name);

CREATE TABLE IF NOT EXISTS expertise_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_expertise (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  expertise_id UUID NOT NULL REFERENCES expertise_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, expertise_id)
);

CREATE INDEX IF NOT EXISTS idx_org_expertise_expertise ON organization_expertise(expertise_id);

CREATE TABLE IF NOT EXISTS challenge_matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  match_type TEXT NOT NULL CHECK (match_type IN ('COLLEGE','INDUSTRY')),
  match_score NUMERIC(5,2) NOT NULL CHECK (match_score >= 0 AND match_score <= 100),
  distance_km NUMERIC(10,2),
  category_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  expertise_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  request_type_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  location_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  verification_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  reasons TEXT[] NOT NULL DEFAULT '{}',
  rank_position INTEGER,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (challenge_id, organization_id)
);

CREATE INDEX IF NOT EXISTS idx_challenge_matches_challenge
  ON challenge_matches(challenge_id, match_type, rank_position);
CREATE INDEX IF NOT EXISTS idx_challenge_matches_org
  ON challenge_matches(organization_id);
CREATE INDEX IF NOT EXISTS idx_challenge_matches_score
  ON challenge_matches(challenge_id, match_score DESC);

-- Reference expertise used by the deterministic matcher. Admins can extend this later.
INSERT INTO expertise_tags (name, slug) VALUES
('Civil Engineering','civil-engineering'),
('Environmental Engineering','environmental-engineering'),
('Water Treatment','water-treatment'),
('Water Resources','water-resources'),
('Agriculture','agriculture'),
('Irrigation','irrigation'),
('AgriTech','agritech'),
('Healthcare','healthcare'),
('Public Health','public-health'),
('Digital Health','digital-health'),
('Education Technology','education-technology'),
('Teacher Training','teacher-training'),
('Software','software'),
('AI','ai'),
('Ecology','ecology'),
('GIS','gis'),
('Waste Management','waste-management'),
('IoT','iot'),
('Renewable Energy','renewable-energy'),
('Electrical Engineering','electrical-engineering'),
('Structural Engineering','structural-engineering'),
('Transportation Engineering','transportation-engineering'),
('Mobility','mobility'),
('Networking','networking'),
('Assistive Technology','assistive-technology'),
('Accessibility','accessibility'),
('Social Sciences','social-sciences'),
('Management','management'),
('Rural Development','rural-development'),
('Urban Planning','urban-planning'),
('Public Administration','public-administration'),
('Disaster Management','disaster-management'),
('Community Development','community-development'),
('Problem Solving','problem-solving'),
('Infrastructure','infrastructure')
ON CONFLICT (slug) DO NOTHING;
