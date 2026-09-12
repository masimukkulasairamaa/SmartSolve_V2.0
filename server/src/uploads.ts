import multer from "multer";

const allowed = new Set([
  "image/jpeg", "image/png", "image/webp",
  "video/mp4", "video/webm",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

function fileFilter(_req: Express.Request, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  cb(null, allowed.has(file.mimetype));
}

export const challengeUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 8, fileSize: 25 * 1024 * 1024 },
  fileFilter
});

export const lifecycleUpload = multer({
  storage: multer.memoryStorage(),
  limits: { files: 1, fileSize: 25 * 1024 * 1024 },
  fileFilter
});
