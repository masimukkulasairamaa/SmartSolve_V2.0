import { Router } from "express";
import type { Request } from "express";
import { routeParam } from "../params.js";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware.js";
import multer from "multer";
import { persistUploadedFile } from "../storage.js";

export const lifecycleRouter = Router();

const lifecycleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowed = new Set([
      "image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ]);
    cb(null, allowed.has(file.mimetype));
  }
});

const statuses = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED", "BLOCKED"] as const;
const solutionStatuses = ["DRAFT", "SUBMITTED", "APPROVED", "REJECTED"] as const;
const testingStatuses = ["NOT_STARTED", "IN_PROGRESS", "PASSED", "FAILED", "CONDITIONAL"] as const;
const validationStatuses = ["PENDING", "VALIDATED", "NEEDS_CHANGES", "REJECTED"] as const;

async function projectForUser(projectId: string, userId: string) {
  const r = await pool.query(
    `SELECT p.*, c.citizen_id, c.allow_contact, c.status AS challenge_status
     FROM projects p JOIN challenges c ON c.id=p.challenge_id
     WHERE p.id=$1 AND (
       c.citizen_id=$2 OR p.created_by=$2 OR
       EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2 AND pm.status='ACTIVE')
     )`, [projectId, userId]
  );
  return r.rows[0] ?? null;
}

async function canManage(project: any, req: any) {
  if (!project) return false;
  if (["GOVERNMENT", "SUPER_ADMIN"].includes(req.auth.role)) return true;
  if (project.created_by === req.auth.userId) return true;
  return req.auth.role === "ORGANIZATION_ADMIN" && req.auth.organizationId === project.lead_organization_id;
}

async function isProjectParticipant(projectId: string, userId: string) {
  const r = await pool.query(`SELECT 1 FROM project_members WHERE project_id=$1 AND user_id=$2 AND status='ACTIVE'`, [projectId, userId]);
  return !!r.rowCount;
}

async function lifecycle(projectId: string) {
  const [milestones, deliverables, solutions, testing, validations, innovation, impact] = await Promise.all([
    pool.query(`SELECT pm.*, u.full_name AS created_by_name FROM project_milestones pm JOIN users u ON u.id=pm.created_by WHERE pm.project_id=$1 ORDER BY sequence_no`, [projectId]),
    pool.query(`SELECT pd.*, u.full_name AS submitted_by_name FROM project_deliverables pd JOIN users u ON u.id=pd.submitted_by WHERE pd.project_id=$1 ORDER BY pd.created_at DESC`, [projectId]),
    pool.query(`SELECT s.*, u.full_name AS submitted_by_name, ru.full_name AS reviewed_by_name FROM solutions s JOIN users u ON u.id=s.submitted_by LEFT JOIN users ru ON ru.id=s.reviewed_by WHERE s.project_id=$1 ORDER BY s.version DESC`, [projectId]),
    pool.query(`SELECT st.*, u.full_name AS tested_by_name FROM solution_testing st LEFT JOIN users u ON u.id=st.tested_by WHERE st.solution_id IN (SELECT id FROM solutions WHERE project_id=$1)`, [projectId]),
    pool.query(`SELECT sv.*, u.full_name AS validator_name FROM solution_validations sv JOIN users u ON u.id=sv.validator_id WHERE sv.solution_id IN (SELECT id FROM solutions WHERE project_id=$1) ORDER BY sv.created_at DESC`, [projectId]),
    pool.query(`SELECT * FROM innovation_outcomes WHERE project_id=$1`, [projectId]),
    pool.query(`SELECT * FROM impact_records WHERE project_id=$1`, [projectId])
  ]);
  const total = milestones.rowCount ?? 0;
  const completed = milestones.rows.filter((m: any) => m.status === "COMPLETED").length;
  return {
    milestones: milestones.rows,
    deliverables: deliverables.rows,
    solutions: solutions.rows,
    testing: testing.rows,
    validations: validations.rows,
    innovation: innovation.rows[0] ?? null,
    impact: impact.rows[0] ?? null,
    progress: total ? Math.round(completed / total * 100) : 0
  };
}

lifecycleRouter.get("/projects/:projectId/lifecycle", requireAuth, async (req, res) => {
  const project = await projectForUser(routeParam(req, "projectId"), req.auth!.userId);
  if (!project) return res.status(404).json({ error: "Project not found or access denied" });
  res.json({ project, lifecycle: await lifecycle(routeParam(req, "projectId")) });
});



