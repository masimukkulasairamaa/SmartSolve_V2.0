import express from "express";
import cors from "cors";
import helmet from "helmet";
import { config } from "./config.js";
import { pool } from "./db/pool.js";
import { requestId, rateLimit } from "./security.js";
import { healthRouter } from "./routes/health.js";
import { authRouter } from "./routes/auth.js";
import { challengesRouter } from "./routes/challenges.js";
import { collaborationRouter } from "./routes/collaboration.js";
import { lifecycleRouter } from "./routes/lifecycle.js";
import { communicationRouter } from "./routes/communication.js";
import { sosRouter } from "./routes/sos.js";
import { governmentRouter } from "./routes/government.js";

const app = express();
app.disable("x-powered-by");
if (config.trustProxy) app.set("trust proxy", 1);
app.use(requestId);
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors({
  origin(origin, callback) {
    if (!origin || config.clientOrigins.includes(origin)) return callback(null, true);
    return callback(new Error("Origin not allowed"));
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  maxAge: 86400
}));
app.use(express.json({ limit: config.maxJsonBytes }));
app.use(express.urlencoded({ extended: false, limit: "1mb" }));

const generalLimit = rateLimit({ windowMs: 60_000, max: 180 });
const authLimit = rateLimit({ windowMs: 15 * 60_000, max: 30, message: "Too many authentication attempts. Please wait and try again." });
app.use("/api", generalLimit);
app.use("/api/auth/login", authLimit);
app.use("/api/auth/signup", authLimit);
app.use("/api/auth/refresh", authLimit);

app.get("/", (_req, res) => res.json({ name: "Jharkhand Innovation Platform API", version: "1.0.0", status: "running" }));
app.use("/api/health", healthRouter);
app.use("/api/auth", authRouter);
app.use("/api/challenges", challengesRouter);
app.use("/api/collaboration", collaborationRouter);
app.use("/api/lifecycle", lifecycleRouter);
app.use("/api/communication", communicationRouter);
app.use("/api/sos", sosRouter);
app.use("/api/government", governmentRouter);

app.use((_req, res) => res.status(404).json({ error: "Route not found" }));
app.use((error: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const uploadCode = error instanceof Error && "code" in error ? String((error as { code?: unknown }).code) : "";
  if (["LIMIT_FILE_SIZE", "LIMIT_FILE_COUNT", "LIMIT_UNEXPECTED_FILE"].includes(uploadCode)) {
    const message = uploadCode === "LIMIT_FILE_SIZE" ? "Uploaded file is too large." : uploadCode === "LIMIT_FILE_COUNT" ? "Too many files." : "Upload could not be processed.";
    return res.status(400).json({ error: message, requestId: res.locals.requestId });
  }
  if (error instanceof Error && error.message === "Origin not allowed") {
    return res.status(403).json({ error: "Origin not allowed", requestId: res.locals.requestId });
  }
  console.error(`[${res.locals.requestId ?? "no-request-id"}]`, error, { method: req.method, path: req.path });
  return res.status(500).json({ error: "Internal server error", requestId: res.locals.requestId });
});

const server = app.listen(config.port, () => console.log(`API listening on port ${config.port}`));

async function shutdown(signal: string) {
  console.log(`${signal} received; shutting down gracefully.`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
