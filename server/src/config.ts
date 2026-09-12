import "dotenv/config";

function numberEnv(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) throw new Error(`${name} must be a number between ${min} and ${max}`);
  return value;
}

const nodeEnv = process.env.NODE_ENV || "development";
const clientOrigins = (process.env.CLIENT_URL || "http://localhost:5173")
  .split(",").map((v) => v.trim()).filter(Boolean);

export const config = {
  port: numberEnv("PORT", 5000, 1, 65535),
  databaseUrl: process.env.DATABASE_URL || "",
  clientOrigins,
  jwtSecret: process.env.JWT_SECRET || "development-only-change-me",
  accessTokenMinutes: numberEnv("ACCESS_TOKEN_MINUTES", 30, 5, 120),
  refreshTokenDays: numberEnv("REFRESH_TOKEN_DAYS", 30, 1, 180),
  nodeEnv,
  aiApiKey: process.env.AI_API_KEY || "",
  aiBaseUrl: process.env.AI_BASE_URL || "",
  aiModel: process.env.AI_MODEL || "",
  uploadDir: process.env.UPLOAD_DIR || "",
  storageProvider: (process.env.STORAGE_PROVIDER || "local").toLowerCase(),
  s3Endpoint: process.env.S3_ENDPOINT || "",
  s3Region: process.env.S3_REGION || "auto",
  s3Bucket: process.env.S3_BUCKET || "",
  s3AccessKey: process.env.S3_ACCESS_KEY || "",
  s3SecretKey: process.env.S3_SECRET_KEY || "",
  translationApiKey: process.env.TRANSLATION_API_KEY || "",
  translationBaseUrl: process.env.TRANSLATION_BASE_URL || "",
  translationModel: process.env.TRANSLATION_MODEL || "",
  sosRadiusKm: numberEnv("SOS_RADIUS_KM", 50, 1, 500),
  maxJsonBytes: numberEnv("MAX_JSON_BYTES", 2, 1, 10) * 1024 * 1024,
  trustProxy: process.env.TRUST_PROXY === "true"
};

if (!config.databaseUrl) console.warn("DATABASE_URL is not set.");
if (config.nodeEnv === "production") {
  if (!config.databaseUrl) throw new Error("DATABASE_URL is required in production.");
  if (config.jwtSecret.length < 32 || config.jwtSecret === "development-only-change-me") {
    throw new Error("JWT_SECRET must be a strong secret of at least 32 characters in production.");
  }
  if (!config.clientOrigins.length) throw new Error("CLIENT_URL must contain at least one allowed origin in production.");
  if (!['local', 's3'].includes(config.storageProvider)) throw new Error("STORAGE_PROVIDER must be local or s3.");
  if (config.storageProvider === "s3" && (!config.s3Bucket || !config.s3AccessKey || !config.s3SecretKey)) {
    throw new Error("S3_BUCKET, S3_ACCESS_KEY and S3_SECRET_KEY are required when STORAGE_PROVIDER=s3.");
  }
}
