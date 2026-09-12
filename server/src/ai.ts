import { pool } from "./db/pool.js";
import { config } from "./config.js";

type AIAnalysis = {
  summary: string;
  categorySlug: string;
  subcategory: string;
  urgency: "LOW" | "NORMAL" | "HIGH" | "URGENT";
  affectedSectors: string[];
  keywords: string[];
  expertiseTags: string[];
  recommendedRequestTypeSlugs: string[];
  qualityScore: number;
  qualityNotes: string;
};

const allowedUrgency = new Set(["LOW", "NORMAL", "HIGH", "URGENT"]);

const categoryRules: Array<{ slug: string; terms: string[]; subcategory: string; expertise: string[]; sectors: string[] }> = [
  { slug: "water-resources", terms: ["water", "drinking", "well", "borewell", "contamination", "pipeline", "groundwater", "pond", "river"], subcategory: "Water Access & Quality", expertise: ["Water Treatment", "Civil Engineering", "Environmental Engineering"], sectors: ["Public Health", "Water & Sanitation"] },
  { slug: "sanitation", terms: ["toilet", "sewage", "sewer", "drain", "sanitation", "fecal", "wastewater"], subcategory: "Sanitation & Wastewater", expertise: ["Civil Engineering", "Environmental Engineering"], sectors: ["Public Health", "Water & Sanitation"] },
  { slug: "agriculture", terms: ["farmer", "crop", "irrigation", "agriculture", "soil", "paddy", "rice", "seed", "pest", "livestock"], subcategory: "Agricultural Productivity", expertise: ["Agriculture", "Irrigation", "AgriTech"], sectors: ["Agriculture", "Rural Livelihoods"] },
  { slug: "healthcare", terms: ["hospital", "clinic", "doctor", "health", "medicine", "patient", "ambulance", "disease", "maternal"], subcategory: "Healthcare Access", expertise: ["Healthcare", "Public Health", "Digital Health"], sectors: ["Healthcare", "Public Health"] },
  { slug: "education", terms: ["school", "student", "teacher", "education", "classroom", "college", "learning", "library"], subcategory: "Education Access", expertise: ["Education Technology", "Teacher Training", "Software"], sectors: ["Education", "Youth"] },
  { slug: "environment", terms: ["pollution", "forest", "air", "environment", "river pollution", "deforestation", "biodiversity", "climate"], subcategory: "Environmental Protection", expertise: ["Environmental Engineering", "Ecology", "GIS"], sectors: ["Environment", "Public Health"] },
  { slug: "waste-management", terms: ["garbage", "waste", "solid waste", "dump", "landfill", "recycling", "plastic"], subcategory: "Solid Waste Management", expertise: ["Waste Management", "Environmental Engineering", "IoT"], sectors: ["Environment", "Urban Development"] },
  { slug: "energy", terms: ["electricity", "power", "solar", "energy", "transformer", "street light"], subcategory: "Energy Access", expertise: ["Electrical Engineering", "Renewable Energy", "IoT"], sectors: ["Energy", "Infrastructure"] },
  { slug: "infrastructure", terms: ["road", "bridge", "building", "culvert", "infrastructure", "school building"], subcategory: "Public Infrastructure", expertise: ["Civil Engineering", "Structural Engineering"], sectors: ["Infrastructure", "Transportation"] },
  { slug: "transportation", terms: ["bus", "transport", "traffic", "road", "mobility", "vehicle", "rail"], subcategory: "Mobility & Transport", expertise: ["Transportation Engineering", "Mobility", "GIS"], sectors: ["Transportation", "Infrastructure"] },
  { slug: "digital-services", terms: ["internet", "online", "digital", "app", "website", "portal", "connectivity", "wifi"], subcategory: "Digital Public Services", expertise: ["Software", "AI", "Networking"], sectors: ["Digital Services", "Public Administration"] },
  { slug: "accessibility", terms: ["disability", "wheelchair", "accessible", "blind", "deaf", "barrier", "ramps"], subcategory: "Accessibility & Inclusion", expertise: ["Assistive Technology", "Accessibility", "Civil Engineering"], sectors: ["Accessibility", "Social Inclusion"] },
  { slug: "rural-livelihoods", terms: ["livelihood", "self help group", "shg", "employment", "income", "artisan", "rural"], subcategory: "Rural Livelihoods", expertise: ["Social Sciences", "Management", "Rural Development"], sectors: ["Rural Livelihoods", "Employment"] },
  { slug: "urban-development", terms: ["municipality", "urban", "city", "street", "drainage", "parking", "town"], subcategory: "Urban Services", expertise: ["Urban Planning", "Civil Engineering", "GIS"], sectors: ["Urban Development", "Infrastructure"] },
  { slug: "public-administration", terms: ["government office", "certificate", "scheme", "pension", "ration", "administration", "service delivery"], subcategory: "Public Service Delivery", expertise: ["Public Administration", "Software", "Management"], sectors: ["Public Administration", "Digital Services"] },
  { slug: "disaster-management", terms: ["flood", "cyclone", "disaster", "landslide", "drought", "fire", "emergency response"], subcategory: "Disaster Preparedness & Response", expertise: ["Disaster Management", "Civil Engineering", "GIS"], sectors: ["Disaster Management", "Public Safety"] }
];