lifecycleRouter.get("/projects/:projectId/milestone-approvals", requireAuth, async (req,res)=>{
  const project=await projectForUser(routeParam(req, "projectId"),req.auth!.userId);
  if(!project)return res.status(404).json({error:"Project not found or access denied"});
  const r=await pool.query(`SELECT a.*,u.full_name AS approver_name,pm.name AS milestone_name FROM project_milestone_approvals a JOIN users u ON u.id=a.approver_id JOIN project_milestones pm ON pm.id=a.milestone_id WHERE pm.project_id=$1 ORDER BY a.created_at DESC`,[project.id]);
  res.json({approvals:r.rows});
});

lifecycleRouter.post("/projects/:projectId/milestones", requireAuth, async (req, res) => {
  const project = await projectForUser(routeParam(req, "projectId"), req.auth!.userId);
  if (!(await canManage(project, req))) return res.status(403).json({ error: "You cannot manage this project." });
  const p = z.object({ name:z.string().trim().min(2).max(160), description:z.string().trim().max(5000).default(""), sequenceNo:z.number().int().positive().optional(), dueDate:z.string().date().nullable().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error: "Invalid milestone data", details:p.error.flatten() });
  const seq = p.data.sequenceNo ?? Number((await pool.query(`SELECT COALESCE(MAX(sequence_no),0)+1 AS n FROM project_milestones WHERE project_id=$1`, [project.id])).rows[0].n);
  try {
    const r = await pool.query(`INSERT INTO project_milestones(project_id,name,description,sequence_no,due_date,created_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [project.id,p.data.name,p.data.description,seq,p.data.dueDate??null,req.auth!.userId]);
    res.status(201).json({ milestone:r.rows[0] });
  } catch { res.status(409).json({ error: "Milestone sequence already exists" }); }
});

lifecycleRouter.patch("/milestones/:milestoneId", requireAuth, async (req, res) => {
  const r = await pool.query(`SELECT pm.*,p.id AS project_id FROM project_milestones pm JOIN projects p ON p.id=pm.project_id WHERE pm.id=$1`, [routeParam(req, "milestoneId")]);
  if (!r.rowCount) return res.status(404).json({ error: "Milestone not found" });
  const project = await projectForUser(r.rows[0].project_id, req.auth!.userId);
  if (!(await canManage(project, req))) return res.status(403).json({ error: "You cannot manage this project." });
  const p = z.object({ name:z.string().trim().min(2).max(160).optional(), description:z.string().trim().max(5000).optional(), status:z.enum(statuses).optional(), dueDate:z.string().date().nullable().optional() }).safeParse(req.body);
  if (!p.success) return res.status(400).json({ error:"Invalid milestone update" });
  const d=p.data; const completedAt=d.status === "COMPLETED" ? "NOW()" : null;
  const updated = await pool.query(`UPDATE project_milestones SET name=COALESCE($1,name),description=COALESCE($2,description),status=COALESCE($3,status),due_date=COALESCE($4,due_date),completed_at=${completedAt ? "NOW()" : "CASE WHEN $3 IS NOT NULL AND $3 <> 'COMPLETED' THEN NULL ELSE completed_at END"} WHERE id=$5 RETURNING *`, [d.name??null,d.description??null,d.status??null,d.dueDate??null,r.rows[0].id]);
  res.json({ milestone:updated.rows[0] });
});

lifecycleRouter.post("/milestones/:milestoneId/deliverables", requireAuth, lifecycleUpload.single("file"), async (req, res) => {
  const r=await pool.query(`SELECT pm.*,p.id AS project_id FROM project_milestones pm JOIN projects p ON p.id=pm.project_id WHERE pm.id=$1`,[routeParam(req, "milestoneId")]);
  if(!r.rowCount)return res.status(404).json({error:"Milestone not found"});
  const project=await projectForUser(r.rows[0].project_id,req.auth!.userId);
  if(!project || !(await isProjectParticipant(project.id,req.auth!.userId) || await canManage(project,req)))return res.status(403).json({error:"Only project participants can submit deliverables."});
  const p=z.object({title:z.string().trim().min(2).max(180),description:z.string().trim().max(5000).default("")}).safeParse(req.body);
  const file=req.file;
  if(!p.success)return res.status(400).json({error:"Invalid deliverable data"});
  if(!file)return res.status(400).json({error:"A deliverable file is required"});
  const d=await pool.query(`INSERT INTO project_deliverables(milestone_id,project_id,title,description,storage_path,original_name,mime_type,size_bytes,submitted_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,[r.rows[0].id,project.id,p.data.title,p.data.description,await persistUploadedFile(file),file.originalname,file.mimetype,file.size,req.auth!.userId]);
  res.status(201).json({deliverable:d.rows[0]});
});

lifecycleRouter.post("/projects/:projectId/milestones/:milestoneId/approve", requireAuth, async (req,res)=>{
  const project=await projectForUser(routeParam(req, "projectId"),req.auth!.userId);
  if(!(await canManage(project,req)))return res.status(403).json({error:"Only project managers can approve milestones."});
  const m=await pool.query(`SELECT id FROM project_milestones WHERE id=$1 AND project_id=$2`,[routeParam(req, "milestoneId"),routeParam(req, "projectId")]);
  if(!m.rowCount)return res.status(404).json({error:"Milestone not found"});
  const p=z.object({decision:z.enum(["APPROVED","CHANGES_REQUESTED","REJECTED"]),comments:z.string().trim().max(3000).default("")}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid approval"});
  await pool.query(`INSERT INTO project_milestone_approvals(milestone_id,approver_id,decision,comments) VALUES($1,$2,$3,$4)`,[m.rows[0].id,req.auth!.userId,p.data.decision,p.data.comments]);
  if(p.data.decision==='APPROVED')await pool.query(`UPDATE project_milestones SET status='COMPLETED',completed_at=NOW() WHERE id=$1`,[m.rows[0].id]);
  res.json({ok:true,decision:p.data.decision});
});

lifecycleRouter.post("/projects/:projectId/solutions", requireAuth, async (req,res)=>{
  const project=await projectForUser(routeParam(req, "projectId"),req.auth!.userId);if(!project||!(await isProjectParticipant(project.id,req.auth!.userId)))return res.status(403).json({error:"Only project participants can submit solutions."});
  const p=z.object({problemUnderstanding:z.string().trim().min(20).max(10000),proposedSolution:z.string().trim().min(20).max(12000),technology:z.string().trim().max(5000).default(""),expectedImpact:z.string().trim().max(5000).default(""),estimatedCost:z.number().nonnegative().nullable().optional(),implementationPlan:z.string().trim().max(10000).default(""),status:z.enum(solutionStatuses).default("SUBMITTED")}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid solution proposal",details:p.error.flatten()});
  const version=Number((await pool.query(`SELECT COALESCE(MAX(version),0)+1 AS v FROM solutions WHERE project_id=$1`,[project.id])).rows[0].v);
  const s=await pool.query(`INSERT INTO solutions(project_id,version,problem_understanding,proposed_solution,technology,expected_impact,estimated_cost,implementation_plan,status,submitted_by,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $9='SUBMITTED' THEN NOW() ELSE NULL END) RETURNING *`,[project.id,version,p.data.problemUnderstanding,p.data.proposedSolution,p.data.technology,p.data.expectedImpact,p.data.estimatedCost??null,p.data.implementationPlan,p.data.status,req.auth!.userId]);
  await pool.query(`UPDATE projects SET status=CASE WHEN status='FORMING' OR status='ACTIVE' THEN 'PROPOSAL_SUBMITTED' ELSE status END WHERE id=$1`,[project.id]);
  await pool.query(`UPDATE challenges SET status=CASE WHEN status IN ('SUBMITTED','UNDER_REVIEW','AI_ANALYZED','INSTITUTIONS_MATCHED','VIEWED','ADOPTED','SOLUTION_DEVELOPMENT') THEN 'SOLUTION_PROPOSED' ELSE status END WHERE id=$1`,[project.challenge_id]);
  res.status(201).json({solution:s.rows[0]});
});

lifecycleRouter.patch("/solutions/:solutionId/review", requireAuth, async (req,res)=>{
  const r=await pool.query(`SELECT s.*,p.id AS project_id,p.lead_organization_id FROM solutions s JOIN projects p ON p.id=s.project_id WHERE s.id=$1`,[routeParam(req, "solutionId")]);if(!r.rowCount)return res.status(404).json({error:"Solution not found"});
  const project=await projectForUser(r.rows[0].project_id,req.auth!.userId);if(!(await canManage(project,req)))return res.status(403).json({error:"Only project managers can review solutions."});
  const p=z.object({status:z.enum(["APPROVED","REJECTED"]),comments:z.string().trim().max(5000).default("")}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid solution review"});
  const s=await pool.query(`UPDATE solutions SET status=$1,reviewed_by=$2,review_comments=$3,reviewed_at=NOW() WHERE id=$4 RETURNING *`,[p.data.status,req.auth!.userId,p.data.comments,r.rows[0].id]);
  res.json({solution:s.rows[0]});
});

lifecycleRouter.post("/solutions/:solutionId/testing", requireAuth, lifecycleUpload.single("evidence"), async (req,res)=>{
  const r=await pool.query(`SELECT s.*,p.id AS project_id FROM solutions s JOIN projects p ON p.id=s.project_id WHERE s.id=$1`,[routeParam(req, "solutionId")]);if(!r.rowCount)return res.status(404).json({error:"Solution not found"});
  const project=await projectForUser(r.rows[0].project_id,req.auth!.userId);if(!project||!(await isProjectParticipant(project.id,req.auth!.userId)))return res.status(403).json({error:"Only project participants can record testing."});
  const p=z.object({status:z.enum(testingStatuses),testPlan:z.string().trim().max(10000).default(""),results:z.string().trim().max(10000).default(""),feedback:z.string().trim().max(5000).default("")}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid testing data"});
  const f=req.file;const t=await pool.query(`INSERT INTO solution_testing(solution_id,status,test_plan,results,feedback,evidence_path,evidence_name,evidence_mime_type,evidence_size_bytes,tested_by,tested_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,CASE WHEN $2 IN ('PASSED','FAILED','CONDITIONAL') THEN NOW() ELSE NULL END) ON CONFLICT(solution_id) DO UPDATE SET status=EXCLUDED.status,test_plan=EXCLUDED.test_plan,results=EXCLUDED.results,feedback=EXCLUDED.feedback,evidence_path=COALESCE(EXCLUDED.evidence_path,solution_testing.evidence_path),evidence_name=COALESCE(EXCLUDED.evidence_name,solution_testing.evidence_name),evidence_mime_type=COALESCE(EXCLUDED.evidence_mime_type,solution_testing.evidence_mime_type),evidence_size_bytes=COALESCE(EXCLUDED.evidence_size_bytes,solution_testing.evidence_size_bytes),tested_by=EXCLUDED.tested_by,tested_at=EXCLUDED.tested_at RETURNING *`,[r.rows[0].id,p.data.status,p.data.testPlan,p.data.results,p.data.feedback,f ? await persistUploadedFile(f) : null,f?.originalname??null,f?.mimetype??null,f?.size??null,req.auth!.userId]);
  if(['PASSED','CONDITIONAL'].includes(p.data.status)){
    const current=await pool.query(`SELECT status FROM challenges WHERE id=$1`,[project.challenge_id]);
    await pool.query(`UPDATE projects SET status='IMPLEMENTATION' WHERE id=$1 AND status IN ('PROPOSAL_SUBMITTED','ACTIVE')`,[project.id]);
    if(current.rowCount && !['IMPLEMENTATION','RESOLVED'].includes(current.rows[0].status)){
      await pool.query(`UPDATE challenges SET status='IMPLEMENTATION' WHERE id=$1`,[project.challenge_id]);
      await pool.query(`INSERT INTO challenge_status_history(challenge_id,from_status,to_status,changed_by,reason) VALUES($1,$2,'IMPLEMENTATION',$3,'Solution testing moved project to implementation')`,[project.challenge_id,current.rows[0].status,req.auth!.userId]);
    }
  }
  res.status(201).json({testing:t.rows[0]});
});

lifecycleRouter.post("/solutions/:solutionId/validation", requireAuth, lifecycleUpload.single("evidence"), async (req,res)=>{
  const r=await pool.query(`SELECT s.*,p.id AS project_id,p.challenge_id FROM solutions s JOIN projects p ON p.id=s.project_id WHERE s.id=$1`,[routeParam(req, "solutionId")]);if(!r.rowCount)return res.status(404).json({error:"Solution not found"});
  const project=await projectForUser(r.rows[0].project_id,req.auth!.userId);if(!project)return res.status(404).json({error:"Project not found or access denied"});
  const allowed=await canManage(project,req)||project.citizen_id===req.auth!.userId||req.auth!.role==='FACULTY';if(!allowed)return res.status(403).json({error:"You are not authorized to validate this solution."});
  const p=z.object({status:z.enum(validationStatuses),feedback:z.string().trim().max(8000).default("")}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid validation data"});
  const f=req.file;const v=await pool.query(`INSERT INTO solution_validations(solution_id,validator_id,validator_role,status,feedback,evidence_path,evidence_name,evidence_mime_type,evidence_size_bytes,validated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $4='VALIDATED' THEN NOW() ELSE NULL END) RETURNING *`,[r.rows[0].id,req.auth!.userId,req.auth!.role,p.data.status,p.data.feedback,f ? await persistUploadedFile(f) : null,f?.originalname??null,f?.mimetype??null,f?.size??null]);
  if(p.data.status==='VALIDATED'){
    const current=await pool.query(`SELECT status FROM challenges WHERE id=$1`,[project.challenge_id]);
    await pool.query(`UPDATE projects SET status='COMPLETED' WHERE id=$1`,[project.id]);
    await pool.query(`UPDATE challenges SET status='RESOLVED' WHERE id=$1`,[project.challenge_id]);
    if(current.rowCount && current.rows[0].status !== 'RESOLVED') {
      await pool.query(`INSERT INTO challenge_status_history(challenge_id,from_status,to_status,changed_by,reason) VALUES($1,$2,'RESOLVED',$3,'Solution validated through Phase 7 lifecycle')`,[project.challenge_id,current.rows[0].status,req.auth!.userId]);
    }
  }
  res.status(201).json({validation:v.rows[0]});
});

lifecycleRouter.put("/projects/:projectId/innovation", requireAuth, async (req,res)=>{
  const project=await projectForUser(routeParam(req, "projectId"),req.auth!.userId);if(!(await canManage(project,req)))return res.status(403).json({error:"Only project managers can record innovation outcomes."});
  const p=z.object({patentGenerated:z.boolean().default(false),startupCreated:z.boolean().default(false),prototypeCreated:z.boolean().default(false),technologyTransfer:z.boolean().default(false),researchPublication:z.boolean().default(false),implementationCompleted:z.boolean().default(false),outcomeNotes:z.string().trim().max(8000).default(""),referenceUrl:z.string().url().max(1000).nullable().optional()}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid innovation outcome"});
  const d=p.data;const r=await pool.query(`INSERT INTO innovation_outcomes(project_id,patent_generated,startup_created,prototype_created,technology_transfer,research_publication,implementation_completed,outcome_notes,reference_url,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(project_id) DO UPDATE SET patent_generated=EXCLUDED.patent_generated,startup_created=EXCLUDED.startup_created,prototype_created=EXCLUDED.prototype_created,technology_transfer=EXCLUDED.technology_transfer,research_publication=EXCLUDED.research_publication,implementation_completed=EXCLUDED.implementation_completed,outcome_notes=EXCLUDED.outcome_notes,reference_url=EXCLUDED.reference_url,recorded_by=EXCLUDED.recorded_by,updated_at=NOW() RETURNING *`,[project.id,d.patentGenerated,d.startupCreated,d.prototypeCreated,d.technologyTransfer,d.researchPublication,d.implementationCompleted,d.outcomeNotes,d.referenceUrl??null,req.auth!.userId]);
  res.json({innovation:r.rows[0]});
});

lifecycleRouter.put("/projects/:projectId/impact", requireAuth, async (req,res)=>{
  const project=await projectForUser(routeParam(req, "projectId"),req.auth!.userId);if(!(await canManage(project,req)))return res.status(403).json({error:"Only project managers can record impact."});
  const p=z.object({peopleAffected:z.number().int().nonnegative().nullable().optional(),villagesAffected:z.number().int().nonnegative().nullable().optional(),district:z.string().trim().max(100).nullable().optional(),estimatedCost:z.number().nonnegative().nullable().optional(),timeSavedHours:z.number().nonnegative().nullable().optional(),environmentalBenefit:z.string().trim().max(5000).default(""),economicBenefit:z.string().trim().max(5000).default(""),otherImpact:z.string().trim().max(5000).default("")}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid impact record"});
  const d=p.data;const r=await pool.query(`INSERT INTO impact_records(project_id,people_affected,villages_affected,district,estimated_cost,time_saved_hours,environmental_benefit,economic_benefit,other_impact,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(project_id) DO UPDATE SET people_affected=EXCLUDED.people_affected,villages_affected=EXCLUDED.villages_affected,district=EXCLUDED.district,estimated_cost=EXCLUDED.estimated_cost,time_saved_hours=EXCLUDED.time_saved_hours,environmental_benefit=EXCLUDED.environmental_benefit,economic_benefit=EXCLUDED.economic_benefit,other_impact=EXCLUDED.other_impact,recorded_by=EXCLUDED.recorded_by,updated_at=NOW() RETURNING *`,[project.id,d.peopleAffected??null,d.villagesAffected??null,d.district??null,d.estimatedCost??null,d.timeSavedHours??null,d.environmentalBenefit,d.economicBenefit,d.otherImpact,req.auth!.userId]);
  res.json({impact:r.rows[0]});
});
