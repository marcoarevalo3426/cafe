import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";
import { Database } from "../server/db";
async function main() {
  const args = process.argv.slice(2),
    source = args[args.indexOf("--source") + 1];
  if (!args.includes("--source") || !source)
    throw new Error(
      "Usage: migrate-sqlite --source /path/to/cafe.sqlite [--allow-demo] [--dry-run]",
    );
  const sqlite = new DatabaseSync(resolve(source), { readOnly: true });
  const rows = sqlite
    .prepare("SELECT kind,data FROM records ORDER BY rowid")
    .all()
    .map((r: any) => ({ kind: r.kind, value: JSON.parse(r.data) }));
  try {
    if (
      !args.includes("--allow-demo") &&
      rows.some(
        (r) => r.kind === "users" && String(r.value.id).startsWith("demo-"),
      )
    )
      throw new Error(
        "Source contains demo accounts. Use --allow-demo only for a local development migration.",
      );
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);
    if (tables.includes("otp"))
      for (const r of sqlite.prepare("SELECT * FROM otp").all() as any[])
        rows.push({
          kind: "otp",
          value: {
            id: r.email,
            hash: r.hash,
            salt: r.salt,
            expires: r.expires,
            attempts: r.attempts,
            created: r.created,
          },
        });
    if (tables.includes("sessions"))
      for (const r of sqlite.prepare("SELECT * FROM sessions").all() as any[])
        rows.push({
          kind: "sessions",
          value: { id: r.hash, userId: r.user_id, expires: r.expires },
        });
    const counts = rows.reduce((result: Record<string, number>, r) => {
      result[r.kind] = (result[r.kind] ?? 0) + 1;
      return result;
    }, {});
    console.log("Migration record counts:", JSON.stringify(counts));
    if (args.includes("--dry-run")) return;
    const db = new Database();
    try {
      await db.initialize();
      await db.importIntoEmpty(rows);
      console.log(
        `Migrated ${rows.length} records into MySQL. The source SQLite file was not modified.`,
      );
    } finally {
      await db.close();
    }
  } finally {
    sqlite.close();
  }
}
void main().catch((e) => {
  console.error(
    e instanceof Error &&
      /^(Usage|Source contains|Migration requires)/.test(e.message)
      ? e.message
      : "Migration failed; no partial import was committed. Check database configuration and constraints.",
  );
  process.exitCode = 1;
});
