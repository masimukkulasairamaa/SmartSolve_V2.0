import { pool } from "./db/pool.js";

export async function notifyUser(userId: string, type: string, title: string, body: string, entityType?: string, entityId?: string) {
  await pool.query(`INSERT INTO notifications(user_id,type,title,body,entity_type,entity_id) VALUES($1,$2,$3,$4,$5,$6)`, [userId,type,title,body,entityType ?? null,entityId ?? null]);
}

export async function notifyUsers(userIds: string[], type: string, title: string, body: string, entityType?: string, entityId?: string) {
  const unique = [...new Set(userIds)];
  for (const userId of unique) await notifyUser(userId,type,title,body,entityType,entityId);
}

export async function notifyOrganization(organizationId: string, type: string, title: string, body: string, entityType?: string, entityId?: string) {
  const r = await pool.query(`SELECT id FROM users WHERE organization_id=$1 AND active=TRUE AND role IN ('ORGANIZATION_ADMIN','FACULTY','INDUSTRY_MEMBER')`, [organizationId]);
  await notifyUsers(r.rows.map((x:any)=>x.id), type, title, body, entityType, entityId);
}
