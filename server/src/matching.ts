import { pool } from "./db/pool.js";

type MatchType = "COLLEGE" | "INDUSTRY";

type MatchRow = {
  id: string;
  organization_id: string;
  name: string;
  organization_type: string;
  description: string | null;
  district: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  verified: boolean;
  active: boolean;
  category_slugs: string[];
  expertise_names: string[];
  expertise_slugs: string[];
  request_type_slugs: string[];
  distance_km: number | null;
  category_score: number;
  expertise_score: number;
  request_type_score: number;
  location_score: number;
  verification_score: number;
  match_score: number;
  reasons: string[];
};

const normalize = (value: unknown) => String(value ?? "").trim().toLowerCase();
const slugify = (value: string) => normalize(value).replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function haversineSql(challengeAlias = "c", orgAlias = "o") {
  return `CASE
    WHEN ${challengeAlias}.latitude IS NULL OR ${challengeAlias}.longitude IS NULL
      OR ${orgAlias}.latitude IS NULL OR ${orgAlias}.longitude IS NULL THEN NULL
    ELSE 6371 * 2 * ASIN(SQRT(
      POWER(SIN(RADIANS(${orgAlias}.latitude - ${challengeAlias}.latitude) / 2), 2) +
      COS(RADIANS(${challengeAlias}.latitude)) * COS(RADIANS(${orgAlias}.latitude)) *
      POWER(SIN(RADIANS(${orgAlias}.longitude - ${challengeAlias}.longitude) / 2), 2)
    ))
  END`;
}

function safePercent(numerator: number, denominator: number) {
  return denominator > 0 ? Math.min(100, Math.round((numerator / denominator) * 100)) : 0;
}

async function getChallengeSignals(challengeId: string) {
  const result = await pool.query(
    `SELECT c.id, c.district, c.latitude, c.longitude,
            cat.slug AS category_slug,
            rt.slug AS request_type_slug,
            COALESCE(ai.expertise_tags, ARRAY[]::text[]) AS expertise_tags,
            COALESCE(ai.affected_sectors, ARRAY[]::text[]) AS affected_sectors,
            COALESCE(
              (SELECT array_agg(rt_ai.slug)
               FROM unnest(COALESCE(ai.recommended_request_type_ids, ARRAY[]::uuid[])) rid(id)
               JOIN request_types rt_ai ON rt_ai.id=rid.id),
              ARRAY[]::text[]
            ) AS recommended_request_slugs
     FROM challenges c
     LEFT JOIN categories cat ON cat.id=c.category_id
     LEFT JOIN request_types rt ON rt.id=c.request_type_id
     LEFT JOIN challenge_ai_analysis ai ON ai.challenge_id=c.id
     WHERE c.id=$1`,
    [challengeId]
  );
  return result.rows[0] ?? null;
}

