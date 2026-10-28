import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../../middleware/auth";
import * as auth from "./auth.service";

const router = Router();

const email = z.string().trim().toLowerCase().email("email must be a valid email address");

const registerSchema = z.object({
  full_name: z.string().trim().min(2, "full_name must be at least 2 characters").max(150),
  email,
  // bcrypt only uses the first 72 bytes, so cap there.
  password: z.string().min(8, "password must be at least 8 characters").max(72),
});
const loginSchema = z.object({ email, password: z.string().min(1, "password is required") });
const tokenSchema = z.object({ refresh_token: z.string().min(1, "refresh_token is required") });

router.post("/register", async (req, res) => {
  const result = await auth.register(registerSchema.parse(req.body));
  res.status(201).json(result);
});

router.post("/login", async (req, res) => {
  res.json(await auth.login(loginSchema.parse(req.body)));
});

router.post("/refresh", async (req, res) => {
  const { refresh_token } = tokenSchema.parse(req.body);
  res.json(await auth.refresh(refresh_token));
});

router.post("/logout", async (req, res) => {
  const { refresh_token } = tokenSchema.parse(req.body);
  await auth.logout(refresh_token);
  res.status(204).end();
});

router.get("/me", authenticate, async (req, res) => {
  res.json(await auth.getMe(req.user!.id));
});

export default router;