const requestRules: Array<{ slug: string; terms: string[] }> = [
  { slug: "field-investigation", terms: ["survey", "inspect", "investigate", "field visit", "site visit", "measure"] },
  { slug: "research-project", terms: ["research", "study", "experiment", "analysis"] },
  { slug: "technical-consultation", terms: ["technical", "engineering", "design", "consult"] },
  { slug: "technical-solution", terms: ["solution", "software", "system", "technology", "engineering"] },
  { slug: "infrastructure-support", terms: ["infrastructure", "equipment", "facility", "building"] },
  { slug: "funding", terms: ["fund", "money", "financial", "budget", "cost"] },
  { slug: "implementation", terms: ["implement", "deployment", "rollout", "install"] },
  { slug: "student-project", terms: ["student", "college project", "prototype"] },
  { slug: "prototyping", terms: ["prototype", "proof of concept", "poc"] },
  { slug: "mentorship", terms: ["mentor", "guidance", "expert"] },
  { slug: "testing", terms: ["test", "validate", "trial", "pilot"] },
  { slug: "technology-transfer", terms: ["technology transfer", "license", "transfer"] },
  { slug: "community-project", terms: ["community", "village", "residents", "local people"] },
  { slug: "field-study", terms: ["field study", "survey", "assessment"] }
];

function normalizeText(value: unknown) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function ruleClassify(challenge: { title: string; description: string; urgency_hint: string; preferred_language: string; category: string | null; request_type: string | null }): AIAnalysis {
  const text = normalizeText(`${challenge.title} ${challenge.description}`);
  const scored = categoryRules.map((rule) => ({
    rule,
    score: rule.terms.reduce((sum, term) => sum + (text.includes(term) ? 1 : 0), 0)
  })).sort((a, b) => b.score - a.score);

  const best = scored[0];
  const hasStrongCategory = Boolean(best && best.score > 0);
  const categorySlug = hasStrongCategory ? best.rule.slug : (challenge.category || "other");

  let urgency: AIAnalysis["urgency"] = challenge.urgency_hint as AIAnalysis["urgency"];
  if (!allowedUrgency.has(urgency)) urgency = "NORMAL";
  if (/\b(emergency|life threatening|critical|unsafe to drink|severe|immediate danger|dying)\b/i.test(text)) urgency = "URGENT";
  else if (/\b(urgent|dangerous|outbreak|contaminated|flooding|blocked|no water)\b/i.test(text) && urgency === "NORMAL") urgency = "HIGH";

  const requestMatches = requestRules
    .filter((rule) => rule.terms.some((term) => text.includes(term)))
    .map((rule) => rule.slug);
  const recommendedRequestTypeSlugs = unique([
    ...requestMatches,
    challenge.request_type || "",
    ...(hasStrongCategory ? ["field-investigation", "research-project"].filter((x) => best.rule.slug !== "education" || x !== "field-investigation") : [])
  ]).slice(0, 5);

  const words = text
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 5 && !["there", "which", "their", "about", "problem", "people", "needs", "issue"].includes(word));
  const keywords = unique([...words.slice(0, 12), ...(hasStrongCategory ? [best.rule.slug] : [])]).slice(0, 12);

  const qualityScore = Math.max(35, Math.min(100,
    (challenge.title.trim().length >= 12 ? 15 : 8) +
    (challenge.description.trim().length >= 80 ? 35 : challenge.description.trim().length >= 40 ? 25 : 15) +
    (challenge.category ? 15 : 0) +
    (challenge.request_type ? 15 : 0) +
    (text.includes("village") || text.includes("district") || text.includes("location") ? 10 : 5) +
    (keywords.length >= 5 ? 10 : 5)
  ));

  const summary = challenge.description.trim().length > 280
    ? `${challenge.description.trim().slice(0, 277)}...`
    : challenge.description.trim();

  return {
    summary,
    categorySlug,
    subcategory: hasStrongCategory ? best.rule.subcategory : "General Societal Challenge",
    urgency,
    affectedSectors: unique(hasStrongCategory ? best.rule.sectors : ["Community Development"]),
    keywords,
    expertiseTags: unique(hasStrongCategory ? best.rule.expertise : ["Community Development", "Problem Solving"]),
    recommendedRequestTypeSlugs,
    qualityScore,
    qualityNotes: qualityScore >= 80
      ? "The challenge contains enough context for initial institutional routing."
      : "Add specific location, affected population, current impact, and desired outcome to improve routing confidence."
  };
}

