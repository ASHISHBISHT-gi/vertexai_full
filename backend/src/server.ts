import cors from "cors";
import express from "express";
import { env } from "./config/env";
import { pool } from "./db/pool";
import { authLimiter, apiLimiter } from "./middleware/rateLimit";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { requestLogger, securityHeaders } from "./middleware/security";
import authRoutes from "./modules/auth/auth.routes";
import courseRoutes from "./modules/courses/courses.routes";
import adminRoutes from "./modules/admin/admin.routes";
import announcementRoutes from "./modules/announcements/announcements.routes";
import discussionRoutes from "./modules/discussions/discussions.routes";
import { outboxStats, startEmailWorker, stopEmailWorker } from "./modules/email/outbox";
import notificationRoutes from "./modules/notifications/notifications.routes";
import resourceRoutes from "./modules/resources/resources.routes";
import reviewRoutes from "./modules/reviews/reviews.routes";
import analyticsRoutes from "./modules/analytics/analytics.routes";
import assignmentRoutes from "./modules/assignments/assignments.routes";
import certificateRoutes from "./modules/certificates/certificates.routes";
import enrollmentRoutes from "./modules/enrollments/enrollments.routes";
import gamificationRoutes from "./modules/gamification/gamification.routes";
import learningRoutes from "./modules/learning/learning.routes";
import recommendationRoutes from "./modules/recommendations/recommendations.routes";
import quizRoutes from "./modules/quizzes/quizzes.routes";

const app = express();

// Behind NGINX / a load balancer the TCP connection comes from the proxy; trust its X-Forwarded-For so req.ip is the visitor.
if (env.TRUST_PROXY > 0) app.set("trust proxy", env.TRUST_PROXY);

app.use(securityHeaders);
app.use(requestLogger);
app.use(cors({ origin: env.CORS_ORIGIN.split(",").map((s) => s.trim()) }));
app.use(express.json({ limit: "2mb" }));

// Health check for load balancers and Docker. Skips the rate limiter on purpose.
app.get("/health", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT now() AS db_time");
    res.json({ status: "ok", db_time: rows[0].db_time, email_queue: await outboxStats() });
  } catch {
    res.status(503).json({ status: "error", message: "database unreachable" });
  }
});

// PRD 8.9: auth endpoints are limited per IP; every other /api/v1 route per user.
app.use("/api/v1/auth", authLimiter);
app.use("/api/v1", apiLimiter);

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1", courseRoutes);
app.use("/api/v1", enrollmentRoutes);
app.use("/api/v1", learningRoutes);
app.use("/api/v1", assignmentRoutes);
app.use("/api/v1", quizRoutes);
app.use("/api/v1", certificateRoutes);
app.use("/api/v1", gamificationRoutes);
app.use("/api/v1", analyticsRoutes);
app.use("/api/v1", recommendationRoutes);
app.use("/api/v1", adminRoutes);
app.use("/api/v1", notificationRoutes);
app.use("/api/v1", reviewRoutes);
app.use("/api/v1", resourceRoutes);
app.use("/api/v1", discussionRoutes);
app.use("/api/v1", announcementRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const server = app.listen(env.PORT, () => {
  console.log(`API running on http://localhost:${env.PORT}`);
  startEmailWorker();
});

// Docker / Kubernetes stop containers with SIGTERM: finish in-flight requests, then close the database connections.
function shutdown(signal: string) {
  console.log(`${signal} received, shutting down`);
  stopEmailWorker();
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref(); // don't hang forever on a stuck connection
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
