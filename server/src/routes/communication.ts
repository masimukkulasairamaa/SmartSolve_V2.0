import { Router } from "express";
import { routeParam } from "../params.js";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware.js";
import { translateChallenge, getTranslations } from "../translation.js";
import { notifyUser } from "../notifications.js";

export const communicationRouter=Router();

communicationRouter.get("/notifications",requireAuth,async(req,res)=>{
  const limit=Math.min(Number(req.query.limit)||50,100);
  const r=await pool.query(`SELECT id,type,title,body,entity_type,entity_id,read_at,created_at FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2`,[req.auth!.userId,limit]);
  const unread=await pool.query(`SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL`,[req.auth!.userId]);
  res.json({notifications:r.rows,unreadCount:unread.rows[0].count});
});
communicationRouter.post("/notifications/:id/read",requireAuth,async(req,res)=>{await pool.query(`UPDATE notifications SET read_at=NOW() WHERE id=$1 AND user_id=$2`,[routeParam(req, "id"),req.auth!.userId]);res.json({ok:true});});
communicationRouter.post("/notifications/read-all",requireAuth,async(req,res)=>{await pool.query(`UPDATE notifications SET read_at=NOW() WHERE user_id=$1 AND read_at IS NULL`,[req.auth!.userId]);res.json({ok:true});});

communicationRouter.get("/challenges/:challengeId/translations",requireAuth,async(req,res)=>{
  const c=await pool.query(`SELECT id,citizen_id FROM challenges WHERE id=$1`,[routeParam(req, "challengeId")]);
  if(!c.rowCount)return res.status(404).json({error:"Challenge not found"});
  const authorized= c.rows[0].citizen_id===req.auth!.userId || await pool.query(`SELECT 1 FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2 AND pm.status='ACTIVE' WHERE p.challenge_id=$1 AND (pm.id IS NOT NULL OR p.created_by=$2)`,[routeParam(req, "challengeId"),req.auth!.userId]).then(r=>!!r.rowCount);
  if(!authorized && !["GOVERNMENT","SUPER_ADMIN"].includes(req.auth!.role))return res.status(403).json({error:"You do not have access to this challenge."});
  res.json({translations:await getTranslations(routeParam(req, "challengeId"))});
});
communicationRouter.post("/challenges/:challengeId/translations",requireAuth,async(req,res)=>{
  const parsed=z.object({targetLanguage:z.string().trim().min(2).max(20)}).safeParse(req.body); if(!parsed.success)return res.status(400).json({error:"Target language is required"});
  const c=await pool.query(`SELECT id,citizen_id FROM challenges WHERE id=$1`,[routeParam(req, "challengeId")]); if(!c.rowCount)return res.status(404).json({error:"Challenge not found"});
  const authorized=c.rows[0].citizen_id===req.auth!.userId || ["GOVERNMENT","SUPER_ADMIN"].includes(req.auth!.role) || !!(await pool.query(`SELECT 1 FROM projects p LEFT JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2 AND pm.status='ACTIVE' WHERE p.challenge_id=$1 AND (pm.id IS NOT NULL OR p.created_by=$2)`,[routeParam(req, "challengeId"),req.auth!.userId])).rowCount;
  if(!authorized)return res.status(403).json({error:"You do not have access to this challenge."});
  try{const translation=await translateChallenge(routeParam(req, "challengeId"),parsed.data.targetLanguage);res.status(201).json({translation});}catch(e){res.status(503).json({error:e instanceof Error?e.message:"Translation unavailable"});}
});

communicationRouter.get("/projects/:projectId/messages",requireAuth,async(req,res)=>{
  const p=await pool.query(`SELECT p.id,p.challenge_id,c.citizen_id,p.created_by FROM projects p JOIN challenges c ON c.id=p.challenge_id WHERE p.id=$1 AND (c.citizen_id=$2 OR p.created_by=$2 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2 AND pm.status='ACTIVE'))`,[routeParam(req, "projectId"),req.auth!.userId]);
  if(!p.rowCount)return res.status(403).json({error:"You are not authorized for this project."});
  const r=await pool.query(`SELECT pm.id,pm.message,pm.created_at,u.id AS sender_id,u.full_name AS sender_name,u.role AS sender_role FROM project_messages pm JOIN users u ON u.id=pm.sender_id WHERE pm.project_id=$1 ORDER BY pm.created_at ASC LIMIT 200`,[routeParam(req, "projectId")]);
  res.json({messages:r.rows});
});
communicationRouter.post("/projects/:projectId/messages",requireAuth,async(req,res)=>{
  const parsed=z.object({message:z.string().trim().min(1).max(5000)}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Message is required"});
  const p=await pool.query(`SELECT p.id,p.title,c.citizen_id,p.created_by FROM projects p JOIN challenges c ON c.id=p.challenge_id WHERE p.id=$1 AND (c.citizen_id=$2 OR p.created_by=$2 OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=$2 AND pm.status='ACTIVE'))`,[routeParam(req, "projectId"),req.auth!.userId]);
  if(!p.rowCount)return res.status(403).json({error:"You are not authorized for this project."});
  const m=await pool.query(`INSERT INTO project_messages(project_id,sender_id,message) VALUES($1,$2,$3) RETURNING id,message,created_at`,[p.rows[0].id,req.auth!.userId,parsed.data.message]);
  const participants=await pool.query(`SELECT user_id AS id FROM project_members WHERE project_id=$1 AND status='ACTIVE' UNION SELECT $2::uuid`,[p.rows[0].id,p.rows[0].citizen_id]);
  for(const u of participants.rows)if(u.id!==req.auth!.userId)await notifyUser(u.id,"PROJECT_MESSAGE","New project message",`There is a new message in ${p.rows[0].title}.`,"PROJECT",p.rows[0].id);
  res.status(201).json({message:m.rows[0]});
});
