import crypto from "node:crypto";
import path from "node:path";
import multer from "multer";
import { env } from "../config/env";
import { ensureDir, type StorageArea } from "../storage/storage";
import { AppError } from "../utils/errors";

function makeUpload(area: StorageArea, maxMb: number, allowed: Set<string>) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, ensureDir(area)),
      // We never use the client's filename on disk: random name + an extension from the allow-list.
      filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: maxMb * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (!allowed.has(ext)) {
        return cb(new AppError(400, "INVALID_FILE", `Files of type "${ext || "unknown"}" are not allowed`, "file"));
      }
      cb(null, true);
    },
  });
}

export const VIDEO_EXTENSIONS = new Set([".mp4", ".webm"]);
export const SUBMISSION_EXTENSIONS = new Set([
  ".pdf", ".zip", ".txt", ".md", ".py", ".js", ".ts", ".java", ".c", ".cpp", ".h", ".sql", ".json", ".html", ".css", ".ipynb",
]);

export const RESOURCE_EXTENSIONS = new Set([".pdf", ".pptx", ".ppt", ".docx", ".doc", ".xlsx", ".zip", ".txt", ".md", ".png", ".jpg", ".jpeg"]);
export const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

export const videoUpload = makeUpload("videos", env.MAX_VIDEO_MB, VIDEO_EXTENSIONS);
export const submissionUpload = makeUpload("submissions", env.MAX_SUBMISSION_MB, SUBMISSION_EXTENSIONS);
export const resourceUpload = makeUpload("resources", 25, RESOURCE_EXTENSIONS);
export const imageUpload = makeUpload("thumbnails", 2, IMAGE_EXTENSIONS);
