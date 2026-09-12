import { Router } from "express";
import { routeParam } from "../params.js";
import { z } from "zod";
import { pool } from "../db/pool.js";
import { requireAuth } from "../middleware.js";
import { notifyOrganization, notifyUser } from "../notifications.js";
import { config } from "../config.js";

export const sosRouter=Router();
const haversine=`(6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(o.latitude-$1)/2),2)+COS(RADIANS($1))*COS(RADIANS(o.latitude))*POWER(SIN(RADIANS(o.longitude-$2)/2),2))))`;

sosRouter.post("/",requireAuth,async(req,res)=>{
  const parsed=z.object({latitude:z.number().min(-90).max(90),longitude:z.number().min(-180).max(180),urgentInformation:z.string().trim().max(2000).default("")}).safeParse(req.body);if(!parsed.success)return res.status(400).json({error:"Valid location is required to activate SOS."});
  const r=await pool.query(`INSERT INTO sos_alerts(user_id,latitude,longitude,urgent_information) VALUES($1,$2,$3,$4) RETURNING *`,[req.auth!.userId,parsed.data.latitude,parsed.data.longitude,parsed.data.urgentInformation]);
  const alert=r.rows[0];
  const orgs=await pool.query(`SELECT o.id,o.name,${haversine} AS distance_km FROM organizations o WHERE o.active=TRUE AND o.receives_sos_alerts=TRUE AND o.latitude IS NOT NULL AND o.longitude IS NOT NULL AND ${haversine} <= LEAST(o.sos_radius_km,$3) ORDER BY distance_km ASC`,[parsed.data.latitude,parsed.data.longitude,config.sosRadiusKm]);
  for(const o of orgs.rows){await pool.query(`INSERT INTO sos_recipients(sos_alert_id,organization_id,distance_km) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[alert.id,o.id,o.distance_km]);await notifyOrganization(o.id,"SOS_ALERT",`Urgent SOS near ${o.name}`,`An active SOS alert was triggered ${Number(o.distance_km).toFixed(1)} km from your organization. Open the SOS dashboard to review it.`,"SOS",alert.id);}
  res.status(201).json({alert,notifiedOrganizations:orgs.rows.map((o:any)=>({id:o.id,name:o.name,distanceKm:Number(o.distance_km)}))});
});
sosRouter.get("/mine",requireAuth,async(req,res)=>{const r=await pool.query(`SELECT * FROM sos_alerts WHERE user_id=$1 ORDER BY activated_at DESC LIMIT 20`,[req.auth!.userId]);res.json({alerts:r.rows});});
sosRouter.get("/active",requireAuth,async(req,res)=>{if(!["GOVERNMENT","SUPER_ADMIN"].includes(req.auth!.role))return res.status(403).json({error:"Government authorization required."});const r=await pool.query(`SELECT s.*,u.full_name,u.phone FROM sos_alerts s JOIN users u ON u.id=s.user_id WHERE s.status IN ('ACTIVE','ACKNOWLEDGED') ORDER BY s.activated_at DESC`);res.json({alerts:r.rows});});
sosRouter.post("/:id/acknowledge",requireAuth,async(req,res)=>{if(!["GOVERNMENT","SUPER_ADMIN","ORGANIZATION_ADMIN","FACULTY","INDUSTRY_MEMBER"].includes(req.auth!.role))return res.status(403).json({error:"Authorized responders only."});const r=await pool.query(`UPDATE sos_alerts SET status='ACKNOWLEDGED',acknowledged_at=COALESCE(acknowledged_at,NOW()) WHERE id=$1 AND status='ACTIVE' RETURNING user_id`,[routeParam(req, "id")]);if(!r.rowCount)return res.status(404).json({error:"Active SOS not found"});await notifyUser(r.rows[0].user_id,"SOS_ACKNOWLEDGED","SOS acknowledged","A configured responder has acknowledged your SOS alert.","SOS",routeParam(req, "id"));res.json({ok:true});});
sosRouter.post("/:id/resolve",requireAuth,async(req,res)=>{if(!["GOVERNMENT","SUPER_ADMIN"].includes(req.auth!.role))return res.status(403).json({error:"Government authorization required."});const p=z.object({resolutionNote:z.string().trim().max(2000).default("")}).safeParse(req.body);if(!p.success)return res.status(400).json({error:"Invalid resolution note"});const r=await pool.query(`UPDATE sos_alerts SET status='RESOLVED',resolved_at=NOW(),resolved_by=$2,resolution_note=$3 WHERE id=$1 AND status IN ('ACTIVE','ACKNOWLEDGED') RETURNING user_id`,[routeParam(req, "id"),req.auth!.userId,p.data.resolutionNote]);if(!r.rowCount)return res.status(404).json({error:"SOS not found or already resolved"});await notifyUser(r.rows[0].user_id,"SOS_RESOLVED","SOS resolved","Your SOS alert has been marked resolved by an authorized government responder.","SOS",routeParam(req, "id"));res.json({ok:true});});
