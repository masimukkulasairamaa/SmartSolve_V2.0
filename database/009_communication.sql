-- Phase 8: translation, notifications, project communication and SOS
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS challenge_translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  source_language TEXT NOT NULL,
  target_language TEXT NOT NULL,
  original_title TEXT NOT NULL,
  original_description TEXT NOT NULL,
  translated_title TEXT NOT NULL,
  translated_description TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(challenge_id, target_language)
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_type TEXT,
  entity_id UUID,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(user_id, read_at) WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS project_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  message TEXT NOT NULL CHECK (char_length(message) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_project_messages_project_created ON project_messages(project_id, created_at ASC);

ALTER TABLE organizations ADD COLUMN IF NOT EXISTS receives_sos_alerts BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS sos_radius_km DOUBLE PRECISION NOT NULL DEFAULT 50 CHECK (sos_radius_km > 0 AND sos_radius_km <= 500);

DO $$ BEGIN
  CREATE TYPE sos_status AS ENUM ('ACTIVE','ACKNOWLEDGED','RESOLVED','CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS sos_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  latitude DOUBLE PRECISION NOT NULL CHECK (latitude BETWEEN -90 AND 90),
  longitude DOUBLE PRECISION NOT NULL CHECK (longitude BETWEEN -180 AND 180),
  urgent_information TEXT NOT NULL DEFAULT '',
  status sos_status NOT NULL DEFAULT 'ACTIVE',
  activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolution_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_sos_status_time ON sos_alerts(status, activated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sos_user ON sos_alerts(user_id, activated_at DESC);

CREATE TABLE IF NOT EXISTS sos_recipients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sos_alert_id UUID NOT NULL REFERENCES sos_alerts(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  distance_km DOUBLE PRECISION,
  notified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(sos_alert_id, organization_id)
);
CREATE INDEX IF NOT EXISTS idx_sos_recipients_alert ON sos_recipients(sos_alert_id);

CREATE OR REPLACE FUNCTION set_translation_updated_at()
RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS challenge_translations_updated_at ON challenge_translations;
CREATE TRIGGER challenge_translations_updated_at BEFORE UPDATE ON challenge_translations FOR EACH ROW EXECUTE FUNCTION set_translation_updated_at();
