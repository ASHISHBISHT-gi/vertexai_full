/** Lecture materials (PDFs, slides...) and course thumbnails: both are "an instructor uploads a file" features. */
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../../db/pool";
import { authenticate, requireRole } from "../../middleware/auth";
import { imageUpload, resourceUpload } from "../../middleware/upload";
import { absolutePath, looksLikeImage, removeFile } from "../../storage/storage";
import { AppError, forbidden, notFound } from "../../utils/errors";
import { invalidateCatalog } from "../courses/courses.service";
import { assertCanManage, canManage, getEnrollment, getLectureContext } from "../shared/access";

const router = Router();
const uuid = z.string().uuid("id must be a valid UUID");
const staff = [authenticate, requireRole("instructor", "admin")] as const;

async function courseOwner(courseId: string) {
  const { rows } = await pool.query<{ instructor_id: string; thumbnail_path: string | null; status: string }>("SELECT instructor_id, thumbnail_path, status FROM courses WHERE id = $1", [courseId]);
  if (!rows[0]) throw notFound("Course");
  return rows[0];
}

// ---------------------------------------------------------------- lecture materials
router.get("/lectures/:id/resources", authenticate, async (req, res) => {
  const lec = await getLectureContext(uuid.parse(req.params.id));
  if (!canManage(req.user, lec.instructor_id) && !(await getEnrollment(pool, req.user!.id, lec.course_id))) throw forbidden("Enroll in this course first");
  const { rows } = await pool.query("SELECT id, original_name, file_size, created_at FROM lecture_resources WHERE lecture_id = $1 ORDER BY created_at", [lec.id]);
  res.json(rows);
});

router.post(
  "/lectures/:id/resources",
  ...staff,
  async (req, _res, next) => { // ownership BEFORE we accept the file
    assertCanManage((await getLectureContext(uuid.parse(req.params.id))).instructor_id, req.user!);
    next();
  },
  resourceUpload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError(400, "VALIDATION_ERROR", "Choose a file to upload", "file");
    try {
      const { rows } = await pool.query(
        "INSERT INTO lecture_resources (lecture_id, file_path, original_name, file_size) VALUES ($1, $2, $3, $4) RETURNING id, original_name, file_size, created_at",
        [uuid.parse(req.params.id), `resources/${file.filename}`, path.basename(file.originalname).slice(0, 200), file.size],
      );
      res.status(201).json(rows[0]);
    } catch (err) {
      await removeFile(`resources/${file.filename}`);
      throw err;
    }
  },
);

async function resourceContext(id: string) {
  const { rows } = await pool.query<{ id: string; file_path: string; original_name: string; lecture_id: string }>("SELECT id, file_path, original_name, lecture_id FROM lecture_resources WHERE id = $1", [id]);
  if (!rows[0]) throw notFound("File");
  return { resource: rows[0], lecture: await getLectureContext(rows[0].lecture_id) };
}

router.get("/resources/:id/file", authenticate, async (req, res) => {
  const { resource, lecture } = await resourceContext(uuid.parse(req.params.id));
  if (!canManage(req.user, lecture.instructor_id) && !(await getEnrollment(pool, req.user!.id, lecture.course_id))) throw forbidden("Enroll in this course first");
  res.download(absolutePath(resource.file_path), resource.original_name); // "download" = the browser saves it, never runs it
});

router.delete("/resources/:id", ...staff, async (req, res) => {
  const { resource, lecture } = await resourceContext(uuid.parse(req.params.id));
  assertCanManage(lecture.instructor_id, req.user!);
  await pool.query("DELETE FROM lecture_resources WHERE id = $1", [resource.id]);
  await removeFile(resource.file_path);
  res.status(204).end();
});

// ---------------------------------------------------------------- thumbnails
router.post(
  "/courses/:id/thumbnail",
  ...staff,
  async (req, _res, next) => {
    assertCanManage((await courseOwner(uuid.parse(req.params.id))).instructor_id, req.user!);
    next();
  },
  imageUpload.single("image"),
  async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError(400, "VALIDATION_ERROR", "Choose an image to upload", "image");
    const relative = `thumbnails/${file.filename}`;
    try {
      if (!(await looksLikeImage(relative))) throw new AppError(400, "INVALID_FILE", "That isn't a valid PNG, JPEG or WebP image", "image");
      const courseId = uuid.parse(req.params.id);
      const old = (await courseOwner(courseId)).thumbnail_path;
      // The ?v= makes browsers fetch the new picture instead of showing the cached old one.
      const { rows } = await pool.query(
        "UPDATE courses SET thumbnail_path = $2, thumbnail_url = $3, updated_at = now() WHERE id = $1 RETURNING id, thumbnail_url",
        [courseId, relative, `/api/v1/courses/${courseId}/thumbnail?v=${Date.now()}`],
      );
      await removeFile(old);
      invalidateCatalog();
      res.json(rows[0]);
    } catch (err) {
      await removeFile(relative);
      throw err;
    }
  },
);

// Public on purpose: course cards on the catalog are shown to people who aren't logged in.
router.get("/courses/:id/thumbnail", async (req, res) => {
  const course = await courseOwner(uuid.parse(req.params.id));
  if (!course.thumbnail_path) throw notFound("Thumbnail");
  res.sendFile(absolutePath(course.thumbnail_path), { dotfiles: "allow", headers: { "Cache-Control": "public, max-age=3600" } });
});

export default router;
