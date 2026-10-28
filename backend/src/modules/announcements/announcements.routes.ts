import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import { postLimiter } from "../../middleware/rateLimit";
import * as a from "./announcements.service";

const router = Router();
const uuid = z.string().uuid("id must be a valid UUID");
const body = z.object({
  title: z.string().trim().min(3, "Give the announcement a title (3+ characters)").max(150),
  content: z.string().trim().min(1, "Write the announcement first").max(5000),
});

router.get("/courses/:id/announcements", authenticate, async (req, res) => {
  const q = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.query);
  res.json(await a.list(uuid.parse(req.params.id), req.user!, q.page, q.limit));
});
router.post("/courses/:id/announcements", authenticate, postLimiter, async (req, res) => {
  res.status(201).json(await a.create(uuid.parse(req.params.id), req.user!, body.parse(req.body)));
});
router.delete("/announcements/:id", authenticate, async (req, res) => {
  await a.remove(uuid.parse(req.params.id), req.user!);
  res.status(204).end();
});

export default router;
