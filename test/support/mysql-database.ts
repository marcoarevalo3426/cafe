import mysql, { type Connection, type PoolOptions } from "mysql2/promise";
import { randomBytes } from "node:crypto";
import { Database as MySqlDatabase } from "../../server/db";
import type { Storage } from "../../server/storage";

export class MySqlTestDatabase implements Storage {
  private readonly name = `cafe_test_${randomBytes(12).toString("hex")}`;
  private admin?: Connection;
  private readonly ready: Promise<MySqlDatabase>;
  constructor(_path = ":memory:") {
    this.ready = this.open();
  }
  private async open() {
    const host = process.env.MYSQL_TEST_HOST ?? "127.0.0.1";
    if (!["localhost", "127.0.0.1", "::1"].includes(host))
      throw new Error("Integration tests only accept a local MySQL server.");
    const options: PoolOptions = {
      host,
      port: Number(process.env.MYSQL_TEST_PORT ?? 3306),
      user: process.env.MYSQL_TEST_USER ?? "root",
      password: process.env.MYSQL_TEST_PASSWORD ?? "",
      ...(process.env.MYSQL_TEST_SOCKET
        ? { socketPath: process.env.MYSQL_TEST_SOCKET }
        : {}),
    };
    this.admin = await mysql.createConnection(options);
    await this.admin.query(
      `CREATE DATABASE \`${this.name}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    const db = new MySqlDatabase({ ...options, database: this.name });
    await db.initialize();
    return db;
  }
  async initialize() {
    await this.ready;
  }
  async get<T>(kind: string, id: string) {
    return (await this.ready).get<T>(kind, id);
  }
  async list<T>(kind: string) {
    return (await this.ready).list<T>(kind);
  }
  async put<T extends { id: string }>(kind: string, value: T) {
    return (await this.ready).put(kind, value);
  }
  async delete(kind: string, id: string) {
    return (await this.ready).delete(kind, id);
  }
  async atomic<T>(fn: () => Promise<T>) {
    return (await this.ready).atomic(fn);
  }
  async close() {
    await (await this.ready).close();
    try {
      await this.admin!.query(`DROP DATABASE \`${this.name}\``);
    } finally {
      await this.admin!.end();
    }
  }
}
