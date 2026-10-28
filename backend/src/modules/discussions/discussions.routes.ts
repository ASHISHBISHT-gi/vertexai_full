import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth";
import { postLimiter } from "../../middleware/rateLimit";
import * as d from "./discussions.service";

const router = Router();
const uuid = z.string().uuid("id must be a valid UUID");
const empty = (v: unknown) => (v === "" ? undefined : v);
const paging = (max: number, def: number) => ({ page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(max).default(def) });

const threadBody = z.object({
  title: z.string().trim().min(3, "Give your question a short title (3+ characters)").max(200),
  content: z.string().trim().min(1, "Write something first").max(5000, "That's too long (5000 characters max)"),
});
const replyBody = z.object({
  content: z.string().trim().min(1, "Write something first").max(5000, "That's too long (5000 characters max)"),
  parent_id: uuid.optional(),
});

router.get("/courses/:id/threads", authenticate, async (req, res) => {
  const q = z.object({ q: z.preprocess(empty, z.string().trim().max(100).optional()), ...paging(50, 20) }).parse(req.query);
  res.json(await d.listThreads(uuid.parse(req.params.id), req.user!, q));
});
router.post("/courses/:id/threads", authenticate, postLimiter, async (req, res) => {
  res.status(201).json(await d.createThread(uuid.parse(req.params.id), req.user!, threadBody.parse(req.body)));
});
router.get("/threads/:id", authenticate, async (req, res) => res.json(await d.getThreadDetail(uuid.parse(req.params.id), req.user!)));
router.post("/threads/:id/posts", authenticate, postLimiter, async (req, res) => {
  res.status(201).json(await d.reply(uuid.parse(req.params.id), req.user!, replyBody.parse(req.body)));
});
router.put("/threads/:id/pin", authenticate, async (req, res) => {
  res.json(await d.setPinned(uuid.parse(req.params.id), req.user!, z.object({ pinned: z.boolean() }).parse(req.body).pinned));
});
router.delete("/threads/:id", authenticate, async (req, res) => {
  await d.deleteThread(uuid.parse(req.params.id), req.user!);
  res.status(204).end();
});

router.delete("/posts/:id", authenticate, async (req, res) => res.json(await d.deletePost(uuid.parse(req.params.id), req.user!)));
router.post("/posts/:id/report", authenticate, postLimiter, async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(300).optional() }).parse(req.body ?? {});
  res.status(201).json(await d.reportPost(uuid.parse(req.params.id), req.user!, reason));
});
router.put("/posts/:id/dismiss-reports", authenticate, async (req, res) => res.json(await d.dismissReports(uuid.parse(req.params.id), req.user!)));

// PRD 8.7: the admin's queue of reported posts. (Removing one is DELETE /posts/:id; keeping one is dismiss-reports.)
router.get("/admin/moderation/flagged-posts", authenticate, requireRole("admin"), async (req, res) => {
  res.json(await d.listFlagged(z.object(paging(50, 20)).parse(req.query)));
});

export default router;
