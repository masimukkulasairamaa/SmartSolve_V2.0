import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";

export function requestId(req: Request, res: Response, next: NextFunction) {
  const incoming = req.header("x-request-id");
  const id = incoming && /^[A-Za-z0-9._:-]{1,100}$/.test(incoming) ? incoming : crypto.randomUUID();
  res.setHeader("X-Request-Id", id);
  res.locals.requestId = id;
  next();
}

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
let lastCleanup = Date.now();

export function rateLimit(options: { windowMs: number; max: number; key?: (req: Request) => string; message?: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - lastCleanup > options.windowMs) {
      for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
      lastCleanup = now;
    }
    const key = options.key?.(req) ?? req.ip ?? "unknown";
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
      return res.status(429).json({ error: options.message ?? "Too many requests. Please try again later." });
    }
    next();
  };
}
