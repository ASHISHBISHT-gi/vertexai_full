import { env } from "../../config/env";
import { pool, withTransaction, type Db } from "../../db/pool";
import { sendEmail } from "./mailer";

const MAX_ATTEMPTS = 5;

/** Queues one email per recipient who is active and hasn't opted out. Runs in the caller's transaction. */
export async function enqueueEmails(db: Db, userIds: string[], subject: string, body: string, link?: string) {
  if (userIds.length === 0) return;
  const text = [body, link ? `Open it here: ${env.APP_URL}${link}` : "", "—\nYou get this email because of your Vertexon notification settings. You can turn emails off on the Notifications page."]
    .filter(Boolean)
    .join("\n\n");
  await db.query(
    `INSERT INTO email_outbox (to_email, subject, body)
     SELECT email, $2, $3 FROM users WHERE id = ANY($1::uuid[]) AND is_active AND email_notifications`,
    [userIds, subject.slice(0, 200), text],
  );
}

/**
 * Sends up to `batch` waiting emails. Safe to run from several workers at once: FOR UPDATE SKIP LOCKED means each
 * worker takes different rows. A failed send is retried later with a growing delay, and given up on after 5 tries.
 */
export async function processOutbox(batch = 10): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  await withTransaction(async (db) => {
    const { rows } = await db.query<{ id: string; to_email: string; subject: string; body: string; attempts: number }>(
      `SELECT id, to_email, subject, body, attempts FROM email_outbox
       WHERE status = 'pending' AND run_after <= now() ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [batch],
    );
    for (const job of rows) {
      try {
        await sendEmail(job.to_email, job.subject, job.body);
        await db.query("UPDATE email_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1", [job.id]);
        sent++;
      } catch (err) {
        const attempts = job.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await db.query(
          `UPDATE email_outbox SET attempts = $2, last_error = $3, status = $4, run_after = now() + make_interval(mins => $5::int) WHERE id = $1`,
          [job.id, attempts, String(err instanceof Error ? err.message : err).slice(0, 500), giveUp ? "failed" : "pending", attempts * attempts],
        );
        failed++;
      }
    }
  });
  return { sent, failed };
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/** Checks the outbox every 10 seconds. Call stopEmailWorker() on shutdown. */
export function startEmailWorker() {
  if (!env.EMAIL_WORKER_ENABLED || timer) return;
  timer = setInterval(async () => {
    if (running) return; // the previous round is still going: don't pile up
    running = true;
    try {
      await processOutbox();
    } catch (err) {
      console.error("email worker:", err);
    } finally {
      running = false;
    }
  }, 10_000);
  timer.unref(); // don't keep the process alive just for this timer
}

export function stopEmailWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}

export async function outboxStats() {
  const { rows } = await pool.query<{ status: string; n: number }>("SELECT status, count(*)::int AS n FROM email_outbox GROUP BY status");
  return Object.fromEntries(rows.map((r) => [r.status, r.n]));
}
