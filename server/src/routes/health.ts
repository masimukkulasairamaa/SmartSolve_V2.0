import { Router } from "express";
import { pool } from "../db/pool.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "jharkhand-innovation-platform-api", phase: 10, status: "healthy", database: "connected", timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ ok: false, service: "jharkhand-innovation-platform-api", phase: 10, status: "unhealthy", database: "unavailable", timestamp: new Date().toISOString() });
  }
});

healthRouter.get("/ready", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ready: true, timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ ready: false, timestamp: new Date().toISOString() });
  }
});
