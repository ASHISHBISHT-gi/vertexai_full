import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth";
import { submissionUpload } from "../../middleware/upload";
import { removeFile } from "../../storage/storage";
import { AppError } from "../../utils/errors";
import * as assignments from "./assignments.service";

const router = Router();
const uuid = z.string().uuid("id must be a valid UUID");

const createBody = z.object({
  course_id: uuid,
  title: z.string().trim().min(3, "title must be at least 3 characters").max(200),
  instructions: z.string().trim().max(10_000).optional(),
  rubric: z.array(z.object({ criterion: z.string().trim().min(1).max(200), points: z.number().min(0).max(1000) })).max(20).optional(),
  due_date: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "due_date must be a valid date").optional(),
  max_points: z.number().int().min(1).max(1000).optional(),
});
const gradeBody = z.object({ grade: z.number().min(0), feedback: z.string().trim().max(5000).optional() });

router.post("/assignments", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.status(201).json(await assignments.createAssignment(req.user!, createBody.parse(req.body)));
});

router.delete("/assignments/:id", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  await assignments.deleteAssignment(uuid.parse(req.params.id), req.user!);
  res.status(204).end();
});

router.get("/courses/:id/assignments", authenticate, async (req, res) => {
  res.json(await assignments.listCourseAssignments(uuid.parse(req.params.id), req.user!));
});

router.post(
  "/assignments/:id/submit",
  authenticate,
  requireRole("student"),
  async (req, _res, next) => {
    await assignments.assertCanSubmit(uuid.parse(req.params.id), req.user!); // before we accept any bytes
    next();
  },
  submissionUpload.single("file"),
  async (req, res) => {
    const file = req.file;
    if (!file) throw new AppError(400, "VALIDATION_ERROR", "Choose a file to submit", "file");
    const relative = `submissions/${file.filename}`;
    try {
      res.status(201).json(await assignments.submit(uuid.parse(req.params.id), req.user!, { relative, original_name: file.originalname, size: file.size }));
    } catch (err) {
      await removeFile(relative);
      throw err;
    }
  },
);

router.get("/assignments/:id/submissions", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.json(await assignments.listSubmissions(uuid.parse(req.params.id), req.user!));
});

router.get("/submissions/:id/file", authenticate, async (req, res) => {
  const file = await assignments.getSubmissionFile(uuid.parse(req.params.id), req.user!);
  res.download(file.path, file.downloadName);
});

router.put("/submissions/:id/grade", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.json(await assignments.gradeSubmission(uuid.parse(req.params.id), req.user!, gradeBody.parse(req.body)));
});

export default router;
