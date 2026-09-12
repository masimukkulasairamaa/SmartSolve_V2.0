DO $$ BEGIN
  CREATE TYPE challenge_status AS ENUM (
  'SUBMITTED',
  'UNDER_REVIEW',
  'AI_ANALYZED',
  'INSTITUTIONS_MATCHED',
  'VIEWED',
  'ADOPTED',
  'SOLUTION_DEVELOPMENT',
  'SOLUTION_PROPOSED',
  'IMPLEMENTATION',
  'RESOLVED'
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  citizen_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  request_type_id UUID REFERENCES request_types(id) ON DELETE SET NULL,
  status challenge_status NOT NULL DEFAULT 'SUBMITTED',
  urgency_hint TEXT NOT NULL DEFAULT 'NORMAL',
  district TEXT,
  address TEXT,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  allow_contact BOOLEAN NOT NULL DEFAULT FALSE,
  contact_phone TEXT,
  contact_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS challenge_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL CHECK (media_type IN ('IMAGE','VIDEO','DOCUMENT')),
  original_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_challenges_citizen ON challenges(citizen_id);
CREATE INDEX IF NOT EXISTS idx_challenges_status ON challenges(status);
CREATE INDEX IF NOT EXISTS idx_challenges_location ON challenges(latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_challenge_media_challenge ON challenge_media(challenge_id);

CREATE OR REPLACE FUNCTION set_challenge_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS challenges_updated_at ON challenges;
CREATE TRIGGER challenges_updated_at
BEFORE UPDATE ON challenges
FOR EACH ROW EXECUTE FUNCTION set_challenge_updated_at();
