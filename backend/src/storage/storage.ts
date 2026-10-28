/**
 * All file access goes through here. Today it's the local disk; moving to S3/MinIO later
 * means rewriting THIS file, not the features that use it.
 * The database stores a *relative* path like "videos/<uuid>.mp4", never an absolute one.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "../config/env";

export const UPLOAD_ROOT = path.resolve(process.cwd(), env.UPLOAD_DIR);
export type StorageArea = "videos" | "submissions" | "certificates" | "resources" | "thumbnails";

export function ensureDir(area: StorageArea): string {
  const dir = path.join(UPLOAD_ROOT, area);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Relative path -> absolute path, refusing anything that escapes UPLOAD_ROOT (path traversal). */
export function absolutePath(relative: string): string {
  const abs = path.resolve(UPLOAD_ROOT, relative);
  if (!abs.startsWith(UPLOAD_ROOT + path.sep)) throw new Error("Invalid storage path");
  return abs;
}

export async function removeFile(relative?: string | null): Promise<void> {
  if (!relative) return;
  try {
    await fs.promises.unlink(absolutePath(relative));
  } catch {
    // already gone: fine
  }
}

/** Same idea for pictures. SVG is deliberately NOT allowed: it can carry scripts. */
export async function looksLikeImage(relative: string): Promise<boolean> {
  const handle = await fs.promises.open(absolutePath(relative), "r");
  try {
    const buf = Buffer.alloc(12);
    await handle.read(buf, 0, 12, 0);
    const png = buf[0] === 0x89 && buf.subarray(1, 4).toString("ascii") === "PNG";
    const jpg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    const webp = buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP";
    return png || jpg || webp;
  } finally {
    await handle.close();
  }
}

/** Reads the first bytes to check a file really is what its name claims. */
export async function looksLikeVideo(relative: string): Promise<boolean> {
  const handle = await fs.promises.open(absolutePath(relative), "r");
  try {
    const buf = Buffer.alloc(12);
    await handle.read(buf, 0, 12, 0);
    const isMp4 = buf.subarray(4, 8).toString("ascii") === "ftyp";
    const isWebm = buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3;
    return isMp4 || isWebm;
  } finally {
    await handle.close();
  }
}
