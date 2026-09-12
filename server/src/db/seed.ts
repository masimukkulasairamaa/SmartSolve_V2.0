import { hashPassword } from "../auth.js";
import { pool } from "./pool.js";
import { analyzeChallenge } from "../ai.js";
import { refreshChallengeMatches } from "../matching.js";

async function seedReferenceCheck() {
  const result = await pool.query("SELECT COUNT(*)::int AS count FROM categories");
  const expertise = await pool.query("SELECT COUNT(*)::int AS count FROM expertise_tags");
  console.log(`Reference categories available: ${result.rows[0].count}; expertise tags: ${expertise.rows[0].count}`);
}

async function seedDemoData() {
  if (process.env.DEMO_SEED !== "true") {
    console.log("Demo seed disabled. Set DEMO_SEED=true to create presentation data.");
    return;
  }

  const email = "demo.citizen@jip.local";
  const password = "DemoCitizen#2026";
  const passwordHash = await hashPassword(password);

  const userResult = await pool.query(
    `INSERT INTO users (full_name,email,password_hash,role,preferred_language)
     VALUES ('Demo Citizen',$1,$2,'CITIZEN','en')
     ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name
     RETURNING id`,
    [email, passwordHash]
  );
  const userId = userResult.rows[0].id;

  const samples = [
    {
      title: "Contaminated drinking water near village school",
      description: "Residents near a village school report that drinking water from the local handpump has an unusual smell and taste. Around 80 families use the source daily, and a field water-quality investigation and practical treatment recommendation are needed.",
      category: "water-resources", request: "field-investigation", urgency: "HIGH", district: "Ranchi", latitude: 23.3441, longitude: 85.3096
    },
    {
      title: "Irregular waste collection in a growing village market",
      description: "Solid waste is accumulating around the weekly market because collection is irregular. Residents want a practical segregation, collection and recycling model that can be piloted with the local community.",
      category: "waste-management", request: "community-project", urgency: "NORMAL", district: "Khunti", latitude: 23.0766, longitude: 85.2782
    }
  ];

  for (const sample of samples) {
    const exists = await pool.query("SELECT id FROM challenges WHERE citizen_id=$1 AND title=$2", [userId, sample.title]);
    if (exists.rowCount) continue;

    const cat = await pool.query("SELECT id FROM categories WHERE slug=$1", [sample.category]);
    const rt = await pool.query("SELECT id FROM request_types WHERE slug=$1", [sample.request]);
    const challenge = await pool.query(
      `INSERT INTO challenges
       (citizen_id,title,description,preferred_language,category_id,request_type_id,urgency_hint,district,latitude,longitude)
       VALUES ($1,$2,$3,'en',$4,$5,$6,$7,$8,$9) RETURNING id`,
      [userId, sample.title, sample.description, cat.rows[0].id, rt.rows[0].id, sample.urgency, sample.district, sample.latitude, sample.longitude]
    );
    await pool.query(
      `INSERT INTO challenge_status_history (challenge_id,from_status,to_status,changed_by,reason)
       VALUES ($1,NULL,'SUBMITTED',$2,'Demo seed challenge')`,
      [challenge.rows[0].id, userId]
    );
  }

  const organizations = [
    { name: "Birsa Institute of Technology Innovation Cell", type: "COLLEGE", district: "Ranchi", lat: 23.3450, lon: 85.3090, desc: "Engineering institution with multidisciplinary student innovation teams." },
    { name: "National Institute of Technology Jamshedpur", type: "COLLEGE", district: "East Singhbhum", lat: 22.7767, lon: 86.1435, desc: "Engineering and technology university supporting applied research and innovation." },
    { name: "Birla Institute of Technology Mesra", type: "UNIVERSITY", district: "Ranchi", lat: 23.4125, lon: 85.4398, desc: "Technology university with engineering, science and research capabilities." },
    { name: "Central University of Jharkhand", type: "UNIVERSITY", district: "Ranchi", lat: 23.4200, lon: 85.5700, desc: "Multidisciplinary university with research and community engagement." },
    { name: "Jharkhand Institute of Engineering and Technology", type: "COLLEGE", district: "Hazaribagh", lat: 23.9920, lon: 85.3610, desc: "Applied engineering and community project capabilities." },
    { name: "Techno India University Jharkhand", type: "UNIVERSITY", district: "Ranchi", lat: 23.3460, lon: 85.3110, desc: "Technology-focused university with software and innovation expertise." },
    { name: "Tata Steel Community Innovation Lab", type: "CSR", district: "East Singhbhum", lat: 22.8046, lon: 86.2029, desc: "CSR and community innovation partner supporting implementation pilots." },
    { name: "Jamshedpur Water Solutions", type: "INDUSTRY", district: "East Singhbhum", lat: 22.8040, lon: 86.1850, desc: "Water treatment and monitoring solutions provider." },
    { name: "GreenLoop Waste Technologies", type: "STARTUP", district: "Ranchi", lat: 23.3448, lon: 85.3160, desc: "Waste segregation, collection and recycling technology startup." },
    { name: "Jharkhand Rural Innovation Hub", type: "INNOVATION_HUB", district: "Khunti", lat: 23.0740, lon: 85.2780, desc: "Community innovation hub for rural pilots and local entrepreneurship." },
    { name: "AquaSense Research Laboratory", type: "RESEARCH_LAB", district: "Ranchi", lat: 23.3500, lon: 85.3300, desc: "Applied research laboratory focused on water quality and sensing." },
    { name: "Ranchi Smart Infrastructure MSME", type: "MSME", district: "Ranchi", lat: 23.3550, lon: 85.3200, desc: "MSME providing civic infrastructure and IoT implementation support." }
  ];

  for (const org of organizations) {
    await pool.query(
      `INSERT INTO organizations (name,organization_type,description,district,latitude,longitude,verified,active,receives_sos_alerts)
       VALUES ($1,$2::organization_type,$3,$4,$5,$6,TRUE,TRUE,$7)
       ON CONFLICT (name) DO UPDATE SET description=EXCLUDED.description, district=EXCLUDED.district, latitude=EXCLUDED.latitude, longitude=EXCLUDED.longitude, verified=EXCLUDED.verified, active=EXCLUDED.active, receives_sos_alerts=EXCLUDED.receives_sos_alerts`,
      [org.name, org.type, org.desc, org.district, org.lat, org.lon, ["Tata Steel Community Innovation Lab","Jamshedpur Water Solutions","AquaSense Research Laboratory","Jharkhand Rural Innovation Hub"].includes(org.name)]
    );
  }

  // Demo collaboration accounts for the hackathon walkthrough.
  const demoAccounts = [
    { email: "demo.college.admin@jip.local", name: "Demo College Admin", role: "ORGANIZATION_ADMIN", org: "Birsa Institute of Technology Innovation Cell", password: "DemoAdmin#2026" },
    { email: "demo.student@jip.local", name: "Demo Student", role: "STUDENT", org: "Birsa Institute of Technology Innovation Cell", password: "DemoStudent#2026" },
    { email: "demo.faculty@jip.local", name: "Demo Faculty Mentor", role: "FACULTY", org: "Birsa Institute of Technology Innovation Cell", password: "DemoFaculty#2026" },
    { email: "demo.industry@jip.local", name: "Demo Industry Member", role: "INDUSTRY_MEMBER", org: "Jamshedpur Water Solutions", password: "DemoIndustry#2026" }
  ];
  for (const account of demoAccounts) {
    const org = await pool.query("SELECT id FROM organizations WHERE name=$1", [account.org]);
    if (!org.rowCount) continue;
    const passwordHash = await hashPassword(account.password);
    await pool.query(
      `INSERT INTO users (full_name,email,password_hash,role,organization_id,preferred_language)
       VALUES ($1,$2,$3,$4::user_role,$5,'en')
       ON CONFLICT(email) DO UPDATE SET full_name=EXCLUDED.full_name, role=EXCLUDED.role, organization_id=EXCLUDED.organization_id, active=TRUE`,
      [account.name, account.email, passwordHash, account.role, org.rows[0].id]
    );
  }

  const categoryMap: Record<string, string[]> = {
    "Birsa Institute of Technology Innovation Cell": ["water-resources", "environment", "infrastructure", "education"],
    "National Institute of Technology Jamshedpur": ["water-resources", "environment", "energy", "infrastructure"],
    "Birla Institute of Technology Mesra": ["water-resources", "digital-services", "energy", "agriculture"],
    "Central University of Jharkhand": ["education", "rural-livelihoods", "environment", "public-administration"],
    "Jharkhand Institute of Engineering and Technology": ["water-resources", "infrastructure", "agriculture"],
    "Techno India University Jharkhand": ["digital-services", "education", "healthcare", "accessibility"],
    "Tata Steel Community Innovation Lab": ["water-resources", "waste-management", "environment", "rural-livelihoods"],
    "Jamshedpur Water Solutions": ["water-resources", "sanitation", "environment"],
    "GreenLoop Waste Technologies": ["waste-management", "environment", "urban-development"],
    "Jharkhand Rural Innovation Hub": ["rural-livelihoods", "agriculture"],
    "AquaSense Research Laboratory": ["water-resources", "environment", "healthcare"],
    "Ranchi Smart Infrastructure MSME": ["infrastructure", "digital-services", "energy", "waste-management"]
  };
  const expertiseMap: Record<string, string[]> = {
    "Birsa Institute of Technology Innovation Cell": ["Civil Engineering", "Environmental Engineering", "Water Resources", "Software", "GIS"],
    "National Institute of Technology Jamshedpur": ["Civil Engineering", "Environmental Engineering", "Water Treatment", "Electrical Engineering", "IoT", "GIS"],
    "Birla Institute of Technology Mesra": ["Software", "AI", "Civil Engineering", "Renewable Energy", "IoT", "Agriculture"],
    "Central University of Jharkhand": ["Social Sciences", "Rural Development", "Education Technology", "Public Administration", "Ecology"],
    "Jharkhand Institute of Engineering and Technology": ["Civil Engineering", "Structural Engineering", "Agriculture", "Irrigation"],
    "Techno India University Jharkhand": ["Software", "AI", "Networking", "Assistive Technology", "Education Technology"],
    "Tata Steel Community Innovation Lab": ["Community Development", "Waste Management", "Water Treatment", "Rural Development", "Management"],
    "Jamshedpur Water Solutions": ["Water Treatment", "Water Resources", "Civil Engineering", "Environmental Engineering", "IoT"],
    "GreenLoop Waste Technologies": ["Waste Management", "IoT", "Software", "Environmental Engineering", "Management"],
    "Jharkhand Rural Innovation Hub": ["Rural Development", "Agriculture", "Management", "Community Development"],
    "AquaSense Research Laboratory": ["Water Treatment", "Environmental Engineering", "IoT", "Public Health", "GIS"],
    "Ranchi Smart Infrastructure MSME": ["Civil Engineering", "IoT", "Electrical Engineering", "Software", "Infrastructure"]
  };
  const requestMap: Record<string, string[]> = {
    "Birsa Institute of Technology Innovation Cell": ["student-project", "research-project", "field-investigation", "technical-consultation", "prototyping"],
    "National Institute of Technology Jamshedpur": ["research-project", "technical-consultation", "field-investigation", "testing", "prototyping"],
    "Birla Institute of Technology Mesra": ["student-project", "research-project", "technical-solution", "prototyping", "testing"],
    "Central University of Jharkhand": ["research-project", "field-study", "community-project", "student-project", "mentorship"],
    "Jharkhand Institute of Engineering and Technology": ["field-investigation", "student-project", "technical-consultation", "implementation", "infrastructure-support"],
    "Techno India University Jharkhand": ["student-project", "technical-solution", "prototyping", "testing", "mentorship"],
    "Tata Steel Community Innovation Lab": ["community-project", "funding", "implementation", "mentorship", "prototyping"],
    "Jamshedpur Water Solutions": ["technical-consultation", "field-investigation", "implementation", "testing", "infrastructure-support"],
    "GreenLoop Waste Technologies": ["technical-solution", "prototyping", "implementation", "community-project", "testing"],
    "Jharkhand Rural Innovation Hub": ["community-project", "field-study", "mentorship", "implementation", "funding"],
    "AquaSense Research Laboratory": ["research-project", "field-investigation", "testing", "technical-consultation", "prototyping"],
    "Ranchi Smart Infrastructure MSME": ["technical-solution", "implementation", "infrastructure-support", "testing", "funding"]
  };

  for (const org of organizations) {
    const orgResult = await pool.query("SELECT id FROM organizations WHERE name=$1", [org.name]);
    if (!orgResult.rowCount) continue;
    const orgId = orgResult.rows[0].id;
    for (const slug of categoryMap[org.name] ?? []) {
      const cat = await pool.query("SELECT id FROM categories WHERE slug=$1", [slug]);
      if (cat.rowCount) await pool.query("INSERT INTO organization_categories (organization_id,category_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [orgId, cat.rows[0].id]);
    }
    for (const name of expertiseMap[org.name] ?? []) {
      const tag = await pool.query("SELECT id FROM expertise_tags WHERE name=$1", [name]);
      if (tag.rowCount) await pool.query("INSERT INTO organization_expertise (organization_id,expertise_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [orgId, tag.rows[0].id]);
    }
    for (const slug of requestMap[org.name] ?? []) {
      const rt = await pool.query("SELECT id FROM request_types WHERE slug=$1", [slug]);
      if (rt.rowCount) await pool.query("INSERT INTO organization_request_types (organization_id,request_type_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [orgId, rt.rows[0].id]);
    }
  }

  const demoChallenges = await pool.query(
    `SELECT c.id,c.title,c.description,c.status FROM challenges c WHERE c.citizen_id=$1 ORDER BY c.created_at`,
    [userId]
  );
  for (const row of demoChallenges.rows) {
    try {
      await analyzeChallenge(row.id);
      await refreshChallengeMatches(row.id);
    } catch (error) {
      console.warn(`Could not prepare demo matching for ${row.id}:`, error);
    }
  }

  // Phase 7 demo project: one challenge is carried into a realistic delivery lifecycle.
  const admin = await pool.query(`SELECT u.id,u.organization_id FROM users u WHERE u.email='demo.college.admin@jip.local'`);
  const demoChallenge = demoChallenges.rows[0];
  if (admin.rowCount && demoChallenge) {
    const existingProject = await pool.query(`SELECT id FROM projects WHERE challenge_id=$1`, [demoChallenge.id]);
    let projectId = existingProject.rows[0]?.id as string | undefined;
    if (!projectId) {
      const created = await pool.query(
        `INSERT INTO projects(challenge_id,lead_organization_id,title,description,status,created_by)
         VALUES($1,$2,$3,$4,'ACTIVE',$5) RETURNING id`,
        [demoChallenge.id, admin.rows[0].organization_id, `Community Water Quality Pilot — ${demoChallenge.title}`, 'A demonstration project showing research, field study, prototype, testing, implementation and validation workflow.', admin.rows[0].id]
      );
      projectId = created.rows[0].id;
      await pool.query(`INSERT INTO project_members(project_id,user_id,member_role,status) VALUES($1,$2,'LEAD','ACTIVE') ON CONFLICT DO NOTHING`, [projectId, admin.rows[0].id]);
      await pool.query(`UPDATE challenges SET status='ADOPTED' WHERE id=$1 AND status NOT IN ('RESOLVED')`, [demoChallenge.id]);
    }
    const faculty = await pool.query(`SELECT id FROM users WHERE email='demo.faculty@jip.local'`);
    const student = await pool.query(`SELECT id FROM users WHERE email='demo.student@jip.local'`);
    if (faculty.rowCount) await pool.query(`INSERT INTO project_members(project_id,user_id,member_role,status) VALUES($1,$2,'FACULTY_MENTOR','ACTIVE') ON CONFLICT DO NOTHING`, [projectId, faculty.rows[0].id]);
    if (student.rowCount) await pool.query(`INSERT INTO project_members(project_id,user_id,member_role,status) VALUES($1,$2,'STUDENT','ACTIVE') ON CONFLICT DO NOTHING`, [projectId, student.rows[0].id]);
    const milestones = [
      ['Research','Review existing reports, water complaints and available records.'],
      ['Field Study','Collect water samples and document the source and surrounding conditions.'],
      ['Prototype','Design a practical treatment and monitoring approach.'],
      ['Testing','Test the proposed approach and record evidence and feedback.'],
      ['Implementation','Pilot the solution with the community and document results.'],
      ['Validation','Obtain citizen/stakeholder validation and close the project.']
    ];
    for (let i=0;i<milestones.length;i++) {
      await pool.query(`INSERT INTO project_milestones(project_id,name,description,sequence_no,status,created_by) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(project_id,sequence_no) DO NOTHING`, [projectId,milestones[i][0],milestones[i][1],i+1,i<2?'COMPLETED':i===2?'IN_PROGRESS':'NOT_STARTED',admin.rows[0].id]);
    }
    const sol = await pool.query(`SELECT id FROM solutions WHERE project_id=$1 LIMIT 1`, [projectId]);
    if (!sol.rowCount && student.rowCount) {
      await pool.query(`INSERT INTO solutions(project_id,version,problem_understanding,proposed_solution,technology,expected_impact,estimated_cost,implementation_plan,status,submitted_by,submitted_at) VALUES($1,1,$2,$3,$4,$5,$6,$7,'SUBMITTED',$8,NOW())`, [projectId,'The community relies on a water source with suspected contamination and needs an affordable, locally maintainable intervention.','Deploy a low-cost treatment and monitoring pilot with periodic testing, community training and a simple reporting workflow.','Water-quality testing, filtration, IoT/field measurements and a lightweight reporting workflow.','Safer drinking water, faster detection of contamination and a replicable village-level operating model.',125000,'Field assessment → prototype → controlled testing → community pilot → stakeholder validation.',student.rows[0].id]);
    }
  }

  console.log(`Demo citizen: ${email} / ${password}`);
  console.log(`Demo organizations seeded: ${organizations.length}`);
}

try {
  await seedReferenceCheck();
  await seedDemoData();
  console.log("Seed complete.");
} catch (error) {
  console.error("Seed failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
