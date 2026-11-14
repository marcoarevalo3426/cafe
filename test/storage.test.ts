import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "./support/database";
import { mysqlOptions } from "../server/db";
import { emailConfiguration } from "../server/email";
import { Domain } from "../server/domain";
import { normalizeBasePath } from "../src/paths";

test("record upserts preserve order and unique email/code constraints cannot overwrite another record", async () => {
  const db = new Database();
  try {
    await db.put("users", {
      id: "one",
      email: "one@example.com",
      name: "First",
    });
    await assert.rejects(
      db.put("users", {
        id: "two",
        email: "one@example.com",
        name: "Replacement",
      }),
    );
    assert.equal((await db.get<any>("users", "one")).name, "First");
    assert.equal(await db.get("users", "two"), undefined);
    await db.put("vouchers", { id: "one", code: "abc123" });
    await assert.rejects(db.put("vouchers", { id: "two", code: "abc123" }));
    await db.put("ordered", { id: "b", value: 1 });
    await db.put("ordered", { id: "a", value: 2 });
    await db.put("ordered", { id: "b", value: 3 });
    assert.deepEqual(
      (await db.list<any>("ordered")).map((x) => x.id),
      ["b", "a"],
    );
  } finally {
    await db.close();
  }
});
test("concurrent read-modify-write transactions do not lose updates and nested rollbacks use savepoints", async () => {
  const db = new Database();
  try {
    await db.put("counter", { id: "one", value: 0 });
    await Promise.all(
      Array.from({ length: 12 }, () =>
        db.atomic(async () => {
          const row = (await db.get<any>("counter", "one"))!;
          await new Promise((resolve) => setTimeout(resolve, 1));
          await db.put("counter", { ...row, value: row.value + 1 });
        }),
      ),
    );
    assert.equal((await db.get<any>("counter", "one")).value, 12);
    await db.atomic(async () => {
      await db.put("scope", { id: "outer" });
      try {
        await db.atomic(async () => {
          await db.put("scope", { id: "inner" });
          throw new Error("rollback");
        });
      } catch {}
      await db.put("scope", { id: "after" });
    });
    assert.deepEqual(
      (await db.list<any>("scope")).map((x) => x.id),
      ["outer", "after"],
    );
  } finally {
    await db.close();
  }
});
test("the same OTP cannot create two sessions through simultaneous verification requests", async () => {
  const db = new Database();
  try {
    const d = new Domain(db, true);
    const code = await d.requestCode("concurrent@example.com");
    const results = await Promise.allSettled([
      d.verify("concurrent@example.com", code.developmentCode),
      d.verify("concurrent@example.com", code.developmentCode),
    ]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal((await db.list("sessions")).length, 1);
  } finally {
    await db.close();
  }
});
test("SMTP configuration uses implicit TLS on 465 and STARTTLS on 587", () => {
  const env = {
    EMAIL_TRANSPORT: "smtp",
    SMTP_HOST: "mail.example.com",
    SMTP_USER: "test@example.com",
    SMTP_PASSWORD: "test-only",
    SMTP_PORT: "465",
    SMTP_FORCE_IPV4: "1",
  };
  const config = emailConfiguration(env);
  assert.ok(config?.transport === "smtp");
  assert.equal(config.options.secure, true);
  assert.equal(config.options.tls.rejectUnauthorized, true);
  assert.equal(config.forceIPv4, true);
  const startTls = emailConfiguration({ ...env, SMTP_PORT: "587" });
  assert.ok(startTls?.transport === "smtp");
  assert.equal(startTls.options.secure, false);
  assert.equal(startTls.options.requireTLS, true);
  assert.equal(emailConfiguration({ ...env, SMTP_PASSWORD: "" }), null);
  assert.throws(() => emailConfiguration({ ...env, SMTP_PORT: "25" }), /TLS/);
});
test("MySQL configuration requires explicit credentials and never disables certificate verification", () => {
  const env = {
    MYSQL_HOST: "localhost",
    MYSQL_DATABASE: "cafe_test",
    MYSQL_USER: "test",
    MYSQL_PASSWORD: "test-only",
    MYSQL_SSL: "1",
  };
  const config = mysqlOptions(env);
  assert.equal(config.database, "cafe_test");
  assert.equal(
    typeof config.ssl === "object" && config.ssl.rejectUnauthorized,
    true,
  );
  assert.throws(
    () => mysqlOptions({ ...env, MYSQL_PASSWORD: "" }),
    /MYSQL_PASSWORD/,
  );
});

test("hosting paths accept a cafe subfolder and reject traversal or external URLs", () => {
  assert.equal(normalizeBasePath("/cafe/"), "/cafe");
  assert.equal(normalizeBasePath("/"), "");
  for (const value of [
    "cafe",
    "https://example.com",
    "/cafe/../other",
    "/cafe%2fother",
  ]) {
    assert.throws(() => normalizeBasePath(value));
  }
});
