import { Router } from "express";
import { routeParam } from "../params.js";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware.js";
import { challengeUpload } from "../uploads.js";
import { persistUploadedFile } from "../storage.js";
import { analyzeChallenge, getAnalysis, getDuplicateFlags } from "../ai.js";
import { getChallengeMatches, refreshChallengeMatches } from "../matching.js";
import { notifyUser, notifyOrganization } from "../notifications.js";
import { getTranslations } from "../translation.js";

export const challengesRouter = Router();

const challengeSchema = z.object({
  title: z.string().trim().min(5).max(180),
  description: z.string().trim().min(20).max(10000),
  preferredLanguage: z.string().trim().min(2).max(20).default("en"),
  categorySlug: z.string().trim().min(1).max(80),
  requestTypeSlug: z.string().trim().min(1).max(100),
  urgencyHint: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"),
  district: z.string().trim().max(100).optional(),
  block: z.string().trim().max(120).optional(),
  address: z.string().trim().max(500).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  allowContact: z.coerce.boolean().default(false),
  contactPhone: z.string().trim().max(25).optional(),
  contactEmail: z.string().trim().email().max(180).optional()
});

async function getChallenge(id: string, citizenId: string) {
  const result = await pool.query(
    `SELECT c.id, c.title, c.description, c.preferred_language,
            c.status, c.urgency_hint, c.district, c.block, c.address,
            c.latitude, c.longitude, c.allow_contact,
            c.created_at, c.updated_at,
            cat.name AS category, cat.slug AS category_slug,
            rt.name AS request_type, rt.slug AS request_type_slug,
            (SELECT COUNT(*) FROM challenge_media cm WHERE cm.challenge_id = c.id)::int AS media_count
     FROM challenges c
     LEFT JOIN categories cat ON cat.id = c.category_id
     LEFT JOIN request_types rt ON rt.id = c.request_type_id
     WHERE c.id = $1 AND c.citizen_id = $2`,
    [id, citizenId]
  );
  return result.rows[0] ?? null;
}