function extractJson(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(cleaned);
}

function validateAI(value: unknown): AIAnalysis {
  if (!value || typeof value !== "object") throw new Error("AI returned a non-object response");
  const x = value as Record<string, unknown>;
  const urgency = String(x.urgency || "NORMAL").toUpperCase() as AIAnalysis["urgency"];
  const score = Number(x.qualityScore);
  const arrays = (key: string) => Array.isArray(x[key]) ? x[key].map(String).slice(0, 20) : [];
  if (typeof x.summary !== "string" || typeof x.categorySlug !== "string" || !allowedUrgency.has(urgency)) {
    throw new Error("AI response failed schema validation");
  }
  return {
    summary: x.summary.trim().slice(0, 2000),
    categorySlug: x.categorySlug.trim().toLowerCase(),
    subcategory: String(x.subcategory || "General Societal Challenge").slice(0, 200),
    urgency,
    affectedSectors: arrays("affectedSectors"),
    keywords: arrays("keywords"),
    expertiseTags: arrays("expertiseTags"),
    recommendedRequestTypeSlugs: arrays("recommendedRequestTypeSlugs"),
    qualityScore: Number.isFinite(score) ? Math.max(0, Math.min(100, Math.round(score))) : 50,
    qualityNotes: String(x.qualityNotes || "").slice(0, 1000)
  };
}

