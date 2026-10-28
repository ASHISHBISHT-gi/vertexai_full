import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import * as n from "./notifications.service";

const router = Router();
const query = z.object({
  unread: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

router.get("/notifications", authenticate, async (req, res) => {
  const q = query.parse(req.query);
  res.json(await n.listNotifications(req.user!.id, { unreadOnly: q.unread === "true", page: q.page, limit: q.limit }));
});
router.get("/notifications/unread-count", authenticate, async (req, res) => res.json({ unread: await n.unreadCount(req.user!.id) }));
router.get("/notifications/preferences", authenticate, async (req, res) => res.json(await n.getPreferences(req.user!.id)));
router.put("/notifications/preferences", authenticate, async (req, res) => {
  res.json(await n.setPreferences(req.user!.id, z.object({ email_notifications: z.boolean() }).parse(req.body)));
});
router.put("/notifications/read-all", authenticate, async (req, res) => res.json(await n.markAllRead(req.user!.id)));
router.put("/notifications/:id/read", authenticate, async (req, res) => {
  res.json(await n.markRead(z.string().uuid().parse(req.params.id), req.user!.id));
});

export default router;
