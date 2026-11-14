import { DatabaseSync } from "node:sqlite";
import { MySqlTestDatabase } from "./mysql-database";
import { DynamoTestDatabase } from "./dynamodb-database";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Storage } from "../../server/storage";
// Test double only. Deployments use MySQL or DynamoDB; SQLite is never shipped in a server bundle.
export class SqliteTestDatabase implements Storage {
  private sql = new DatabaseSync(":memory:");
  private context = new AsyncLocalStorage<{ savepoint: number }>();
  private tail: Promise<void> = Promise.resolve();
  constructor(_path = ":memory:") {
    this.sql
      .exec(`CREATE TABLE records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data)),PRIMARY KEY(kind,id));
 CREATE UNIQUE INDEX users_email ON records(json_extract(data,'$.email')) WHERE kind='users';
 CREATE UNIQUE INDEX voucher_code ON records(json_extract(data,'$.code')) WHERE kind='vouchers';
 CREATE UNIQUE INDEX recipient_email ON records(json_extract(data,'$.orgId'),json_extract(data,'$.email')) WHERE kind='recipients';`);
  }
  async initialize() {}
  async list<T>(kind: string): Promise<T[]> {
    return this.sql
      .prepare("SELECT data FROM records WHERE kind=? ORDER BY rowid")
      .all(kind)
      .map((r: any) => JSON.parse(r.data));
  }
  async get<T>(kind: string, id: string): Promise<T | undefined> {
    const row = this.sql
      .prepare("SELECT data FROM records WHERE kind=? AND id=?")
      .get(kind, id) as any;
    return row ? JSON.parse(row.data) : undefined;
  }
  async put<T extends { id: string }>(kind: string, value: T): Promise<T> {
    if (!this.context.getStore())
      return this.atomic(() => this.put(kind, value));
    this.sql
      .prepare(
        "INSERT INTO records VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data",
      )
      .run(kind, value.id, JSON.stringify(value));
    return value;
  }
  async delete(kind: string, id: string): Promise<void> {
    if (!this.context.getStore())
      return this.atomic(() => this.delete(kind, id));
    this.sql.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  async atomic<T>(fn: () => Promise<T>): Promise<T> {
    const parent = this.context.getStore();
    if (parent) {
      const name = `sp_${++parent.savepoint}`;
      this.sql.exec(`SAVEPOINT ${name}`);
      try {
        const r = await fn();
        this.sql.exec(`RELEASE SAVEPOINT ${name}`);
        return r;
      } catch (e) {
        this.sql.exec(
          `ROLLBACK TO SAVEPOINT ${name}; RELEASE SAVEPOINT ${name}`,
        );
        throw e;
      }
    }
    const previous = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    await previous;
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const result = await this.context.run({ savepoint: 0 }, fn);
      this.sql.exec("COMMIT");
      return result;
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    } finally {
      unlock();
    }
  }
  async close() {
    await this.tail;
    this.sql.close();
  }
}

export const Database =
  process.env.DYNAMODB_INTEGRATION === "1"
    ? DynamoTestDatabase
    : process.env.MYSQL_INTEGRATION === "1"
      ? MySqlTestDatabase
      : SqliteTestDatabase;
