import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
export class Database {
  readonly sql: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.sql = new DatabaseSync(path);
    this.sql.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(kind,id));
 CREATE UNIQUE INDEX IF NOT EXISTS users_email ON records(json_extract(data,'$.email')) WHERE kind='users';
 CREATE UNIQUE INDEX IF NOT EXISTS voucher_code ON records(json_extract(data,'$.code')) WHERE kind='vouchers';
 CREATE UNIQUE INDEX IF NOT EXISTS recipient_email ON records(json_extract(data,'$.orgId'),json_extract(data,'$.email')) WHERE kind='recipients';
 CREATE TABLE IF NOT EXISTS otp(email TEXT PRIMARY KEY,hash TEXT NOT NULL,salt TEXT NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL);
 `);
  }
  list<T>(kind: string): T[] {
    return this.sql
      .prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((x: any) => JSON.parse(x.data));
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.sql
      .prepare("SELECT data FROM records WHERE kind=? AND id=?")
      .get(kind, id) as any;
    return row ? JSON.parse(row.data) : undefined;
  }
  put<T extends { id: string }>(kind: string, value: T) {
    this.sql
      .prepare(
        "INSERT INTO records(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, value.id, JSON.stringify(value));
    return value;
  }
  delete(kind: string, id: string) {
    this.sql.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  atomic<T>(fn: () => T): T {
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.sql.exec("COMMIT");
      return result;
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }
  close() {
    this.sql.close();
  }
}
