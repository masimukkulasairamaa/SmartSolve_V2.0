-- Challenge location refinement: human-friendly block field while preserving optional coordinates for routing.
ALTER TABLE challenges ADD COLUMN IF NOT EXISTS block TEXT;
CREATE INDEX IF NOT EXISTS idx_challenges_district_block ON challenges(district, block);
