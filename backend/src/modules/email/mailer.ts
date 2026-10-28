import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env";

let transport: Transporter | null | undefined;

/** Built once, on first use. null = no SMTP configured, so we only log the email. */
function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  transport = env.SMTP_HOST
    ? nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        secure: env.SMTP_PORT === 465, // 465 = TLS from the start; 587 upgrades with STARTTLS
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      })
    : null;
  return transport;
}

export const emailMode = () => (env.SMTP_HOST ? "smtp" : "log");

/** Sends one email. Throws if the SMTP server refuses it (the outbox worker will retry). */
export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const t = getTransport();
  const cleanSubject = subject.replace(/[\r\n]+/g, " ").slice(0, 200); // a newline in a header could inject extra headers
  if (!t) {
    console.log(JSON.stringify({ level: "info", msg: "email (SMTP not configured, not sent)", to, subject: cleanSubject }));
    return;
  }
  await t.sendMail({ from: env.EMAIL_FROM, to, subject: cleanSubject, text });
}
