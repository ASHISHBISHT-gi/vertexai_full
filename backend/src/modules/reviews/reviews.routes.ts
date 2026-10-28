import { Router } from "express";
import { z } from "zod";
import { authenticate, optionalAuth, requireRole } from "../../middleware/auth";
import * as reviews from "./reviews.service";

const router = Router();
const uuid = z.string().uuid("id must be a valid UUID");
const body = z.object({ rating: z.number().int().min(1, "Choose 1 to 5 stars").max(5, "Choose 1 to 5 stars"), comment: z.string().trim().max(2000).optional() });

router.get("/courses/:id/reviews", optionalAuth, async (req, res) => {
  const q = z.object({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(50).default(10) }).parse(req.query);
  res.json(await reviews.listReviews(uuid.parse(req.params.id), req.user, q.page, q.limit));
});
router.put("/courses/:id/reviews", authenticate, requireRole("student"), async (req, res) => {
  res.json(await reviews.saveReview(uuid.parse(req.params.id), req.user!, body.parse(req.body)));
});
router.delete("/reviews/:id", authenticate, async (req, res) => {
  await reviews.deleteReview(uuid.parse(req.params.id), req.user!);
  res.status(204).end();
});

export default router;
