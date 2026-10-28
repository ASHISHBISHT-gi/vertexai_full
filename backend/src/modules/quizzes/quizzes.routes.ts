import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth";
import * as quizzes from "./quizzes.service";

const router = Router();
const uuid = z.string().uuid("id must be a valid UUID");

const option = z.object({ option_text: z.string().trim().min(1, "Options can't be empty").max(500), is_correct: z.boolean() });
const question = z
  .object({
    question_text: z.string().trim().min(3, "Write the question").max(2000),
    question_type: z.enum(["mcq", "multi_select", "short_answer"]),
    points: z.number().int().min(1).max(100).optional(),
    options: z.array(option).max(10).optional(),
    accepted_answers: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  })
  .superRefine((q, ctx) => {
    const options = q.options ?? [];
    const correct = options.filter((o) => o.is_correct).length;
    const fail = (message: string) => ctx.addIssue({ code: "custom", message, path: ["options"] });
    if (q.question_type === "mcq") {
      if (options.length < 2) fail("A multiple-choice question needs at least 2 options");
      else if (correct !== 1) fail("A multiple-choice question needs exactly 1 correct option");
    } else if (q.question_type === "multi_select") {
      if (options.length < 2) fail("A multi-select question needs at least 2 options");
      else if (correct < 1) fail("Mark at least 1 correct option");
    } else if (options.length > 0) fail("Short-answer questions don't have options");
  });

const createBody = z.object({
  module_id: uuid,
  title: z.string().trim().min(3, "title must be at least 3 characters").max(200),
  questions: z.array(question).min(1, "Add at least one question").max(50),
  is_ai_generated: z.boolean().optional(),
  generated_from_lecture_id: uuid.optional(),
});
const updateBody = z.object({ title: z.string().trim().min(3).max(200).optional(), is_published: z.boolean().optional() });
const submitBody = z.object({
  answers: z.array(z.object({
    question_id: uuid,
    selected_option_ids: z.array(uuid).max(10).optional(),
    text_answer: z.string().max(2000).optional(),
  })).max(100),
});

router.get("/courses/:id/quizzes", authenticate, async (req, res) => {
  res.json(await quizzes.listCourseQuizzes(uuid.parse(req.params.id), req.user!));
});
router.post("/quizzes", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.status(201).json(await quizzes.createQuiz(req.user!, createBody.parse(req.body)));
});
router.get("/quizzes/:id", authenticate, async (req, res) => {
  res.json(await quizzes.getQuiz(uuid.parse(req.params.id), req.user!));
});
router.put("/quizzes/:id", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  res.json(await quizzes.updateQuiz(uuid.parse(req.params.id), req.user!, updateBody.parse(req.body)));
});
router.delete("/quizzes/:id", authenticate, requireRole("instructor", "admin"), async (req, res) => {
  await quizzes.deleteQuiz(uuid.parse(req.params.id), req.user!);
  res.status(204).end();
});
router.post("/quizzes/:id/attempt", authenticate, requireRole("student"), async (req, res) => {
  res.status(201).json(await quizzes.startAttempt(uuid.parse(req.params.id), req.user!));
});
router.post("/attempts/:id/submit", authenticate, requireRole("student"), async (req, res) => {
  res.json(await quizzes.submitAttempt(uuid.parse(req.params.id), req.user!, submitBody.parse(req.body).answers));
});

export default router;
