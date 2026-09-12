INSERT INTO categories (name, slug) VALUES
('Education','education'),
('Agriculture','agriculture'),
('Healthcare','healthcare'),
('Water Resources','water-resources'),
('Environment','environment'),
('Energy','energy'),
('Urban Development','urban-development'),
('Accessibility','accessibility'),
('Public Administration','public-administration'),
('Rural Livelihoods','rural-livelihoods'),
('Sanitation','sanitation'),
('Infrastructure','infrastructure'),
('Digital Services','digital-services'),
('Disaster Management','disaster-management'),
('Other','other')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO request_types (name, slug) VALUES
('Technical Consultation','technical-consultation'),
('Research Project','research-project'),
('Student Project','student-project'),
('Field Investigation','field-investigation'),
('Field Study','field-study'),
('Funding / Financial Support','funding'),
('Mentorship','mentorship'),
('Prototyping','prototyping'),
('Implementation Partnership','implementation'),
('Testing / Validation','testing'),
('Technology Transfer','technology-transfer'),
('Community Project','community-project')
ON CONFLICT (slug) DO NOTHING;