challengesRouter.post("/", requireAuth, challengeUpload.array("media", 8), async (req, res) => {
  if (req.auth!.role !== "CITIZEN") {
    return res.status(403).json({ error: "Only citizen accounts can submit a challenge." });
  }

  const parsed = challengeSchema.safeParse(req.body);
  if (!parsed.success) {
    const files = req.files as Express.Multer.File[] | undefined;

    return res.status(400).json({ error: "Invalid challenge data", details: parsed.error.flatten() });
  }

  const d = parsed.data;
  const cat = await pool.query("SELECT id FROM categories WHERE slug = $1", [d.categorySlug]);
  const rt = await pool.query("SELECT id FROM request_types WHERE slug = $1", [d.requestTypeSlug]);

  if (!cat.rowCount || !rt.rowCount) {
    return res.status(400).json({ error: "Invalid category or request type" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const challenge = await client.query(
      `INSERT INTO challenges
       (citizen_id,title,description,preferred_language,category_id,request_type_id,
        urgency_hint,district,block,address,latitude,longitude,allow_contact,contact_phone,contact_email)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       RETURNING id`,
      [
        req.auth!.userId, d.title, d.description, d.preferredLanguage,
        cat.rows[0].id, rt.rows[0].id, d.urgencyHint,
        d.district ?? null, d.block ?? null, d.address ?? null, d.latitude ?? null, d.longitude ?? null,
        d.allowContact, d.contactPhone ?? null, d.contactEmail ?? null
      ]
    );

    const challengeId = challenge.rows[0].id;

    await client.query(
      `INSERT INTO challenge_status_history (challenge_id, from_status, to_status, changed_by, reason)
       VALUES ($1, NULL, 'SUBMITTED', $2, 'Citizen submitted challenge')`,
      [challengeId, req.auth!.userId]
    );

    const files = (req.files as Express.Multer.File[] | undefined) ?? [];

    for (const file of files) {
      const type = file.mimetype.startsWith("image/")
        ? "IMAGE"
        : file.mimetype.startsWith("video/")
          ? "VIDEO"
          : "DOCUMENT";

      await client.query(
        `INSERT INTO challenge_media
         (challenge_id,media_type,original_name,storage_path,mime_type,size_bytes)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [challengeId, type, file.originalname, await persistUploadedFile(file), file.mimetype, file.size]
      );
    }

    await client.query("COMMIT");

    // Analyze immediately so every successfully created challenge has routing intelligence.
    // If the external provider is unavailable, analyzeChallenge automatically uses the
    // deterministic fallback classifier.
    let analysisStatus = "completed";
    try {
      await analyzeChallenge(challengeId);
      const routedMatches = await refreshChallengeMatches(challengeId);
      await notifyUser(req.auth!.userId,"AI_ANALYSIS_COMPLETED","AI analysis completed","Your challenge has been analyzed and relevant organizations have been identified.","CHALLENGE",challengeId);
      for (const match of [...(routedMatches.colleges||[]), ...(routedMatches.industries||[])]) {
        await notifyOrganization(match.organization_id,"CHALLENGE_MATCHED","New challenge match","A challenge matches your organization profile and accepted request types.","CHALLENGE",challengeId);
      }
    } catch (analysisError) {
      analysisStatus = "failed";
      console.error(`AI analysis failed for challenge ${challengeId}:`, analysisError);
    }

    await notifyUser(req.auth!.userId,"CHALLENGE_SUBMITTED","Challenge submitted","Your challenge was submitted and AI routing is being prepared.","CHALLENGE",challengeId);
    const created = await getChallenge(challengeId, req.auth!.userId);
    const analysis = await getAnalysis(challengeId);
    const duplicates = await getDuplicateFlags(challengeId);
    const matches = await getChallengeMatches(challengeId);
    res.status(201).json({ challenge: created, analysis, duplicates, matches, analysisStatus });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Could not create challenge" });
  } finally {
    client.release();
  }
});

challengesRouter.get("/feed", async (_req, res) => {
  const result = await pool.query(`
    SELECT c.id, c.title, c.status, c.urgency_hint, c.district, c.block, c.latitude, c.longitude, c.created_at,
           cat.name AS category, rt.name AS request_type
    FROM challenges c
    LEFT JOIN categories cat ON cat.id=c.category_id
    LEFT JOIN request_types rt ON rt.id=c.request_type_id
    LEFT JOIN challenge_moderation cm ON cm.challenge_id=c.id
    WHERE COALESCE(cm.status,'VISIBLE')='VISIBLE'
      AND c.latitude IS NOT NULL AND c.longitude IS NOT NULL
      AND c.status <> 'RESOLVED'
    ORDER BY CASE c.urgency_hint WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'NORMAL' THEN 2 ELSE 3 END, c.created_at DESC
    LIMIT 80
  `);
  res.json({ challenges: result.rows });
});

challengesRouter.get("/mine", requireAuth, async (req, res) => {
  if (req.auth!.role !== "CITIZEN") {
    return res.status(403).json({ error: "Only citizen accounts can use this endpoint." });
  }

  const result = await pool.query(
    `SELECT c.id, c.title, c.description, c.status, c.urgency_hint,
            c.district, c.block, c.latitude, c.longitude, c.allow_contact,
            c.created_at, c.updated_at,
            cat.name AS category, rt.name AS request_type,
            (SELECT COUNT(*) FROM challenge_media cm WHERE cm.challenge_id=c.id)::int AS media_count
     FROM challenges c
     LEFT JOIN categories cat ON cat.id=c.category_id
     LEFT JOIN request_types rt ON rt.id=c.request_type_id
     WHERE c.citizen_id=$1
     ORDER BY c.created_at DESC`,
    [req.auth!.userId]
  );

  res.json({ challenges: result.rows });
});

challengesRouter.get("/:id", requireAuth, async (req, res) => {
  const challenge = await getChallenge(routeParam(req, "id"), req.auth!.userId);
  if (!challenge) return res.status(404).json({ error: "Challenge not found" });
  res.json({ challenge, translations: await getTranslations(routeParam(req, "id")) });
});

challengesRouter.get("/:id/matches", requireAuth, async (req, res) => {
  const challenge = await getChallenge(routeParam(req, "id"), req.auth!.userId);
  if (!challenge) return res.status(404).json({ error: "Challenge not found" });

  const matches = await getChallengeMatches(routeParam(req, "id"));
  res.json(matches);
});

challengesRouter.post("/:id/matches/refresh", requireAuth, async (req, res) => {
  const challenge = await getChallenge(routeParam(req, "id"), req.auth!.userId);
  if (!challenge) return res.status(404).json({ error: "Challenge not found" });

  try {
    const matches = await refreshChallengeMatches(routeParam(req, "id"));
    res.json(matches);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Organization matching could not be completed" });
  }
});

challengesRouter.get("/:id/ai", requireAuth, async (req, res) => {
  const challenge = await getChallenge(routeParam(req, "id"), req.auth!.userId);
  if (!challenge) return res.status(404).json({ error: "Challenge not found" });

  const analysis = await getAnalysis(routeParam(req, "id"));
  const duplicates = await getDuplicateFlags(routeParam(req, "id"));
  const matches = await getChallengeMatches(routeParam(req, "id"));
  res.json({ analysis, duplicates, matches });
});

challengesRouter.post("/:id/analyze", requireAuth, async (req, res) => {
  const challenge = await getChallenge(routeParam(req, "id"), req.auth!.userId);
  if (!challenge) return res.status(404).json({ error: "Challenge not found" });

  try {
    const analysis = await analyzeChallenge(routeParam(req, "id"));
    const matches = await refreshChallengeMatches(routeParam(req, "id"));
    await notifyUser(req.auth!.userId,"AI_ANALYSIS_COMPLETED","AI analysis refreshed","Challenge intelligence and organization matches were refreshed.","CHALLENGE",routeParam(req, "id"));
    for (const match of [...(matches.colleges||[]), ...(matches.industries||[])]) {
      await notifyOrganization(match.organization_id,"CHALLENGE_MATCHED","New challenge match","A challenge matches your organization profile and accepted request types.","CHALLENGE",routeParam(req, "id"));
    }
    const duplicates = await getDuplicateFlags(routeParam(req, "id"));
    res.json({ analysis, duplicates, matches });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Challenge analysis could not be completed" });
  }
});

challengesRouter.get("/:id/media", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT cm.id, cm.media_type, cm.original_name, cm.mime_type, cm.size_bytes, cm.created_at
     FROM challenge_media cm
     JOIN challenges c ON c.id=cm.challenge_id
     WHERE cm.challenge_id=$1 AND c.citizen_id=$2
     ORDER BY cm.created_at`,
    [routeParam(req, "id"), req.auth!.userId]
  );
  res.json({ media: result.rows });
});
