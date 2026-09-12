-- Reference additions used by Phase 4 routing
INSERT INTO categories (name, slug) VALUES
('Waste Management','waste-management'),
('Transportation','transportation')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO request_types (name, slug) VALUES
('Technical Solution','technical-solution'),
('Infrastructure Support','infrastructure-support')
ON CONFLICT (slug) DO NOTHING;

-- Phase 4: AI intelligence and duplicate detection
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS challenge_ai_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL UNIQUE REFERENCES challenges(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  subcategory TEXT,
  urgency TEXT NOT NULL CHECK (urgency IN ('LOW','NORMAL','HIGH','URGENT')),
  affected_sectors TEXT[] NOT NULL DEFAULT '{}',
  keywords TEXT[] NOT NULL DEFAULT '{}',
  expertise_tags TEXT[] NOT NULL DEFAULT '{}',
  recommended_request_type_ids UUID[] NOT NULL DEFAULT '{}',
  quality_score INTEGER NOT NULL CHECK (quality_score BETWEEN 0 AND 100),
  quality_notes TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL DEFAULT 'fallback',
  model TEXT,
  raw_response JSONB,
  analyzed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_analysis_category ON challenge_ai_analysis(category_id);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_urgency ON challenge_ai_analysis(urgency);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_analyzed_at ON challenge_ai_analysis(analyzed_at);

CREATE TABLE IF NOT EXISTS challenge_duplicate_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  possible_duplicate_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  similarity_score NUMERIC(5,4) NOT NULL CHECK (similarity_score >= 0 AND similarity_score <= 1),
  matched_on TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CONFIRMED','DISMISSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (challenge_id <> possible_duplicate_id),
  UNIQUE (challenge_id, possible_duplicate_id)
);

CREATE INDEX IF NOT EXISTS idx_duplicate_flags_challenge ON challenge_duplicate_flags(challenge_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_flags_possible ON challenge_duplicate_flags(possible_duplicate_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_flags_status ON challenge_duplicate_flags(status);

CREATE TABLE IF NOT EXISTS challenge_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  from_status challenge_status,
  to_status challenge_status NOT NULL,
  changed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenge_status_history_challenge
  ON challenge_status_history(challenge_id, created_at);

CREATE OR REPLACE FUNCTION set_ai_analysis_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS challenge_ai_analysis_updated_at ON challenge_ai_analysis;
CREATE TRIGGER challenge_ai_analysis_updated_at
BEFORE UPDATE ON challenge_ai_analysis
FOR EACH ROW EXECUTE FUNCTION set_ai_analysis_updated_at();