async function computeMatches(challengeId: string, matchType: MatchType) {
  const signal = await getChallengeSignals(challengeId);
  if (!signal) return [] as MatchRow[];

  const typeFilter = matchType === "COLLEGE"
    ? ["COLLEGE", "UNIVERSITY"]
    : ["INDUSTRY", "STARTUP", "MSME", "CSR", "RESEARCH_LAB", "INNOVATION_HUB"];

  const distanceExpression = haversineSql();
  const result = await pool.query(
    `SELECT o.id, o.name, o.organization_type, o.description, o.district, o.address,
            o.latitude, o.longitude, o.verified, o.active,
            COALESCE(array_agg(DISTINCT cat.slug) FILTER (WHERE cat.slug IS NOT NULL), '{}') AS category_slugs,
            COALESCE(array_agg(DISTINCT et.name) FILTER (WHERE et.name IS NOT NULL), '{}') AS expertise_names,
            COALESCE(array_agg(DISTINCT et.slug) FILTER (WHERE et.slug IS NOT NULL), '{}') AS expertise_slugs,
            COALESCE(array_agg(DISTINCT rt.slug) FILTER (WHERE rt.slug IS NOT NULL), '{}') AS request_type_slugs,
            ${distanceExpression} AS distance_km
     FROM organizations o
     CROSS JOIN challenges c
     LEFT JOIN organization_categories oc ON oc.organization_id=o.id
     LEFT JOIN categories cat ON cat.id=oc.category_id
     LEFT JOIN organization_expertise oe ON oe.organization_id=o.id
     LEFT JOIN expertise_tags et ON et.id=oe.expertise_id AND et.active=TRUE
     LEFT JOIN organization_request_types ort ON ort.organization_id=o.id
     LEFT JOIN request_types rt ON rt.id=ort.request_type_id
     WHERE c.id=$1 AND o.active=TRUE AND o.organization_type = ANY($2::organization_type[])
     GROUP BY o.id, c.id, c.latitude, c.longitude, c.district
     ORDER BY o.name`,
    [challengeId, typeFilter]
  );

  const wantedCategory = normalize(signal.category_slug);
  const wantedRequest = normalize(signal.request_type_slug);
  const wantedRequests = unique([wantedRequest, ...(signal.recommended_request_slugs ?? []).map(normalize)]);
  const wantedExpertise = unique((signal.expertise_tags ?? []).map((x: string) => slugify(x)));
  const wantedSectors = unique((signal.affected_sectors ?? []).map((x: string) => slugify(x)));

  const rows: MatchRow[] = result.rows.map((row) => {
    const categories = (row.category_slugs ?? []).map(normalize);
    const expertise = (row.expertise_slugs ?? []).map(normalize);
    const requests = (row.request_type_slugs ?? []).map(normalize);
    const categoryMatch = wantedCategory && categories.includes(wantedCategory) ? 100 : 0;
    const expertiseOverlap = wantedExpertise.filter((x) => expertise.includes(x)).length;
    const expertiseScore = safePercent(expertiseOverlap, Math.max(wantedExpertise.length, 1));
    const selectedRequestMatch = wantedRequest && requests.includes(wantedRequest);
    const recommendedRequestMatch = wantedRequests.filter((x: string) => x && requests.includes(x)).length;
    const requestMatch = selectedRequestMatch ? 100 : (recommendedRequestMatch > 0 ? Math.min(85, 45 + recommendedRequestMatch * 15) : 0);

    // When the AI emits a sector rather than an exact expertise term, award a modest
    // relevance signal if the organization's category/expertise uses that sector slug.
    const sectorMatch = wantedSectors.some((sector) => categories.includes(sector) || expertise.includes(sector));
    const blendedExpertiseScore = Math.min(100, expertiseScore + (sectorMatch ? 15 : 0));

    const distance = row.distance_km === null ? null : Number(row.distance_km);
    const locationScore = distance === null
      ? (signal.district && row.district && normalize(signal.district) === normalize(row.district) ? 65 : 0)
      : Math.max(0, Math.round(100 * Math.exp(-distance / 100)));
    const verificationScore = row.verified ? 100 : 0;

    // Relevance is intentionally dominant; distance is a tie-breaking/routing signal.
    let score = categoryMatch * 0.30 + blendedExpertiseScore * 0.40 + requestMatch * 0.20 + locationScore * 0.10;
    if (row.verified) score += 5;
    score = Math.min(100, Math.round(score * 100) / 100);

    const reasons: string[] = [];
    if (categoryMatch) reasons.push(`Category match: ${row.category_slugs.find((x: string) => normalize(x) === wantedCategory)}`);
    if (expertiseOverlap) reasons.push(`${expertiseOverlap} expertise tag${expertiseOverlap === 1 ? "" : "s"} match`);
    if (sectorMatch) reasons.push("Affected-sector relevance");
    if (selectedRequestMatch) reasons.push(`Accepts ${row.request_type_slugs.find((x: string) => normalize(x) === wantedRequest)}`);
    else if (recommendedRequestMatch) reasons.push(`Accepts ${recommendedRequestMatch} AI-recommended request type${recommendedRequestMatch === 1 ? "" : "s"}`);
    if (distance !== null) reasons.push(`${distance.toFixed(1)} km from challenge`);
    else if (locationScore > 0) reasons.push("Same district as challenge");
    if (row.verified) reasons.push("Verified organization");

    const eligible = categoryMatch > 0 || expertiseOverlap > 0 || requestMatch > 0 || sectorMatch;
    return {
      ...row,
      distance_km: distance,
      category_score: categoryMatch,
      expertise_score: blendedExpertiseScore,
      request_type_score: requestMatch,
      location_score: locationScore,
      verification_score: verificationScore,
      match_score: score,
      reasons,
      eligible
    } as MatchRow & { eligible: boolean };
  }).filter((row: MatchRow & { eligible: boolean }) => row.eligible);

  if (matchType === "COLLEGE") {
    // Requirement: nearest five eligible colleges. Distance is the primary ordering
    // criterion; match score breaks ties and handles organizations without coordinates.
    rows.sort((a, b) => {
      if (a.distance_km !== null && b.distance_km !== null) return a.distance_km - b.distance_km || b.match_score - a.match_score;
      if (a.distance_km !== null) return -1;
      if (b.distance_km !== null) return 1;
      return b.match_score - a.match_score;
    });
  } else {
    // Industry partners are relevance-first, with proximity as a secondary signal.
    rows.sort((a, b) => b.match_score - a.match_score || (a.distance_km ?? Number.POSITIVE_INFINITY) - (b.distance_km ?? Number.POSITIVE_INFINITY));
  }

  return rows.slice(0, matchType === "COLLEGE" ? 5 : 10);
}

