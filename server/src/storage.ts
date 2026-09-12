import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Express } from "express";
import { config } from "./config.js";

let s3: any = null;
let PutObjectCommand: any = null;
if (config.storageProvider === "s3") {
  // Loaded only when S3 storage is enabled.
  const mod = await import("@aws-sdk/client-s3");
  s3 = new mod.S3Client({
    region: config.s3Region,
    endpoint: config.s3Endpoint || undefined,
    forcePathStyle: Boolean(config.s3Endpoint),
    credentials: { accessKeyId: config.s3AccessKey, secretAccessKey: config.s3SecretKey }
  });
  PutObjectCommand = mod.PutObjectCommand;
}

const localDir = path.resolve(config.uploadDir || path.resolve(process.cwd(), "../uploads"));
if (config.storageProvider === "local") await fs.mkdir(localDir, { recursive: true });

function safeName(original: string) {
  const base = path.basename(original).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 140);
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID()}-${base || "upload"}`;
}

export async function persistUploadedFile(file: Express.Multer.File) {
  const key = safeName(file.originalname);
  if (config.storageProvider === "s3") {
    await s3.send(new PutObjectCommand({ Bucket: config.s3Bucket, Key: key, Body: file.buffer, ContentType: file.mimetype, ContentLength: file.size }));
    return `s3://${config.s3Bucket}/${key}`;
  }
  const target = path.join(localDir, key);
  await fs.writeFile(target, file.buffer, { flag: "wx" });
  return target;
}
