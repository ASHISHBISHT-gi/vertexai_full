import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRole } from "../../middleware/auth";
import * as admin from "./admin.service";

const router = Router();
// Everything under /admin needs a signed-in admin. One line instead of repeating it on every route.
router.use("/admin", authenticate, requireRole("admin"));

const uuid = z.string().uuid("id must be a valid UUID");
const empty = (v: unknown) => (v === "" ? undefined : v);
const paging = { page: z.coerce.number().int().min(1).default(1), limit: z.coerce.number().int().min(1).max(100).default(20) };

const usersQuery = z.object({
  q: z.preprocess(empty, z.string().trim().max(100).optional()),
  role: z.preprocess(empty, z.enum(["student", "instructor", "admin"]).optional()),
  status: z.preprocess(empty, z.enum(["active", "suspended"]).optional()),
  ...paging,
});
const coursesQuery = z.object({
  status: z.preprocess(empty, z.enum(["pending", "approved", "rejected", "archived"]).optional()),
  q: z.preprocess(empty, z.string().trim().max(100).optional()),
  ...paging,
});

router.get("/admin/users", async (req, res) => res.json(await admin.listUsers(usersQuery.parse(req.query))));

router.put("/admin/users/:id/role", async (req, res) => {
  const { roles } = z.object({ roles: z.array(z.enum(["student", "instructor", "admin"])).min(1, "Choose at least one role").max(3) }).parse(req.body);
  res.json(await admin.setRoles(req.user!, uuid.parse(req.params.id), roles));
});

router.put("/admin/users/:id/suspend", async (req, res) => {
  const body = z.object({ suspended: z.boolean(), reason: z.string().trim().max(500).optional() }).parse(req.body);
  res.json(await admin.setSuspended(req.user!, uuid.parse(req.params.id), body.suspended, body.reason));
});

router.delete("/admin/users/:id", async (req, res) => {
  const { confirm_email } = z.object({ confirm_email: z.string().min(1, "Type the user's email to confirm") }).parse(req.query);
  await admin.deleteUser(req.user!, uuid.parse(req.params.id), confirm_email);
  res.status(204).end();
});

router.get("/admin/courses", async (req, res) => res.json(await admin.listCourses(coursesQuery.parse(req.query))));
router.get("/admin/courses/pending", async (req, res) => res.json(await admin.listCourses({ ...coursesQuery.parse(req.query), status: "pending" })));
router.get("/admin/analytics/overview", async (_req, res) => res.json(await admin.overview()));
router.get("/admin/audit-logs", async (req, res) => {
  res.json(await admin.listAudit(z.object({ action: z.preprocess(empty, z.string().trim().max(60).optional()), ...paging }).parse(req.query)));
});

export default router;