export async function refreshChallengeMatches(challengeId: string) {
  const client = await pool.connect();
  try {
    const [colleges, industries] = await Promise.all([
      computeMatches(challengeId, "COLLEGE"),
      computeMatches(challengeId, "INDUSTRY")
    ]);
    await client.query("BEGIN");
    await client.query("DELETE FROM challenge_matches WHERE challenge_id=$1", [challengeId]);

    const insert = async (row: MatchRow, type: MatchType, rank: number) => {
      await client.query(
        `INSERT INTO challenge_matches
          (challenge_id, organization_id, match_type, match_score, distance_km,
           category_score, expertise_score, request_type_score, location_score,
           verification_score, reasons, rank_position, generated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
        [challengeId, row.id, type, row.match_score, row.distance_km,
          row.category_score, row.expertise_score, row.request_type_score,
          row.location_score, row.verification_score, row.reasons, rank]
      );
    };
    for (let i = 0; i < colleges.length; i++) await insert(colleges[i], "COLLEGE", i + 1);
    for (let i = 0; i < industries.length; i++) await insert(industries[i], "INDUSTRY", i + 1);

    const status = await client.query(
      `UPDATE challenges SET status='INSTITUTIONS_MATCHED'
       WHERE id=$1 AND status='AI_ANALYZED' RETURNING status`,
      [challengeId]
    );
    if (status.rowCount) {
      await client.query(
        `INSERT INTO challenge_status_history (challenge_id, from_status, to_status, reason)
         VALUES ($1, 'AI_ANALYZED', 'INSTITUTIONS_MATCHED', $2)`,
        [challengeId, `Smart matching completed: ${colleges.length} eligible colleges/universities and ${industries.length} relevant industry partners.`]
      );
    }
    await client.query("COMMIT");
    return { colleges, industries };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getChallengeMatches(challengeId: string) {
  const result = await pool.query(
    `SELECT cm.id, cm.match_type, cm.match_score, cm.distance_km,
            cm.category_score, cm.expertise_score, cm.request_type_score,
            cm.location_score, cm.verification_score, cm.reasons,
            cm.rank_position, cm.generated_at,
            o.id AS organization_id, o.name, o.organization_type,
            o.description, o.district, o.address, o.latitude, o.longitude,
            o.verified
     FROM challenge_matches cm
     JOIN organizations o ON o.id=cm.organization_id
     WHERE cm.challenge_id=$1 AND o.active=TRUE
     ORDER BY cm.match_type, cm.rank_position NULLS LAST, cm.match_score DESC`,
    [challengeId]
  );
  return {
    colleges: result.rows.filter((x) => x.match_type === "COLLEGE"),
    industries: result.rows.filter((x) => x.match_type === "INDUSTRY")
  };
}
