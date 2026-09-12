import { Router } from "express";
import { routeParam } from "../params.js";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth, requireRoles } from "../middleware.js";
import { notifyUser } from "../notifications.js";
import { audit } from "../audit.js";

export const governmentRouter = Router();
const admin = ["GOVERNMENT", "SUPER_ADMIN"] as const;

function q(s: string) { return s.trim().slice(0, 100); }

// Government overview: operational KPIs plus district/category trends.
governmentRouter.get("/dashboard", requireAuth, requireRoles(...admin), async (_req, res) => {
  const [counts, districts, categories, statuses, projects, impact, urgent] = await Promise.all([
    pool.query(`SELECT
      (SELECT COUNT(*)::int FROM challenges) AS total_challenges,
      (SELECT COUNT(*)::int FROM challenges WHERE status='RESOLVED') AS resolved_challenges,
      (SELECT COUNT(*)::int FROM projects) AS total_projects,
      (SELECT COUNT(*)::int FROM projects WHERE status='COMPLETED') AS completed_projects,
      (SELECT COUNT(*)::int FROM organizations WHERE active) AS active_organizations,
      (SELECT COUNT(*)::int FROM organizations WHERE verified AND active) AS verified_organizations,
      (SELECT COUNT(*)::int FROM users WHERE active) AS active_users,
      (SELECT COUNT(*)::int FROM challenges WHERE urgency_hint='URGENT' AND status<>'RESOLVED') AS urgent_open`),
    pool.query(`SELECT COALESCE(NULLIF(district,''),'Unknown') AS district, COUNT(*)::int AS challenges,
      COUNT(*) FILTER (WHERE status='RESOLVED')::int AS resolved,
      COUNT(*) FILTER (WHERE status IN ('ADOPTED','SOLUTION_DEVELOPMENT','SOLUTION_PROPOSED','IMPLEMENTATION'))::int AS active
      FROM challenges GROUP BY 1 ORDER BY challenges DESC, district LIMIT 24`),
    pool.query(`SELECT COALESCE(cat.name,'Uncategorized') AS category, COUNT(*)::int AS challenges,
      COUNT(*) FILTER (WHERE c.status='RESOLVED')::int AS resolved
      FROM challenges c LEFT JOIN categories cat ON cat.id=c.category_id GROUP BY 1 ORDER BY challenges DESC LIMIT 20`),
    pool.query(`SELECT status, COUNT(*)::int AS count FROM challenges GROUP BY status ORDER BY count DESC`),
    pool.query(`SELECT p.id,p.title,p.status,p.created_at,o.name AS organization_name,c.district,c.urgency_hint
      FROM projects p JOIN organizations o ON o.id=p.lead_organization_id JOIN challenges c ON c.id=p.challenge_id
      ORDER BY p.updated_at DESC LIMIT 12`),
    pool.query(`SELECT COALESCE(SUM(people_affected),0)::int AS people_affected,
      COALESCE(SUM(villages_affected),0)::int AS villages_affected,
      COALESCE(SUM(time_saved_hours),0)::numeric AS time_saved_hours,
      COUNT(*)::int AS impact_records FROM impact_records`),
    pool.query(`SELECT c.id,c.title,c.district,c.urgency_hint,c.status,c.created_at,cat.name AS category
      FROM challenges c LEFT JOIN categories cat ON cat.id=c.category_id
      WHERE c.urgency_hint IN ('URGENT','HIGH') AND c.status<>'RESOLVED'
      ORDER BY CASE c.urgency_hint WHEN 'URGENT' THEN 0 ELSE 1 END,c.created_at DESC LIMIT 12`)
  ]);
  res.json({ kpis: counts.rows[0], districts: districts.rows, categories: categories.rows, statuses: statuses.rows,
    recentProjects: projects.rows, impact: impact.rows[0], urgent: urgent.rows });
});

governmentRouter.get("/challenges", requireAuth, requireRoles(...admin), async (req, res) => {
  const district = q(String(req.query.district || ""));
  const status = q(String(req.query.status || ""));
  const category = q(String(req.query.category || ""));
  const search = q(String(req.query.search || ""));
  const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);
  const values: any[] = []; const where: string[] = ["COALESCE(cm.status,'VISIBLE') <> 'REMOVED'"];
  if (district) { values.push(district); where.push(`c.district=$${values.length}`); }
  if (status) { values.push(status); where.push(`c.status=$${values.length}`); }
  if (category) { values.push(category); where.push(`cat.slug=$${values.length}`); }
  if (search) { values.push(`%${search}%`); where.push(`(c.title ILIKE $${values.length} OR c.description ILIKE $${values.length})`); }
  values.push(limit);
  const r = await pool.query(`SELECT c.id,c.title,c.description,c.status,c.urgency_hint,c.district,c.block,c.latitude,c.longitude,c.created_at,
    cat.name AS category,rt.name AS request_type,cm.status AS moderation_status, u.full_name AS citizen_name
    FROM challenges c LEFT JOIN categories cat ON cat.id=c.category_id LEFT JOIN request_types rt ON rt.id=c.request_type_id
    LEFT JOIN challenge_moderation cm ON cm.challenge_id=c.id JOIN users u ON u.id=c.citizen_id
    WHERE ${where.join(" AND ")} ORDER BY c.created_at DESC LIMIT $${values.length}`, values);
  res.json({ challenges: r.rows });
});

