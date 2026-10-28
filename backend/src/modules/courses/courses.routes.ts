import { Router } from "express";
import { z } from "zod";
import path from "node:path";
import { authenticate, optionalAuth, requireRole } from "../../middleware/auth";
import { videoUpload } from "../../middleware/upload";
import { looksLikeVideo, removeFile } from "../../storage/storage";
import { AppError } from "../../utils/errors";
import * as courses from "./courses.service";

const router = Router();

const uuid = z.string().uuid("id must be a valid UUID");
const difficulty = z.enum(["beginner", "intermediate", "advanced"]);
// "?category=" (empty string) should mean "no filter", not an error.
const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const catalogQuery = z.object({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  category: z.preprocess(emptyToUndefined, z.string().trim().max(80).optional()),
  difficulty: z.preprocess(emptyToUndefined, difficulty.optional()),
  min_rating: z.preprocess(emptyToUndefined, z.coerce.number().min(1).max(5).optional()),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(12),
});

// No .default() on price here: PATCH-style updates reuse this schema via .partial().
const courseBody = z.object({
  title: z.string().trim().min(3, "title must be at least 3 characters").max(200),
  description: z.string().trim().max(5000).optional(),
  category: z.string().trim().min(1).max(80).optional(),
  difficulty: difficulty.optional(),
  thumbnail_url: z.string().url("thumbnail_url must be a valid URL").optional(),
  price: z.number().min(0).max(1_000_000).optional(),
});
const updateBody = courseBody
  .partial()
  .refine((o) => Object.values(o).some((v) => v !== undefined), "Provide at least one field to update");

const moduleBody = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
  order_index: z.number().int().min(0).optional(),
});
const lectureBody = z.object({
  title: z.string().trim().min(1, "title is required").max(200),
  video_url: z.string().url("video_url must be a valid URL").optional(),
  transcript: z.string().max(500_000).optional(),
  duration_seconds: z.number().int().min(0).optional(),
  resource_urls: z.array(z.string().url()).max(20).optional(),
  order_index: z.number().int().min(0).optional(),
});
const decisionBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  comment: z.string().trim().max(1000).optional(),
});

// Public catalog (only approved courses)
router.get("/courses", async (req, res) => {
  res.json(await courses.listCatalog(catalogQuery.parse(req.query)));
});

router.get("/courses/:id", optionalAuth, async (req, res) => {
  res.json(await courses.getCourseDetail(uuid.parse(req.params.id), req.user));
});

// Instructor
router.get("/instructor/courses", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.json(await courses.listInstructorCourses(req.user!.id));
});

router.post("/courses", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.status(201).json(await courses.createCourse(req.user!.id, courseBody.parse(req.body)));
});

router.put("/courses/:id", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.json(await courses.updateCourse(uuid.parse(req.params.id), req.user!, updateBody.parse(req.body)));
});

router.post("/courses/:id/modules", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.status(201).json(await courses.addModule(uuid.parse(req.params.id), req.user!, moduleBody.parse(req.body)));
});

router.post("/modules/:id/lectures", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.status(201).json(await courses.addLecture(uuid.parse(req.params.id), req.user!, lectureBody.parse(req.body)));
});

// Video upload. Order matters: log in -> role -> "is this MY lecture?" -> only then accept the file.
router.post(
  "/lectures/:id/video",
  authenticate,
  requireRole("instructor", "admin"),
  async (req, _res, next) => {
    await courses.assertLectureOwner(uuid.parse(req.params.id), req.user!);
    next();
  },
  videoUpload.single("video"),
  async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError(400, "VALIDATION_ERROR", "Choose a video file to upload", "video");
    const relative = `videos/${file.filename}`;
    try {
      // The extension was checked by multer; this checks the file's actual first bytes.
      if (!(await looksLikeVideo(relative))) throw new AppError(400, "INVALID_FILE", "That file isn't a valid MP4 or WebM video", "video");
      const duration = z.coerce.number().int().min(0).max(86_400).optional().parse(req.body?.duration_seconds || undefined);
      const mime = path.extname(file.filename) === ".webm" ? "video/webm" : "video/mp4";
      res.json(await courses.attachVideo(uuid.parse(req.params.id), req.user!, { relative, mime }, duration));
    } catch (err) {
      await removeFile(relative); // don't leave orphaned files behind when something fails
      throw err;
    }
  },
);

router.get("/lectures/:id/transcript", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.json(await courses.getTranscript(uuid.parse(req.params.id), req.user!));
});
router.put("/lectures/:id/transcript", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  const { transcript } = z.object({ transcript: z.string().max(500_000, "That transcript is too long") }).parse(req.body);
  res.json(await courses.saveTranscript(uuid.parse(req.params.id), req.user!, transcript));
});

router.delete("/lectures/:id", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  await courses.deleteLecture(uuid.parse(req.params.id), req.user!);
  res.status(204).end();
});
router.delete("/modules/:id", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  await courses.deleteModule(uuid.parse(req.params.id), req.user!);
  res.status(204).end();
});

// Admin
router.post("/courses/:id/approve", authenticate, requireRole("admin"), async (req, res) => {
  res.json(await courses.decideCourse(uuid.parse(req.params.id), req.user!.id, decisionBody.parse(req.body)));
});

export default router;
