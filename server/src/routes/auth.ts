import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/pool.js";
import {
  hashPassword, verifyPassword, createAccessToken, createRefreshToken,
  rotateRefreshToken, revokeRefreshToken, type AuthUser
} from "../auth.js";
import { requireAuth } from "../middleware.js";
import { audit } from "../audit.js";

export const authRouter = Router();

const signupSchema = z.object({
  fullName: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(180),
  password: z.string().min(8).max(128),
  role: z.enum(["CITIZEN", "STUDENT", "FACULTY", "ORGANIZATION_ADMIN", "INDUSTRY_MEMBER"]).default("CITIZEN"),
  organizationId: z.string().uuid().nullable().optional(),
  phone: z.string().trim().max(25).optional(),
  preferredLanguage: z.string().trim().max(20).default("en")
});

function publicUser(row: any): AuthUser {
  return {
    id: row.id,
    full_name: row.full_name,
    email: row.email,
    role: row.role,
    organization_id: row.organization_id,
    preferred_language: row.preferred_language
  };
}

async function issueSession(user: AuthUser) {
  return {
    accessToken: createAccessToken(user),
    refreshToken: await createRefreshToken(user.id),
    user
  };
}

authRouter.post("/signup", async (req, res) => {
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid signup data", details: parsed.error.flatten() });

  const data = parsed.data;
  const exists = await pool.query("SELECT 1 FROM users WHERE email = $1", [data.email]);
  if (exists.rowCount) return res.status(409).json({ error: "An account with this email already exists" });

  if (data.role === "ORGANIZATION_ADMIN") {
    return res.status(403).json({ error: "Organization administrator accounts are provisioned by an authorized organization or government administrator." });
  }

  if (["STUDENT", "FACULTY", "INDUSTRY_MEMBER"].includes(data.role) && !data.organizationId) {
    return res.status(400).json({ error: "An organization is required for this account type." });
  }

  if (data.organizationId) {
    const org = await pool.query("SELECT id, active FROM organizations WHERE id = $1", [data.organizationId]);
    if (!org.rowCount || !org.rows[0].active) {
      return res.status(400).json({ error: "Selected organization is unavailable" });
    }
  }

  const passwordHash = await hashPassword(data.password);
  const result = await pool.query(
    `INSERT INTO users
      (full_name, email, password_hash, role, organization_id, phone, preferred_language)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, full_name, email, role, organization_id, preferred_language`,
    [data.fullName, data.email, passwordHash, data.role, data.organizationId ?? null, data.phone ?? null, data.preferredLanguage]
  );

  const session = await issueSession(publicUser(result.rows[0]));
  await audit(result.rows[0].id, "ACCOUNT_CREATED", "USER", result.rows[0].id, { role: result.rows[0].role });
  res.status(201).json(session);
});

authRouter.post("/login", async (req, res) => {
  const parsed = z.object({
    email: z.string().trim().toLowerCase().email(),
    password: z.string().min(1)
  }).safeParse(req.body);

  if (!parsed.success) return res.status(400).json({ error: "Email and password are required" });

  const result = await pool.query(
    `SELECT id, full_name, email, password_hash, role, organization_id, preferred_language, active
     FROM users WHERE email = $1`,
    [parsed.data.email]
  );

  if (!result.rowCount || !result.rows[0].active) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const row = result.rows[0];
  if (!(await verifyPassword(parsed.data.password, row.password_hash))) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const session = await issueSession(publicUser(row));
  await audit(row.id, "LOGIN_SUCCESS", "USER", row.id);
  res.json(session);
});

authRouter.post("/refresh", async (req, res) => {
  const token = z.string().min(20).safeParse(req.body?.refreshToken);
  if (!token.success) return res.status(400).json({ error: "Refresh token required" });

  const crypto = await import("node:crypto");
  const tokenHash = crypto.createHash("sha256").update(token.data).digest("hex");
  const owner = await pool.query(
    `SELECT u.id, u.full_name, u.email, u.role, u.organization_id, u.preferred_language
     FROM users u JOIN refresh_tokens rt ON rt.user_id = u.id
     WHERE rt.token_hash = $1`,
    [tokenHash]
  );
  const newRefresh = await rotateRefreshToken(token.data);
  if (!newRefresh || !owner.rowCount) return res.status(401).json({ error: "Invalid or expired refresh token" });

  const user = publicUser(owner.rows[0]);
  res.json({
    accessToken: createAccessToken(user),
    refreshToken: newRefresh,
    user
  });
});

authRouter.post("/logout", async (req, res) => {
  const token = z.string().min(20).safeParse(req.body?.refreshToken);
  if (token.success) await revokeRefreshToken(token.data);
  res.json({ ok: true });
});

authRouter.get("/me", requireAuth, async (req, res) => {
  const result = await pool.query(
    `SELECT id, full_name, email, role, organization_id, preferred_language, phone
     FROM users WHERE id = $1 AND active = TRUE`,
    [req.auth!.userId]
  );
  if (!result.rowCount) return res.status(404).json({ error: "User not found" });
  res.json({ user: result.rows[0] });
});
