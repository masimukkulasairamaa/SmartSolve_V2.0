import { pool } from "./db/pool.js";

export async function audit(actorId: string | null, action: string, entityType: string | null, entityId: string | null, metadata: unknown = {}) {
  try {
    await pool.query(
      `INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5::jsonb)`,
      [actorId, action, entityType, entityId, JSON.stringify(metadata)]
    );
  } catch (error) {
    // Auditing must never take down a business transaction.
    console.error("Audit log failed", error);
  }
}
