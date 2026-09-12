import { Router } from "express";
import { routeParam } from "../params.js";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware.js";
import { notifyUser, notifyOrganization } from "../notifications.js";

export const collaborationRouter = Router();

const memberRoles = ["LEAD", "FACULTY_MENTOR", "STUDENT", "INDUSTRY_MENTOR", "INDUSTRY_SUPPORT"] as const;
const projectStatuses = ["FORMING", "ACTIVE", "PROPOSAL_SUBMITTED", "IMPLEMENTATION", "COMPLETED", "CANCELLED"] as const;

function isStaff(role: string) {
  return ["ORGANIZATION_ADMIN", "FACULTY", "INDUSTRY_MEMBER", "GOVERNMENT", "SUPER_ADMIN"].includes(role);
}

async function projectForUser(projectId: string, userId: string) {
  const result = await pool.query(
    `SELECT p.*, o.name AS organization_name, c.title AS challenge_title, c.citizen_id,
            c.allow_contact, c.district, c.status AS challenge_status
     FROM projects p
     JOIN organizations o ON o.id=p.lead_organization_id
     JOIN challenges c ON c.id=p.challenge_id
     WHERE p.id=$1
       AND (c.citizen_id=$2 OR p.created_by=$2 OR EXISTS (SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2 AND pm.status='ACTIVE'))`,
    [projectId, userId]
  );
  return result.rows[0] ?? null;
}

async function canManageProject(project: any, userId: string, role: string, organizationId: string | null) {
  if (!project) return false;
  if (["GOVERNMENT", "SUPER_ADMIN"].includes(role)) return true;
  if (project.created_by === userId) return true;
  if (role === "ORGANIZATION_ADMIN" && organizationId === project.lead_organization_id) return true;
  return false;
}

// Organization directory for signup/profile selection. Contact details are never included.
collaborationRouter.get("/organizations", async (_req, res) => {
  const result = await pool.query(
    `SELECT id, name, organization_type, district, description, verified
     FROM organizations WHERE active=TRUE ORDER BY verified DESC, name ASC`
  );
  res.json({ organizations: result.rows });
});

collaborationRouter.get("/organization/profile", requireAuth, async (req, res) => {
  if (!req.auth!.organizationId) return res.status(403).json({ error: "An organization account is required." });
  const org = await pool.query(`SELECT id,name,organization_type,description,district,address,latitude,longitude,verified,active FROM organizations WHERE id=$1`, [req.auth!.organizationId]);
  if (!org.rowCount) return res.status(404).json({ error: "Organization not found" });
  const [cats,expertise,requests] = await Promise.all([
    pool.query(`SELECT c.slug,c.name FROM organization_categories oc JOIN categories c ON c.id=oc.category_id WHERE oc.organization_id=$1 ORDER BY c.name`, [req.auth!.organizationId]),
    pool.query(`SELECT e.slug,e.name FROM organization_expertise oe JOIN expertise_tags e ON e.id=oe.expertise_id WHERE oe.organization_id=$1 ORDER BY e.name`, [req.auth!.organizationId]),
    pool.query(`SELECT r.slug,r.name FROM organization_request_types ort JOIN request_types r ON r.id=ort.request_type_id WHERE ort.organization_id=$1 ORDER BY r.name`, [req.auth!.organizationId])
  ]);
  const refs = await Promise.all([pool.query(`SELECT slug,name FROM categories ORDER BY name`),pool.query(`SELECT slug,name FROM expertise_tags WHERE active=TRUE ORDER BY name`),pool.query(`SELECT slug,name FROM request_types ORDER BY name`)]);
  res.json({ organization: org.rows[0], categories: cats.rows, expertise: expertise.rows, requestTypes: requests.rows, references: { categories: refs[0].rows, expertise: refs[1].rows, requestTypes: refs[2].rows } });
});

