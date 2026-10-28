import { Router } from "express";
import { authenticate } from "../../middleware/auth";
import * as game from "./gamification.service";
import { leaderboard } from "./leaderboard.service";
import { z } from "zod";

const router = Router();
router.get("/users/me/badges", authenticate, async (req, res) => res.json(await game.getBadges(req.user!.id)));
router.get("/users/me/streak", authenticate, async (req, res) => res.json(await game.getStreak(req.user!.id)));
router.get("/leaderboard/:courseId", authenticate, async (req, res) => {
  res.json(await leaderboard(z.string().uuid("id must be a valid UUID").parse(req.params.courseId), req.user!));
});
export default router;