governmentRouter.get("/organizations", requireAuth, requireRoles(...admin), async (_req,res)=>{
  const r=await pool.query(`SELECT o.*,s.average_rating,s.rating_count,(SELECT COUNT(*)::int FROM users u WHERE u.organization_id=o.id AND u.active) AS member_count
    FROM organizations o JOIN organization_rating_summary s ON s.organization_id=o.id ORDER BY o.verified DESC,o.name`);
  res.json({organizations:r.rows});
});

governmentRouter.patch("/organizations/:id", requireAuth, requireRoles(...admin), async (req,res)=>{
  const p=z.object({verified:z.boolean().optional(),active:z.boolean().optional(),moderationStatus:z.enum(["VISIBLE","HIDDEN","REMOVED"]).optional()}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Invalid organization update"});
  const d=p.data;
  const r=await pool.query(`UPDATE organizations SET verified=COALESCE($1,verified),active=COALESCE($2,active),
    moderation_status=COALESCE($3,moderation_status),verified_at=CASE WHEN $1=true THEN NOW() WHEN $1=false THEN NULL ELSE verified_at END,
    verified_by=CASE WHEN $1 IS NOT NULL THEN $4 ELSE verified_by END WHERE id=$5 RETURNING *`,
    [d.verified??null,d.active??null,d.moderationStatus??null,req.auth!.userId,routeParam(req, "id")]);
  if(!r.rowCount)return res.status(404).json({error:"Organization not found"});
  await audit(req.auth!.userId, "ORGANIZATION_GOVERNANCE_UPDATED", "ORGANIZATION", routeParam(req, "id"), d);
  res.json({organization:r.rows[0]});
});

governmentRouter.patch("/challenges/:id/moderation", requireAuth, requireRoles(...admin), async(req,res)=>{
  const p=z.object({status:z.enum(["VISIBLE","HIDDEN","REMOVED"]),reason:z.string().trim().max(1000).default("")}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Invalid moderation update"});
  const exists=await pool.query("SELECT citizen_id,title FROM challenges WHERE id=$1",[routeParam(req, "id")]);
  if(!exists.rowCount)return res.status(404).json({error:"Challenge not found"});
  const r=await pool.query(`INSERT INTO challenge_moderation(challenge_id,status,reason,moderated_by,moderated_at) VALUES($1,$2,$3,$4,NOW())
    ON CONFLICT(challenge_id) DO UPDATE SET status=EXCLUDED.status,reason=EXCLUDED.reason,moderated_by=EXCLUDED.moderated_by,moderated_at=NOW() RETURNING *`,
    [routeParam(req, "id"),p.data.status,p.data.reason,req.auth!.userId]);
  await notifyUser(exists.rows[0].citizen_id,"CHALLENGE_MODERATED","Challenge moderation updated",`Your challenge “${exists.rows[0].title}” is now ${p.data.status.toLowerCase()}.`,"CHALLENGE",routeParam(req, "id"));
  await audit(req.auth!.userId, "CHALLENGE_MODERATION_UPDATED", "CHALLENGE", routeParam(req, "id"), p.data);
  res.json({moderation:r.rows[0]});
});

// Ratings are deliberately limited to people who actually participated in the project.
governmentRouter.post("/ratings", requireAuth, async(req,res)=>{
  const p=z.object({projectId:z.string().uuid(),organizationId:z.string().uuid(),rating:z.number().int().min(1).max(5),review:z.string().trim().max(2000).default("")}).safeParse(req.body);
  if(!p.success)return res.status(400).json({error:"Invalid rating"});
  const project=await pool.query(`SELECT p.*,c.citizen_id FROM projects p JOIN challenges c ON c.id=p.challenge_id WHERE p.id=$1 AND p.lead_organization_id=$2`,[p.data.projectId,p.data.organizationId]);
  if(!project.rowCount)return res.status(404).json({error:"Project not found"});
  const participant=await pool.query(`SELECT 1 WHERE $1::uuid=$2::uuid OR EXISTS(SELECT 1 FROM project_members WHERE project_id=$3 AND user_id=$4 AND status='ACTIVE')`,[req.auth!.userId,project.rows[0].citizen_id,p.data.projectId,req.auth!.userId]);
  if(!participant.rowCount)return res.status(403).json({error:"Ratings require a real interaction with the project."});
  try {
    const r=await pool.query(`INSERT INTO organization_ratings(organization_id,project_id,reviewer_id,rating,review) VALUES($1,$2,$3,$4,$5) RETURNING *`,[p.data.organizationId,p.data.projectId,req.auth!.userId,p.data.rating,p.data.review]);
    await audit(req.auth!.userId, "ORGANIZATION_RATED", "PROJECT", p.data.projectId, { organizationId: p.data.organizationId, rating: p.data.rating });
    res.status(201).json({rating:r.rows[0]});
  } catch { res.status(409).json({error:"You have already rated this organization for this project."}); }
});

governmentRouter.get("/ratings/:organizationId", requireAuth, async(req,res)=>{
  const r=await pool.query(`SELECT r.id,r.rating,r.review,r.created_at,u.full_name AS reviewer_name,p.title AS project_title
    FROM organization_ratings r JOIN users u ON u.id=r.reviewer_id JOIN projects p ON p.id=r.project_id WHERE r.organization_id=$1 ORDER BY r.created_at DESC`,[routeParam(req, "organizationId")]);
  res.json({ratings:r.rows});
});
