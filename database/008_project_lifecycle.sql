-- Phase 7: project lifecycle, milestones, deliverables, solution, testing, validation, IP and impact
DO $$ BEGIN
  CREATE TYPE milestone_status AS ENUM ('NOT_STARTED','IN_PROGRESS','COMPLETED','BLOCKED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE solution_status AS ENUM ('DRAFT','SUBMITTED','APPROVED','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE testing_status AS ENUM ('NOT_STARTED','IN_PROGRESS','PASSED','FAILED','CONDITIONAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE validation_status AS ENUM ('PENDING','VALIDATED','NEEDS_CHANGES','REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  sequence_no INTEGER NOT NULL CHECK (sequence_no > 0),
  status milestone_status NOT NULL DEFAULT 'NOT_STARTED',
  due_date DATE,
  completed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, sequence_no)
);

CREATE TABLE IF NOT EXISTS project_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  storage_path TEXT,
  original_name TEXT,
  mime_type TEXT,
  size_bytes BIGINT,
  submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_milestone_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES project_milestones(id) ON DELETE CASCADE,
  approver_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVED','CHANGES_REQUESTED','REJECTED')),
  comments TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solutions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL CHECK (version > 0),
  problem_understanding TEXT NOT NULL,
  proposed_solution TEXT NOT NULL,
  technology TEXT NOT NULL DEFAULT '',
  expected_impact TEXT NOT NULL DEFAULT '',
  estimated_cost NUMERIC(14,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  implementation_plan TEXT NOT NULL DEFAULT '',
  status solution_status NOT NULL DEFAULT 'DRAFT',
  submitted_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_comments TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id, version)
);

CREATE TABLE IF NOT EXISTS solution_testing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solution_id UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
  status testing_status NOT NULL DEFAULT 'NOT_STARTED',
  test_plan TEXT NOT NULL DEFAULT '',
  results TEXT NOT NULL DEFAULT '',
  feedback TEXT NOT NULL DEFAULT '',
  evidence_path TEXT,
  evidence_name TEXT,
  evidence_mime_type TEXT,
  evidence_size_bytes BIGINT,
  tested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  tested_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(solution_id)
);

CREATE TABLE IF NOT EXISTS solution_validations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  solution_id UUID NOT NULL REFERENCES solutions(id) ON DELETE CASCADE,
  validator_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  validator_role TEXT NOT NULL,
  status validation_status NOT NULL DEFAULT 'PENDING',
  feedback TEXT NOT NULL DEFAULT '',
  evidence_path TEXT,
  evidence_name TEXT,
  evidence_mime_type TEXT,
  evidence_size_bytes BIGINT,
  validated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS innovation_outcomes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  patent_generated BOOLEAN NOT NULL DEFAULT FALSE,
  startup_created BOOLEAN NOT NULL DEFAULT FALSE,
  prototype_created BOOLEAN NOT NULL DEFAULT FALSE,
  technology_transfer BOOLEAN NOT NULL DEFAULT FALSE,
  research_publication BOOLEAN NOT NULL DEFAULT FALSE,
  implementation_completed BOOLEAN NOT NULL DEFAULT FALSE,
  outcome_notes TEXT NOT NULL DEFAULT '',
  reference_url TEXT,
  recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id)
);

CREATE TABLE IF NOT EXISTS impact_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  people_affected INTEGER CHECK (people_affected IS NULL OR people_affected >= 0),
  villages_affected INTEGER CHECK (villages_affected IS NULL OR villages_affected >= 0),
  district TEXT,
  estimated_cost NUMERIC(14,2) CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  time_saved_hours NUMERIC(14,2) CHECK (time_saved_hours IS NULL OR time_saved_hours >= 0),
  environmental_benefit TEXT NOT NULL DEFAULT '',
  economic_benefit TEXT NOT NULL DEFAULT '',
  other_impact TEXT NOT NULL DEFAULT '',
  evidence_path TEXT,
  evidence_name TEXT,
  evidence_mime_type TEXT,
  evidence_size_bytes BIGINT,
  recorded_by UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id, sequence_no);
CREATE INDEX IF NOT EXISTS idx_project_milestones_status ON project_milestones(status);
CREATE INDEX IF NOT EXISTS idx_project_deliverables_project ON project_deliverables(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_deliverables_milestone ON project_deliverables(milestone_id);
CREATE INDEX IF NOT EXISTS idx_solution_project ON solutions(project_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_solution_testing_solution ON solution_testing(solution_id);
CREATE INDEX IF NOT EXISTS idx_solution_validation_solution ON solution_validations(solution_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_innovation_project ON innovation_outcomes(project_id);
CREATE INDEX IF NOT EXISTS idx_impact_project ON impact_records(project_id);

CREATE OR REPLACE FUNCTION set_lifecycle_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS project_milestones_updated_at ON project_milestones;
CREATE TRIGGER project_milestones_updated_at BEFORE UPDATE ON project_milestones
FOR EACH ROW EXECUTE FUNCTION set_lifecycle_updated_at();

DROP TRIGGER IF EXISTS solutions_updated_at ON solutions;
CREATE TRIGGER solutions_updated_at BEFORE UPDATE ON solutions
FOR EACH ROW EXECUTE FUNCTION set_lifecycle_updated_at();

DROP TRIGGER IF EXISTS solution_testing_updated_at ON solution_testing;
CREATE TRIGGER solution_testing_updated_at BEFORE UPDATE ON solution_testing
FOR EACH ROW EXECUTE FUNCTION set_lifecycle_updated_at();

DROP TRIGGER IF EXISTS innovation_outcomes_updated_at ON innovation_outcomes;
CREATE TRIGGER innovation_outcomes_updated_at BEFORE UPDATE ON innovation_outcomes
FOR EACH ROW EXECUTE FUNCTION set_lifecycle_updated_at();

DROP TRIGGER IF EXISTS impact_records_updated_at ON impact_records;
CREATE TRIGGER impact_records_updated_at BEFORE UPDATE ON impact_records
FOR EACH ROW EXECUTE FUNCTION set_lifecycle_updated_at();
