import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool, withTransaction } from "./pool";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

async function main() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );
  const done = await pool.query<{ name: string }>("SELECT name FROM schema_migrations");
  const applied = new Set(done.rows.map((r) => r.name));

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await withTransaction(async (db) => {
      await db.query(sql);
      await db.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
    });
    console.log(`applied ${file}`);
  }
  console.log("migrations up to date");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