async function callExternalAI(challenge: { title: string; description: string; preferred_language: string; urgency_hint: string; category: string | null; request_type: string | null }): Promise<AIAnalysis> {
  if (!config.aiApiKey || !config.aiBaseUrl || !config.aiModel) {
    throw new Error("AI provider is not configured");
  }

  const endpoint = config.aiBaseUrl.replace(/\/$/, "").endsWith("/chat/completions")
    ? config.aiBaseUrl
    : `${config.aiBaseUrl.replace(/\/$/, "")}/chat/completions`;

  const system = `You classify societal challenges for a government innovation platform in Jharkhand, India.
Return ONLY valid JSON matching this exact shape:
{
  "summary": "string",
  "categorySlug": "one of: education, agriculture, healthcare, water-resources, environment, energy, urban-development, accessibility, public-administration, rural-livelihoods, sanitation, infrastructure, digital-services, disaster-management, waste-management, transportation, other",
  "subcategory": "string",
  "urgency": "LOW|NORMAL|HIGH|URGENT",
  "affectedSectors": ["string"],
  "keywords": ["string"],
  "expertiseTags": ["string"],
  "recommendedRequestTypeSlugs": ["technical-consultation|research-project|student-project|field-investigation|field-study|funding|mentorship|prototyping|implementation|infrastructure-support|technical-solution|testing|technology-transfer|community-project"],
  "qualityScore": 0,
  "qualityNotes": "string"
}
Do not invent facts. Preserve the citizen's meaning. Use the citizen-provided category/request type only as hints, not as proof.`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.aiApiKey}`
      },
      body: JSON.stringify({
        model: config.aiModel,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(challenge) }
        ]
      }),
      signal: controller.signal
    });

    if (!response.ok) throw new Error(`AI provider returned HTTP ${response.status}`);
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new Error("AI provider returned no message content");
    return validateAI(extractJson(content));
  } finally {
    clearTimeout(timer);
  }
}

async function lookupIds(analysis: AIAnalysis) {
  const category = await pool.query("SELECT id, slug FROM categories WHERE slug = $1", [analysis.categorySlug]);
  const requestTypes = await pool.query(
    "SELECT id, slug FROM request_types WHERE slug = ANY($1::text[])",
    [analysis.recommendedRequestTypeSlugs]
  );

  if (!category.rowCount) {
    analysis.categorySlug = "other";
  }

  return {
    categoryId: category.rowCount ? category.rows[0].id : (await pool.query("SELECT id FROM categories WHERE slug='other'")).rows[0].id,
    requestTypeIds: requestTypes.rows.map((row: { id: string }) => row.id)
  };
}

async function detectDuplicates(challengeId: string, title: string, description: string, district: string | null, latitude: number | null, longitude: number | null) {
  const result = await pool.query(
    `SELECT c.id, c.title, c.district, c.latitude, c.longitude,
            GREATEST(
              similarity(c.title, $2),
              similarity(c.description, $3),
              similarity(c.title || ' ' || c.description, $2 || ' ' || $3)
            ) AS similarity_score
     FROM challenges c
     WHERE c.id <> $1
       AND c.status <> 'RESOLVED'
       AND (
         similarity(c.title, $2) >= 0.35
         OR similarity(c.description, $3) >= 0.45
         OR similarity(c.title || ' ' || c.description, $2 || ' ' || $3) >= 0.38
       )
     ORDER BY similarity_score DESC
     LIMIT 8`,
    [challengeId, title, description]
  );

  for (const row of result.rows) {
    let score = Number(row.similarity_score);
    const matchedOn: string[] = ["text similarity"];

    if (district && row.district && normalizeText(district) === normalizeText(row.district)) {
      score = Math.min(1, score + 0.08);
      matchedOn.push("same district");
    }

    if (latitude !== null && longitude !== null && row.latitude !== null && row.longitude !== null) {
      const distanceKm = haversineKm(latitude, longitude, Number(row.latitude), Number(row.longitude));
      if (distanceKm <= 5) {
        score = Math.min(1, score + 0.12);
        matchedOn.push("within 5 km");
      } else if (distanceKm <= 20) {
        score = Math.min(1, score + 0.05);
        matchedOn.push("within 20 km");
      }
    }

    if (score < 0.48) continue;

    const a = [challengeId, row.id].sort();
    await pool.query(
      `INSERT INTO challenge_duplicate_flags
       (challenge_id, possible_duplicate_id, similarity_score, matched_on)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (challenge_id, possible_duplicate_id)
       DO UPDATE SET similarity_score=EXCLUDED.similarity_score,
                     matched_on=EXCLUDED.matched_on,
                     updated_at=NOW()`,
      [a[0], a[1], Math.min(1, score), matchedOn]
    );
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export async function analyzeChallenge(challengeId: string) {
  const result = await pool.query(
    `SELECT c.id, c.title, c.description, c.preferred_language, c.urgency_hint,
            c.district, c.latitude, c.longitude,
            cat.slug AS category, rt.slug AS request_type
     FROM challenges c
     LEFT JOIN categories cat ON cat.id=c.category_id
     LEFT JOIN request_types rt ON rt.id=c.request_type_id
     WHERE c.id=$1`,
    [challengeId]
  );
  if (!result.rowCount) throw new Error("Challenge not found");

  const challenge = result.rows[0];
  let analysis: AIAnalysis;
  let provider = "fallback";
  let model: string | null = null;

  try {
    analysis = await callExternalAI(challenge);
    provider = "external";
    model = config.aiModel;
  } catch (error) {
    console.warn(`AI analysis fallback for ${challengeId}:`, error instanceof Error ? error.message : error);
    analysis = ruleClassify(challenge);
  }

  const ids = await lookupIds(analysis);

  await pool.query(
    `INSERT INTO challenge_ai_analysis
      (challenge_id, summary, category_id, subcategory, urgency, affected_sectors,
       keywords, expertise_tags, recommended_request_type_ids, quality_score,
       quality_notes, provider, model, raw_response, analyzed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
     ON CONFLICT (challenge_id)
     DO UPDATE SET summary=EXCLUDED.summary,
                   category_id=EXCLUDED.category_id,
                   subcategory=EXCLUDED.subcategory,
                   urgency=EXCLUDED.urgency,
                   affected_sectors=EXCLUDED.affected_sectors,
                   keywords=EXCLUDED.keywords,
                   expertise_tags=EXCLUDED.expertise_tags,
                   recommended_request_type_ids=EXCLUDED.recommended_request_type_ids,
                   quality_score=EXCLUDED.quality_score,
                   quality_notes=EXCLUDED.quality_notes,
                   provider=EXCLUDED.provider,
                   model=EXCLUDED.model,
                   raw_response=EXCLUDED.raw_response,
                   analyzed_at=NOW(),
                   updated_at=NOW()`,
    [
      challengeId, analysis.summary, ids.categoryId, analysis.subcategory, analysis.urgency,
      analysis.affectedSectors, analysis.keywords, analysis.expertiseTags, ids.requestTypeIds,
      analysis.qualityScore, analysis.qualityNotes, provider, model, JSON.stringify(analysis)
    ]
  );

  const statusUpdate = await pool.query(
    `UPDATE challenges
     SET status='AI_ANALYZED'
     WHERE id=$1 AND status IN ('SUBMITTED','UNDER_REVIEW')
     RETURNING status`,
    [challengeId]
  );
  if (statusUpdate.rowCount) {
    await pool.query(
      `INSERT INTO challenge_status_history (challenge_id, from_status, to_status, reason)
       VALUES ($1, $2, 'AI_ANALYZED', $3)`,
      [challengeId, challenge.status, `AI analysis completed using ${provider === "external" ? "external provider" : "deterministic fallback classifier"}.`]
    );
  }

  await detectDuplicates(
    challengeId, challenge.title, challenge.description, challenge.district,
    challenge.latitude === null ? null : Number(challenge.latitude),
    challenge.longitude === null ? null : Number(challenge.longitude)
  );

  return getAnalysis(challengeId);
}

export async function getAnalysis(challengeId: string) {
  const result = await pool.query(
    `SELECT a.id, a.challenge_id, a.summary, a.subcategory, a.urgency,
            a.affected_sectors, a.keywords, a.expertise_tags, a.quality_score,
            a.quality_notes, a.provider, a.model, a.analyzed_at,
            c.slug AS category_slug, c.name AS category_name,
            COALESCE(
              jsonb_agg(jsonb_build_object('slug', rt.slug, 'name', rt.name))
              FILTER (WHERE rt.id IS NOT NULL), '[]'::jsonb
            ) AS recommended_request_types
     FROM challenge_ai_analysis a
     LEFT JOIN categories c ON c.id=a.category_id
     LEFT JOIN LATERAL unnest(a.recommended_request_type_ids) AS rid(id) ON TRUE
     LEFT JOIN request_types rt ON rt.id=rid.id
     WHERE a.challenge_id=$1
     GROUP BY a.id, c.slug, c.name`,
    [challengeId]
  );
  return result.rows[0] ?? null;
}

export async function getDuplicateFlags(challengeId: string) {
  const result = await pool.query(
    `SELECT f.id, f.similarity_score, f.matched_on, f.status,
            other.id AS possible_duplicate_id, other.title AS possible_duplicate_title,
            other.district AS possible_duplicate_district, other.status AS possible_duplicate_status,
            other.created_at AS possible_duplicate_created_at
     FROM challenge_duplicate_flags f
     JOIN challenges other
       ON other.id = CASE WHEN f.challenge_id=$1 THEN f.possible_duplicate_id ELSE f.challenge_id END
     WHERE (f.challenge_id=$1 OR f.possible_duplicate_id=$1)
     ORDER BY f.similarity_score DESC`,
    [challengeId]
  );
  return result.rows;
}
