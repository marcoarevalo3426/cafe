import mysql, {
  type Pool,
  type PoolConnection,
  type PoolOptions,
  type RowDataPacket,
} from "mysql2/promise";
import { AsyncLocalStorage } from "node:async_hooks";
import { readFileSync } from "node:fs";
import type { Storage } from "./storage";

export function mysqlOptions(
  env: Record<string, string | undefined> = process.env,
): PoolOptions {
  for (const key of [
    "MYSQL_HOST",
    "MYSQL_DATABASE",
    "MYSQL_USER",
    "MYSQL_PASSWORD",
  ])
    if (!env[key]) throw new Error(`${key} is required.`);
  const port = Number(env.MYSQL_PORT ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid MYSQL_PORT.");
  return {
    host: env.MYSQL_HOST,
    ...(env.MYSQL_SOCKET ? { socketPath: env.MYSQL_SOCKET } : {}),
    port,
    database: env.MYSQL_DATABASE,
    user: env.MYSQL_USER,
    password: env.MYSQL_PASSWORD,
    charset: "utf8mb4",
    connectionLimit: 10,
    connectTimeout: 10000,
    timezone: "Z",
    ...(env.MYSQL_SSL === "1"
      ? {
          ssl: {
            rejectUnauthorized: true,
            ...(env.MYSQL_SSL_CA
              ? { ca: readFileSync(env.MYSQL_SSL_CA, "utf8") }
              : {}),
          },
        }
      : {}),
  };
}
export class Database implements Storage {
  private readonly pool: Pool;
  private readonly context = new AsyncLocalStorage<{
    connection: PoolConnection;
    savepoint: number;
  }>();
  constructor(options: PoolOptions = mysqlOptions()) {
    this.pool = mysql.createPool(options);
  }
  async initialize() {
    await this.pool.query(`CREATE TABLE IF NOT EXISTS cafe_records (
      kind VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      id VARCHAR(254) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
      sequence_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      data JSON NOT NULL,
      user_email VARCHAR(254) GENERATED ALWAYS AS (CASE WHEN kind='users' THEN JSON_UNQUOTE(JSON_EXTRACT(data,'$.email')) ELSE NULL END) STORED,
      voucher_code VARCHAR(6) CHARACTER SET ascii COLLATE ascii_bin GENERATED ALWAYS AS (CASE WHEN kind='vouchers' THEN JSON_UNQUOTE(JSON_EXTRACT(data,'$.code')) ELSE NULL END) STORED,
      PRIMARY KEY(kind,id),UNIQUE KEY cafe_sequence(sequence_id),UNIQUE KEY cafe_user_email(user_email),UNIQUE KEY cafe_voucher_code(voucher_code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
    await this.pool.query(
      "CREATE TABLE IF NOT EXISTS cafe_locks (id VARCHAR(40) NOT NULL PRIMARY KEY) ENGINE=InnoDB",
    );
    await this.pool.execute(
      "INSERT IGNORE INTO cafe_locks(id) VALUES ('domain')",
    );
  }
  private executor() {
    return this.context.getStore()?.connection ?? this.pool;
  }
  async list<T>(kind: string): Promise<T[]> {
    const [rows] = await this.executor().execute<RowDataPacket[]>(
      "SELECT data FROM cafe_records WHERE kind=? ORDER BY sequence_id",
      [kind],
    );
    return rows.map((row) =>
      typeof row.data === "string" ? JSON.parse(row.data) : row.data,
    );
  }
  async get<T>(kind: string, id: string): Promise<T | undefined> {
    const [rows] = await this.executor().execute<RowDataPacket[]>(
      "SELECT data FROM cafe_records WHERE kind=? AND id=?",
      [kind, id],
    );
    return rows[0]
      ? typeof rows[0].data === "string"
        ? JSON.parse(rows[0].data)
        : rows[0].data
      : undefined;
  }
  async put<T extends { id: string }>(kind: string, value: T): Promise<T> {
    if (!this.context.getStore())
      return this.atomic(() => this.put(kind, value));
    const existing = await this.get(kind, value.id);
    if (existing)
      await this.executor().execute(
        "UPDATE cafe_records SET data=? WHERE kind=? AND id=?",
        [JSON.stringify(value), kind, value.id],
      );
    else
      await this.executor().execute(
        "INSERT INTO cafe_records(kind,id,data) VALUES(?,?,?)",
        [kind, value.id, JSON.stringify(value)],
      );
    return value;
  }
  async delete(kind: string, id: string): Promise<void> {
    if (!this.context.getStore())
      return this.atomic(() => this.delete(kind, id));
    await this.executor().execute(
      "DELETE FROM cafe_records WHERE kind=? AND id=?",
      [kind, id],
    );
  }
  async atomic<T>(fn: () => Promise<T>): Promise<T> {
    const parent = this.context.getStore();
    if (parent) {
      const name = `cafe_sp_${++parent.savepoint}`;
      await parent.connection.query(`SAVEPOINT ${name}`);
      try {
        const result = await fn();
        await parent.connection.query(`RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (e) {
        await parent.connection.query(`ROLLBACK TO SAVEPOINT ${name}`);
        await parent.connection.query(`RELEASE SAVEPOINT ${name}`);
        throw e;
      }
    }
    const connection = await this.pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.query(
        "SELECT id FROM cafe_locks WHERE id='domain' FOR UPDATE",
      );
      const result = await this.context.run({ connection, savepoint: 0 }, fn);
      await connection.commit();
      return result;
    } catch (e) {
      await connection.rollback();
      throw e;
    } finally {
      connection.release();
    }
  }
  async importIntoEmpty(rows: { kind: string; value: { id: string } }[]) {
    await this.atomic(async () => {
      const [existing] = await this.executor().query<RowDataPacket[]>(
        "SELECT COUNT(*) AS total FROM cafe_records",
      );
      if (Number(existing[0].total) !== 0)
        throw new Error("Migration requires an empty destination database.");
      for (const row of rows) await this.put(row.kind, row.value);
    });
  }
  async close() {
    await this.pool.end();
  }
}
