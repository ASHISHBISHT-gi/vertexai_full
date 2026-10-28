import { Router } from "express";
import { authenticate, requireRole } from "../../middleware/auth";
import { recommendForUser } from "./recommendations.service";

const router = Router();
router.get("/recommendations/me", authenticate, requireRole("student"), async (req, res) => {
  res.json(await recommendForUser(req.user!.id));
});
export default router;
