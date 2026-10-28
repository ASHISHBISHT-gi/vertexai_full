import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_ACCESS_SECRET: z.string().min(16, "JWT_ACCESS_SECRET must be at least 16 characters"),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  // Where uploaded files live (relative to the backend folder). Swap for S3/MinIO later.
  UPLOAD_DIR: z.string().default("uploads"),
  MAX_VIDEO_MB: z.coerce.number().positive().default(500),
  MAX_SUBMISSION_MB: z.coerce.number().positive().default(10),
  // How long a signed video link stays valid.
  MEDIA_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(3600),
  // "Today" for streaks is calculated in this timezone, not UTC.
  APP_TIMEZONE: z.string().default("Asia/Kolkata"),

  // ---- Week 4b ----
  // Public address of the website. Used to build links inside emails.
  APP_URL: z.string().default("http://localhost:5173"),
  // Set to 1 when the API sits behind NGINX / a load balancer, so req.ip is the visitor and not the proxy.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  // PRD 8.9 limits. Set RATE_LIMIT_ENABLED=false only for load tests and the smoke test.
  RATE_LIMIT_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_API_PER_MIN: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_POST_PER_MIN: z.coerce.number().int().positive().default(10),
  // Cache lifetimes (PRD 9.4).
  CATALOG_CACHE_SECONDS: z.coerce.number().int().min(0).default(300),
  LEADERBOARD_CACHE_SECONDS: z.coerce.number().int().min(0).default(60),
  // Email. Without SMTP_HOST, emails are written to the log instead of sent (handy in development).
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  EMAIL_FROM: z.string().default("Vertexon Learning <no-reply@vertexon.local>"),
  EMAIL_WORKER_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration (check backend/.env):");
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.map(String).join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
