import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { env } from "../../config/env";
import { isUniqueViolation, pool, withTransaction, type Db } from "../../db/pool";
import { signAccessToken, type Role } from "../../middleware/auth";
import { conflict, forbidden, notFound, unauthorized } from "../../utils/errors";

const BCRYPT_ROUNDS = 10;
// Compared against when the email doesn't exist, so login takes the same time either way.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_ROUNDS);

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

interface UserRow {
  id: string;
  full_name: string;
  email: string;
  created_at: Date;
}

function toPublicUser(user: UserRow, roles: Role[]) {
  const primary: Role = roles.includes("admin") ? "admin" : roles.includes("instructor") ? "instructor" : "student";
  return { id: user.id, full_name: user.full_name, email: user.email, role: primary, roles, created_at: user.created_at };
}

export async function getUserRoles(db: Db, userId: string): Promise<Role[]> {
  const { rows } = await db.query<{ name: Role }>(
    `SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
     WHERE ur.user_id = $1 ORDER BY r.name`,
    [userId],
  );
  return rows.map((r) => r.name);
}

async function createSession(db: Db, userId: string, roles: Role[]) {
  const refreshToken = crypto.randomBytes(48).toString("hex");
  await db.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3::int))`,
    [userId, hashToken(refreshToken), env.REFRESH_TOKEN_TTL_DAYS],
  );
  return {
    access_token: signAccessToken({ id: userId, roles }),
    refresh_token: refreshToken,
    expires_in: env.ACCESS_TOKEN_TTL_SECONDS,
  };
}

export async function register(input: { full_name: string; email: string; password: string }) {
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);
  try {
    return await withTransaction(async (db) => {
      const { rows } = await db.query<UserRow>(
        `INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3)
         RETURNING id, full_name, email, created_at`,
        [input.full_name, input.email, passwordHash],
      );
      const user = rows[0]!;
      await db.query(
        `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'student'`,
        [user.id],
      );
      const roles: Role[] = ["student"];
      return { ...(await createSession(db, user.id, roles)), user: toPublicUser(user, roles) };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict("Email already registered", "email");
    throw err;
  }
}

export async function login(input: { email: string; password: string }) {
  const { rows } = await pool.query<UserRow & { password_hash: string; is_active: boolean }>(
    `SELECT id, full_name, email, created_at, password_hash, is_active FROM users WHERE email = $1`,
    [input.email],
  );
  const user = rows[0];
  const passwordOk = await bcrypt.compare(input.password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !passwordOk) throw unauthorized("Invalid email or password");
  if (!user.is_active) throw forbidden("This account has been suspended");

  const roles = await getUserRoles(pool, user.id);
  return { ...(await createSession(pool, user.id, roles)), user: toPublicUser(user, roles) };
}

/** Rotates the refresh token: the old one is revoked, a new pair is issued. */
export async function refresh(refreshToken: string) {
  return withTransaction(async (db) => {
    const { rows } = await db.query<{ id: string; user_id: string; is_active: boolean }>(
      `SELECT rt.id, rt.user_id, u.is_active
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > now()
       FOR UPDATE OF rt`,
      [hashToken(refreshToken)],
    );
    const row = rows[0];
    if (!row || !row.is_active) throw unauthorized("Invalid or expired refresh token");

    await db.query("UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1", [row.id]);
    const roles = await getUserRoles(db, row.user_id);
    return createSession(db, row.user_id, roles);
  });
}

export async function logout(refreshToken: string) {
  await pool.query(
    "UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL",
    [hashToken(refreshToken)],
  );
}

export async function getMe(userId: string) {
  const { rows } = await pool.query<UserRow>(
    "SELECT id, full_name, email, created_at FROM users WHERE id = $1",
    [userId],
  );
  const user = rows[0];
  if (!user) throw notFound("User");
  return toPublicUser(user, await getUserRoles(pool, userId));
}
