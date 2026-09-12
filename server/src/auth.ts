import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { pool } from "./db/pool.js";
import { config } from "./config.js";

export type UserRole =
  | "CITIZEN" | "STUDENT" | "FACULTY" | "ORGANIZATION_ADMIN"
  | "INDUSTRY_MEMBER" | "GOVERNMENT" | "SUPER_ADMIN";

export type AuthUser = {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  organization_id: string | null;
  preferred_language: string;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function createAccessToken(user: AuthUser) {
  return jwt.sign(
    { sub: user.id, role: user.role, organizationId: user.organization_id },
    config.jwtSecret,
    { expiresIn: `${config.accessTokenMinutes}m` }
  );
}

function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createRefreshToken(userId: string) {
  const raw = crypto.randomBytes(48).toString("hex");
  const tokenHash = hashToken(raw);
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 86400000);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return raw;
}

export async function rotateRefreshToken(raw: string) {
  const result = await pool.query(
    `SELECT rt.id, rt.user_id
     FROM refresh_tokens rt
     WHERE rt.token_hash = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()`,
    [hashToken(raw)]
  );

  if (!result.rowCount) return null;

  await pool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1",
    [result.rows[0].id]
  );

  return createRefreshToken(result.rows[0].user_id);
}

export async function revokeRefreshToken(raw: string) {
  await pool.query(
    "UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1",
    [hashToken(raw)]
  );
}
