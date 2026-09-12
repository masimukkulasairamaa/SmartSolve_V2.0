import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "./pool.js";

const candidates = [path.resolve(process.cwd(), "database"), path.resolve(process.cwd(), "../database")];
let databaseDir = candidates[0];
for (const candidate of candidates) {
  try { await fs.access(candidate); databaseDir = candidate; break; } catch {}
}

try {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const entries = (await fs.readdir(databaseDir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  const applied = new Set((await pool.query("SELECT filename FROM schema_migrations ORDER BY filename")).rows.map((r) => r.filename));

  for (const name of entries) {
    if (applied.has(name)) {
      console.log(`Skipping ${name} (already applied)`);
      continue;
    }
    const sql = await fs.readFile(path.join(databaseDir, name), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(filename) VALUES($1)", [name]);
      await client.query("COMMIT");
      console.log(`Applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Migration ${name} failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      client.release();
    }
  }
  console.log(`Database migration complete (${entries.length} files).`);
} catch (error) {
  console.error("Migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
