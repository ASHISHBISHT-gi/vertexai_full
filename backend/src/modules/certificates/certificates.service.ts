import crypto from "node:crypto";
import fs from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { pool } from "../../db/pool";
import { absolutePath, ensureDir } from "../../storage/storage";
import { notFound } from "../../utils/errors";
import { awardBadge } from "../gamification/gamification.service";
import { notify } from "../notifications/notifications.service";

// pdf-lib's built-in fonts only cover Latin characters. Swap unsupported characters for "?"
// instead of crashing. (To support names in other scripts, embed a Unicode font later.)
function safe(font: PDFFont, text: string): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    return [...text].map((ch) => { try { font.encodeText(ch); return ch; } catch { return "?"; } }).join("");
  }
}

function fitSize(font: PDFFont, text: string, maxWidth: number, start: number): number {
  let size = start;
  while (size > 12 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 1;
  return size;
}

async function buildPdf(d: { studentName: string; courseTitle: string; instructorName: string; issuedAt: Date; code: string }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([842, 595]); // A4 landscape
  const serif = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.11, 0.14, 0.25);
  const pen = rgb(0.12, 0.23, 0.58);
  const muted = rgb(0.36, 0.39, 0.51);
  const { width } = page.getSize();

  const centered = (text: string, y: number, font: PDFFont, size: number, color = ink) => {
    const t = safe(font, text);
    page.drawText(t, { x: (width - font.widthOfTextAtSize(t, size)) / 2, y, size, font, color });
  };

  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: 547, borderColor: pen, borderWidth: 3 });
  page.drawRectangle({ x: 34, y: 34, width: width - 68, height: 527, borderColor: pen, borderWidth: 0.75 });

  centered("Vertexon Learning", 500, sans, 16, pen);
  centered("Certificate of completion", 440, serif, 40);
  centered("This certifies that", 392, sans, 15, muted);

  const name = safe(serif, d.studentName);
  const nameSize = fitSize(serif, name, 640, 44);
  const nameWidth = serif.widthOfTextAtSize(name, nameSize);
  page.drawRectangle({ x: (width - nameWidth) / 2 - 6, y: 322, width: nameWidth + 12, height: 14, color: rgb(1, 0.85, 0.29) }); // highlighter
  page.drawText(name, { x: (width - nameWidth) / 2, y: 324, size: nameSize, font: serif, color: ink });

  centered("has successfully completed", 280, sans, 15, muted);
  const title = safe(serif, d.courseTitle);
  centered(title, 232, serif, fitSize(serif, title, 660, 28));
  centered(`Taught by ${d.instructorName}`, 196, sans, 14, muted);

  const date = d.issuedAt.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
  page.drawText(`Issued ${date}`, { x: 70, y: 80, size: 12, font: sans, color: muted });
  const codeText = `Certificate ID ${d.code}`;
  page.drawText(codeText, { x: width - 70 - sans.widthOfTextAtSize(codeText, 12), y: 80, size: 12, font: sans, color: muted });
  return pdf.save();
}

/**
 * Creates the certificate if the student has finished the course and doesn't have one yet.
 * Safe to call repeatedly. (In production this would be a background job; it takes ~50ms, so it runs inline.)
 */
export async function issueCertificateIfComplete(userId: string, courseId: string) {
  const { rows } = await pool.query(
    `SELECT e.progress_percent::float8 AS progress, u.full_name AS student_name, c.title AS course_title,
            i.full_name AS instructor_name,
            (SELECT id FROM certificates WHERE user_id = $1 AND course_id = $2) AS cert_id
     FROM enrollments e JOIN users u ON u.id = e.user_id JOIN courses c ON c.id = e.course_id
     JOIN users i ON i.id = c.instructor_id
     WHERE e.user_id = $1 AND e.course_id = $2`,
    [userId, courseId],
  );
  const row = rows[0];
  if (!row || row.progress < 100) return null;
  if (row.cert_id) return { id: row.cert_id as string, badge: null as string | null };

  const code = crypto.randomBytes(6).toString("hex").toUpperCase();
  const issuedAt = new Date();
  const bytes = await buildPdf({ studentName: row.student_name, courseTitle: row.course_title, instructorName: row.instructor_name, issuedAt, code });
  const relative = `certificates/${code}.pdf`;
  ensureDir("certificates");
  await fs.writeFile(absolutePath(relative), bytes);

  const inserted = await pool.query(
    `INSERT INTO certificates (user_id, course_id, code, file_path, issued_at) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id, course_id) DO NOTHING RETURNING id`,
    [userId, courseId, code, relative, issuedAt],
  );
  if (!inserted.rows[0]) {
    await fs.unlink(absolutePath(relative)).catch(() => {}); // lost a race with a parallel request
    const existing = await pool.query("SELECT id FROM certificates WHERE user_id = $1 AND course_id = $2", [userId, courseId]);
    return { id: existing.rows[0].id as string, badge: null };
  }
  await notify(pool, [userId], { type: "certificate", title: "Your certificate is ready", body: row.course_title, link: "/dashboard", email: true });
  const badge = await awardBadge(pool, userId, "first_course");
  return { id: inserted.rows[0].id as string, badge };
}

export async function listMyCertificates(userId: string) {
  const { rows } = await pool.query(
    `SELECT ce.id, ce.code, ce.issued_at, c.id AS course_id, c.title AS course_title
     FROM certificates ce JOIN courses c ON c.id = ce.course_id
     WHERE ce.user_id = $1 ORDER BY ce.issued_at DESC`,
    [userId],
  );
  return rows;
}

export async function getCertificateFile(certId: string, userId: string) {
  const { rows } = await pool.query("SELECT code, file_path FROM certificates WHERE id = $1 AND user_id = $2", [certId, userId]);
  if (!rows[0]) throw notFound("Certificate");
  return { path: absolutePath(rows[0].file_path), downloadName: `certificate-${rows[0].code}.pdf` };
}

/** Public: lets anyone check that a certificate code is real. */
export async function verifyCertificate(code: string) {
  const { rows } = await pool.query(
    `SELECT u.full_name AS student_name, c.title AS course_title, ce.issued_at
     FROM certificates ce JOIN users u ON u.id = ce.user_id JOIN courses c ON c.id = ce.course_id
     WHERE ce.code = $1`,
    [code.toUpperCase()],
  );
  return rows[0] ? { valid: true, ...rows[0] } : { valid: false };
}