collaborationRouter.patch("/organization/profile", requireAuth, async (req, res) => {
  if (req.auth!.role !== "ORGANIZATION_ADMIN" || !req.auth!.organizationId) return res.status(403).json({ error: "Only an organization administrator can update the organization profile." });
  const parsed = z.object({
    description:z.string().trim().max(5000).default(""), district:z.string().trim().max(100).nullable().optional(), address:z.string().trim().max(500).nullable().optional(),
    latitude:z.number().min(-90).max(90).nullable().optional(), longitude:z.number().min(-180).max(180).nullable().optional(),
    categorySlugs:z.array(z.string().trim().min(1).max(100)).max(30).default([]), expertiseSlugs:z.array(z.string().trim().min(1).max(100)).max(50).default([]), requestTypeSlugs:z.array(z.string().trim().min(1).max(100)).max(30).default([])
  }).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid organization profile",details:parsed.error.flatten()});
  const d=parsed.data; const client=await pool.connect();
  try{await client.query("BEGIN");
    await client.query(`UPDATE organizations SET description=$1,district=$2,address=$3,latitude=COALESCE($4,latitude),longitude=COALESCE($5,longitude) WHERE id=$6`,[d.description,d.district??null,d.address??null,d.latitude??null,d.longitude??null,req.auth!.organizationId]);
    await client.query(`DELETE FROM organization_categories WHERE organization_id=$1`,[req.auth!.organizationId]);
    await client.query(`DELETE FROM organization_expertise WHERE organization_id=$1`,[req.auth!.organizationId]);
    await client.query(`DELETE FROM organization_request_types WHERE organization_id=$1`,[req.auth!.organizationId]);
    for(const slug of d.categorySlugs){const r=await client.query(`SELECT id FROM categories WHERE slug=$1`,[slug]);if(r.rowCount)await client.query(`INSERT INTO organization_categories(organization_id,category_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[req.auth!.organizationId,r.rows[0].id]);}
    for(const slug of d.expertiseSlugs){const r=await client.query(`SELECT id FROM expertise_tags WHERE slug=$1 AND active=TRUE`,[slug]);if(r.rowCount)await client.query(`INSERT INTO organization_expertise(organization_id,expertise_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[req.auth!.organizationId,r.rows[0].id]);}
    for(const slug of d.requestTypeSlugs){const r=await client.query(`SELECT id FROM request_types WHERE slug=$1`,[slug]);if(r.rowCount)await client.query(`INSERT INTO organization_request_types(organization_id,request_type_id) VALUES($1,$2) ON CONFLICT DO NOTHING`,[req.auth!.organizationId,r.rows[0].id]);}
    await client.query("COMMIT");res.json({ok:true});
  }catch(e){await client.query("ROLLBACK");console.error(e);res.status(500).json({error:"Could not update organization profile"});}finally{client.release();}
});

collaborationRouter.get("/organization/members", requireAuth, async (req, res) => {
  if (!req.auth!.organizationId || !["ORGANIZATION_ADMIN", "GOVERNMENT", "SUPER_ADMIN"].includes(req.auth!.role)) {
    return res.status(403).json({ error: "Only organization administrators can view organization members." });
  }
  const result = await pool.query(
    `SELECT id,full_name,email,role,organization_id,preferred_language,active
     FROM users WHERE organization_id=$1 AND active=TRUE ORDER BY role,full_name`, [req.auth!.organizationId]
  );
  res.json({ members: result.rows });
});

// Challenges recommended to an organization using persisted Phase 5 matches.
collaborationRouter.get("/organization/recommended-challenges", requireAuth, async (req, res) => {
  if (!req.auth!.organizationId) return res.status(403).json({ error: "An organization account is required." });
  const result = await pool.query(
    `SELECT cm.id AS match_id,cm.challenge_id,cm.match_type,cm.match_score,cm.distance_km,cm.category_score,cm.expertise_score,cm.request_type_score,cm.location_score,cm.reasons,
            c.title,c.description,c.status,c.urgency_hint,c.district,c.created_at,cat.name AS category,rt.name AS request_type
     FROM challenge_matches cm JOIN challenges c ON c.id=cm.challenge_id
     LEFT JOIN categories cat ON cat.id=c.category_id LEFT JOIN request_types rt ON rt.id=c.request_type_id
     WHERE cm.organization_id=$1 AND c.status NOT IN ('RESOLVED')
     ORDER BY cm.match_score DESC,c.created_at DESC LIMIT 50`, [req.auth!.organizationId]
  );
  res.json({ challenges: result.rows });
});

// Organization admin adopts a challenge and creates its project.
collaborationRouter.post("/challenges/:challengeId/adopt", requireAuth, async (req, res) => {
  const auth = req.auth!;
  if (!auth.organizationId || !["ORGANIZATION_ADMIN", "INDUSTRY_MEMBER"].includes(auth.role)) {
    return res.status(403).json({ error: "Only an authorized organization member can adopt a challenge." });
  }
  const parsed = z.object({ title: z.string().trim().min(5).max(180).optional(), description: z.string().trim().max(5000).optional() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid project data" });

  const challenge = await pool.query(
    `SELECT c.id,c.title,c.description,c.citizen_id,c.allow_contact,c.status
     FROM challenges c WHERE c.id=$1`, [routeParam(req, "challengeId")]
  );
  if (!challenge.rowCount) return res.status(404).json({ error: "Challenge not found" });
  if (["RESOLVED", "CANCELLED"].includes(challenge.rows[0].status)) return res.status(400).json({ error: "This challenge is no longer available for adoption." });

  const existing = await pool.query("SELECT id FROM projects WHERE challenge_id=$1", [routeParam(req, "challengeId")]);
  if (existing.rowCount) return res.status(409).json({ error: "This challenge has already been adopted as a project", projectId: existing.rows[0].id });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const p = await client.query(
      `INSERT INTO projects (challenge_id,lead_organization_id,title,description,status,created_by)
       VALUES ($1,$2,$3,$4,'FORMING',$5) RETURNING id`,
      [routeParam(req, "challengeId"), auth.organizationId, parsed.data.title ?? challenge.rows[0].title, parsed.data.description ?? challenge.rows[0].description, auth.userId]
    );
    const projectId = p.rows[0].id;
    await client.query(
      `INSERT INTO project_members (project_id,user_id,member_role,status) VALUES ($1,$2,'LEAD','ACTIVE')`,
      [projectId, auth.userId]
    );
    await client.query(
      `UPDATE challenges SET status='ADOPTED' WHERE id=$1 AND status NOT IN ('ADOPTED','SOLUTION_DEVELOPMENT','SOLUTION_PROPOSED','IMPLEMENTATION','RESOLVED')`,
      [routeParam(req, "challengeId")]
    );
    await client.query(
      `INSERT INTO challenge_status_history (challenge_id,from_status,to_status,changed_by,reason)
       SELECT $1, $2::challenge_status, 'ADOPTED', $3, 'Challenge adopted by organization'
       WHERE $2::challenge_status <> 'ADOPTED'`,
      [routeParam(req, "challengeId"), challenge.rows[0].status, auth.userId]
    );
    await client.query("COMMIT");
    await notifyUser(challenge.rows[0].citizen_id,"CHALLENGE_ADOPTED","Challenge adopted",`Your challenge has been adopted and a project workspace was created.`,"PROJECT",projectId);
    res.status(201).json({ projectId });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(error);
    res.status(500).json({ error: "Could not adopt challenge" });
  } finally { client.release(); }
});

collaborationRouter.get("/projects", requireAuth, async (req, res) => {
  const auth = req.auth!;
  let result;
  if (auth.role === "CITIZEN") {
    result = await pool.query(
      `SELECT p.id,p.title,p.description,p.status,p.created_at,p.updated_at,o.name AS organization_name,c.title AS challenge_title
       FROM projects p JOIN organizations o ON o.id=p.lead_organization_id JOIN challenges c ON c.id=p.challenge_id
       WHERE c.citizen_id=$1 ORDER BY p.updated_at DESC`, [auth.userId]
    );
  } else if (auth.organizationId) {
    result = await pool.query(
      `SELECT DISTINCT p.id,p.title,p.description,p.status,p.created_at,p.updated_at,o.name AS organization_name,c.title AS challenge_title
       FROM projects p JOIN organizations o ON o.id=p.lead_organization_id JOIN challenges c ON c.id=p.challenge_id
       LEFT JOIN project_members pm ON pm.project_id=p.id
       WHERE p.lead_organization_id=$1 OR pm.user_id=$2 ORDER BY p.updated_at DESC`, [auth.organizationId, auth.userId]
    );
  } else {
    result = await pool.query(
      `SELECT p.id,p.title,p.description,p.status,p.created_at,p.updated_at,o.name AS organization_name,c.title AS challenge_title
       FROM projects p JOIN organizations o ON o.id=p.lead_organization_id JOIN challenges c ON c.id=p.challenge_id
       ORDER BY p.updated_at DESC LIMIT 100`
    );
  }
  res.json({ projects: result.rows });
});

collaborationRouter.get("/projects/:projectId", requireAuth, async (req, res) => {
  const p = await projectForUser(routeParam(req, "projectId"), req.auth!.userId);
  if (!p) return res.status(404).json({ error: "Project not found or access denied" });
  const [members, updates, volunteers] = await Promise.all([
    pool.query(`SELECT pm.id,pm.user_id,pm.member_role,pm.status,pm.joined_at,u.full_name,u.role,u.organization_id
                FROM project_members pm JOIN users u ON u.id=pm.user_id WHERE pm.project_id=$1 ORDER BY pm.joined_at`, [p.id]),
    pool.query(`SELECT pu.id,pu.author_id,pu.update_text,pu.created_at,u.full_name FROM project_updates pu JOIN users u ON u.id=pu.author_id WHERE pu.project_id=$1 ORDER BY pu.created_at DESC`, [p.id]),
    isStaff(req.auth!.role) ? pool.query(`SELECT pv.id,pv.user_id,pv.message,pv.status,pv.created_at,u.full_name,u.role FROM project_volunteers pv JOIN users u ON u.id=pv.user_id WHERE pv.project_id=$1 ORDER BY pv.created_at DESC`, [p.id]) : Promise.resolve({rows:[]} as any)
  ]);
  res.json({ project: p, members: members.rows, updates: updates.rows, volunteers: volunteers.rows });
});

// Student volunteering: one active/pending volunteer request per project.
collaborationRouter.post("/projects/:projectId/volunteer", requireAuth, async (req, res) => {
  const auth = req.auth!;
  if (!['STUDENT','INDUSTRY_MEMBER'].includes(auth.role) || !auth.organizationId) return res.status(403).json({ error: "Only students or industry members linked to an organization can volunteer." });
  const p = await pool.query(`SELECT id,lead_organization_id,status FROM projects WHERE id=$1`, [routeParam(req, "projectId")]);
  if (!p.rowCount) return res.status(404).json({ error: "Project not found" });
  if (p.rows[0].status === "COMPLETED" || p.rows[0].status === "CANCELLED") return res.status(400).json({ error: "This project is not accepting volunteers." });
  if (auth.role === 'STUDENT' && p.rows[0].lead_organization_id !== auth.organizationId) return res.status(403).json({ error: "Student volunteering is limited to projects run by your organization." });
  const parsed = z.object({ message: z.string().trim().max(1000).default("") }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid volunteer message" });
  try {
    await pool.query(`INSERT INTO project_volunteers(project_id,user_id,message) VALUES($1,$2,$3) ON CONFLICT(project_id,user_id) DO UPDATE SET message=EXCLUDED.message,status='PENDING'`, [routeParam(req, "projectId"),auth.userId,parsed.data.message]);
    res.status(201).json({ ok: true, status: "PENDING" });
  } catch (e) { console.error(e); res.status(500).json({ error: "Could not submit volunteer request" }); }
});

collaborationRouter.post("/projects/:projectId/volunteers/:volunteerId/approve", requireAuth, async (req, res) => {
  const p = await projectForUser(routeParam(req, "projectId"), req.auth!.userId);
  if (!p || !(await canManageProject(p, req.auth!.userId, req.auth!.role, req.auth!.organizationId))) return res.status(403).json({ error: "You cannot manage this project." });
  const volunteer = await pool.query(`SELECT user_id FROM project_volunteers WHERE id=$1 AND project_id=$2`, [routeParam(req, "volunteerId"),routeParam(req, "projectId")]);
  if (!volunteer.rowCount) return res.status(404).json({ error: "Volunteer request not found" });
  const client=await pool.connect();
  try { await client.query("BEGIN"); await client.query(`UPDATE project_volunteers SET status='ACTIVE' WHERE id=$1`,[routeParam(req, "volunteerId")]); const volunteerUser = await client.query(`SELECT role FROM users WHERE id=$1`, [volunteer.rows[0].user_id]);
    const memberRole = volunteerUser.rows[0]?.role === 'INDUSTRY_MEMBER' ? 'INDUSTRY_MENTOR' : 'STUDENT';
    await client.query(`INSERT INTO project_members(project_id,user_id,member_role,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(project_id,user_id) DO UPDATE SET status='ACTIVE',member_role=EXCLUDED.member_role`,[routeParam(req, "projectId"),volunteer.rows[0].user_id,memberRole]); await client.query("COMMIT"); await notifyUser(volunteer.rows[0].user_id,"VOLUNTEER_APPROVED","Volunteer request approved","You have been added to the project team.","PROJECT",routeParam(req, "projectId")); res.json({ok:true}); } catch(e){await client.query("ROLLBACK");console.error(e);res.status(500).json({error:"Could not approve volunteer"});} finally{client.release();}
});

collaborationRouter.post("/projects/:projectId/members", requireAuth, async (req, res) => {
  const p = await projectForUser(routeParam(req, "projectId"), req.auth!.userId);
  if (!p || !(await canManageProject(p, req.auth!.userId, req.auth!.role, req.auth!.organizationId))) return res.status(403).json({ error: "You cannot manage this project." });
  const parsed=z.object({userId:z.string().uuid(),memberRole:z.enum(memberRoles)}).safeParse(req.body);
  if(!parsed.success)return res.status(400).json({error:"Invalid member data"});
  const u=await pool.query(`SELECT id,role,organization_id,active FROM users WHERE id=$1`,[parsed.data.userId]);
  if(!u.rowCount||!u.rows[0].active)return res.status(404).json({error:"User not found"});
  const sameOrg = u.rows[0].organization_id === p.lead_organization_id;
  if(parsed.data.memberRole==='FACULTY_MENTOR' && (u.rows[0].role!=='FACULTY' || !sameOrg))return res.status(400).json({error:"Faculty mentors must belong to the lead organization"});
  if(parsed.data.memberRole==='STUDENT' && (u.rows[0].role!=='STUDENT' || !sameOrg))return res.status(400).json({error:"Student members must belong to the lead organization"});
  if(['INDUSTRY_MENTOR','INDUSTRY_SUPPORT'].includes(parsed.data.memberRole) && u.rows[0].role!=='INDUSTRY_MEMBER')return res.status(400).json({error:"Industry collaboration requires an industry member account"});
  if(parsed.data.memberRole==='LEAD' && !sameOrg)return res.status(400).json({error:"The project lead must belong to the lead organization"});
  await pool.query(`INSERT INTO project_members(project_id,user_id,member_role,status) VALUES($1,$2,$3,'ACTIVE') ON CONFLICT(project_id,user_id) DO UPDATE SET member_role=EXCLUDED.member_role,status='ACTIVE'`,[p.id,u.rows[0].id,parsed.data.memberRole]);
  res.status(201).json({ok:true});
});

collaborationRouter.post("/projects/:projectId/updates", requireAuth, async (req,res)=>{
  const p=await projectForUser(routeParam(req, "projectId"),req.auth!.userId); if(!p)return res.status(404).json({error:"Project not found or access denied"});
  const parsed=z.object({updateText:z.string().trim().min(2).max(5000)}).safeParse(req.body); if(!parsed.success)return res.status(400).json({error:"Update text is required"});
  await pool.query(`INSERT INTO project_updates(project_id,author_id,update_text) VALUES($1,$2,$3)`,[p.id,req.auth!.userId,parsed.data.updateText]);
  res.status(201).json({ok:true});
});

collaborationRouter.patch("/projects/:projectId/status", requireAuth, async (req,res)=>{
  const p=await projectForUser(routeParam(req, "projectId"),req.auth!.userId); if(!p||!(await canManageProject(p,req.auth!.userId,req.auth!.role,req.auth!.organizationId)))return res.status(403).json({error:"You cannot change this project."});
  const parsed=z.object({status:z.enum(projectStatuses)}).safeParse(req.body); if(!parsed.success)return res.status(400).json({error:"Invalid project status"});
  await pool.query(`UPDATE projects SET status=$1 WHERE id=$2`,[parsed.data.status,p.id]);
  const challengeTarget = parsed.data.status === 'IMPLEMENTATION' ? 'IMPLEMENTATION' : parsed.data.status === 'PROPOSAL_SUBMITTED' ? 'SOLUTION_PROPOSED' : parsed.data.status === 'ACTIVE' ? 'ADOPTED' : null;
  if (challengeTarget) {
    const current = await pool.query(`SELECT status FROM challenges WHERE id=$1`, [p.challenge_id]);
    if (current.rowCount && current.rows[0].status !== challengeTarget) {
      await pool.query(`UPDATE challenges SET status=$1 WHERE id=$2`, [challengeTarget, p.challenge_id]);
      await pool.query(`INSERT INTO challenge_status_history(challenge_id,from_status,to_status,changed_by,reason) VALUES($1,$2,$3,$4,$5)`, [p.challenge_id,current.rows[0].status,challengeTarget,req.auth!.userId,`Project status changed to ${parsed.data.status}`]);
    }
  }
  res.json({ok:true,status:parsed.data.status});
});

// Secure contact request: requester must be on the project; citizen must have opted in.
collaborationRouter.post("/challenges/:challengeId/contact-requests", requireAuth, async (req,res)=>{
  const auth=req.auth!;
  const parsed=z.object({reason:z.string().trim().min(10).max(1000),projectId:z.string().uuid().optional()}).safeParse(req.body); if(!parsed.success)return res.status(400).json({error:"A clear contact reason is required"});
  const c=await pool.query(`SELECT id,citizen_id,allow_contact FROM challenges WHERE id=$1`,[routeParam(req, "challengeId")]); if(!c.rowCount)return res.status(404).json({error:"Challenge not found"});
  if(c.rows[0].citizen_id===auth.userId)return res.status(400).json({error:"You cannot request your own contact details"});
  if(!c.rows[0].allow_contact)return res.status(403).json({error:"The citizen has not enabled contact requests for this challenge."});
  if(parsed.data.projectId){const p=await projectForUser(parsed.data.projectId,auth.userId);if(!p||p.challenge_id!==routeParam(req, "challengeId"))return res.status(403).json({error:"You are not authorized for this project."});}
  else { const member=await pool.query(`SELECT pm.id FROM project_members pm JOIN projects p ON p.id=pm.project_id WHERE p.challenge_id=$1 AND pm.user_id=$2 AND pm.status='ACTIVE'`,[routeParam(req, "challengeId"),auth.userId]); if(!member.rowCount)return res.status(403).json({error:"Only an active project participant can request citizen contact."}); }
  const existing=await pool.query(`SELECT id,status FROM contact_requests WHERE challenge_id=$1 AND requester_id=$2`,[routeParam(req, "challengeId"),auth.userId]); if(existing.rowCount&&existing.rows[0].status==='PENDING')return res.status(409).json({error:"A contact request is already pending"});
  const r=await pool.query(`INSERT INTO contact_requests(challenge_id,project_id,requester_id,citizen_id,reason,status) VALUES($1,$2,$3,$4,$5,'PENDING') ON CONFLICT(challenge_id,requester_id) DO UPDATE SET project_id=EXCLUDED.project_id,reason=EXCLUDED.reason,status='PENDING',responded_at=NULL RETURNING id,status`,[routeParam(req, "challengeId"),parsed.data.projectId??null,auth.userId,c.rows[0].citizen_id,parsed.data.reason]);
  await notifyUser(c.rows[0].citizen_id,"CONTACT_REQUEST","Contact request","A project participant requested permission to contact you.","CONTACT_REQUEST",r.rows[0].id);
  res.status(201).json(r.rows[0]);
});

collaborationRouter.get("/contact-requests", requireAuth, async (req,res)=>{
  const auth=req.auth!;
  let q;
  if(auth.role==='CITIZEN') q=pool.query(`SELECT cr.id,cr.challenge_id,cr.project_id,cr.requester_id,cr.reason,cr.status,cr.created_at,cr.responded_at,c.title AS challenge_title,u.full_name AS requester_name,o.name AS requester_organization FROM contact_requests cr JOIN challenges c ON c.id=cr.challenge_id JOIN users u ON u.id=cr.requester_id LEFT JOIN organizations o ON o.id=u.organization_id WHERE cr.citizen_id=$1 ORDER BY cr.created_at DESC`,[auth.userId]);
  else q=pool.query(`SELECT cr.id,cr.challenge_id,cr.project_id,cr.citizen_id,cr.reason,cr.status,cr.created_at,cr.responded_at,c.title AS challenge_title,u.full_name AS citizen_name FROM contact_requests cr JOIN challenges c ON c.id=cr.challenge_id JOIN users u ON u.id=cr.citizen_id WHERE cr.requester_id=$1 ORDER BY cr.created_at DESC`,[auth.userId]);
  res.json({requests:(await q).rows});
});

collaborationRouter.post("/contact-requests/:id/respond", requireAuth, async(req,res)=>{
  if(req.auth!.role!=='CITIZEN')return res.status(403).json({error:"Only the citizen can respond to this request"});
  const parsed=z.object({decision:z.enum(["APPROVED","REJECTED"])}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Invalid decision"});
  const r=await pool.query(`UPDATE contact_requests SET status=$1,responded_at=NOW() WHERE id=$2 AND citizen_id=$3 AND status='PENDING' RETURNING id,status,requester_id`,[parsed.data.decision,routeParam(req, "id"),req.auth!.userId]);
  if(!r.rowCount)return res.status(404).json({error:"Contact request not found or already answered"});
  if(parsed.data.decision==='APPROVED'){
    await notifyUser(r.rows[0].requester_id,"CONTACT_APPROVED","Contact request approved","The citizen approved your request. You may now view the approved contact details.","CONTACT_REQUEST",routeParam(req, "id"));
  } else {
    await notifyUser(r.rows[0].requester_id,"CONTACT_REJECTED","Contact request declined","The citizen declined your contact request.","CONTACT_REQUEST",routeParam(req, "id"));
  }
  res.json({ok:true,status:r.rows[0].status});
});

collaborationRouter.get("/contact-requests/:id/contact", requireAuth, async(req,res)=>{
  const r=await pool.query(`SELECT cr.*,c.allow_contact,u.full_name,u.email,u.phone FROM contact_requests cr JOIN challenges c ON c.id=cr.challenge_id JOIN users u ON u.id=cr.citizen_id WHERE cr.id=$1 AND cr.requester_id=$2 AND cr.status='APPROVED'`,[routeParam(req, "id"),req.auth!.userId]);
  if(!r.rowCount)return res.status(403).json({error:"Contact details are not available. The citizen must approve the request first."});
  res.json({contact:{full_name:r.rows[0].full_name,email:r.rows[0].email,phone:r.rows[0].phone}});
});
