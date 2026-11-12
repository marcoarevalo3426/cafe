import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../server/db";
import { Domain } from "../server/domain";
import { createApp } from "../server/app";
import { parseCafeImport } from "../src/import";
test("HTTP authentication, session cookie, access control and logout work end to end", async () => {
  const db = new Database(":memory:");
  const d = new Domain(db, true);
  d.seed();
  const server = createApp(d).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  const port = (server.address() as any).port;
  const base = `http://127.0.0.1:${port}/api`;
  const post = (path: string, body: any, cookie?: string, origin?: string) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(cookie ? { Cookie: cookie } : {}),
        ...(origin ? { Origin: origin } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await post("/menu/template", { name: "Tea" })).status, 401);
    assert.equal((await post("/auth/request", { email: "bad" })).status, 400);
    const code = await (
      await post("/auth/request", { email: "owner@cafe.test" })
    ).json();
    const response = await post("/auth/verify", {
      email: "owner@cafe.test",
      code: code.developmentCode,
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")!.split(";")[0];
    assert.ok(response.headers.get("set-cookie")!.includes("HttpOnly"));
    assert.equal((await response.json()).token, undefined);
    const b = await (
      await fetch(base + "/bootstrap", { headers: { Cookie: cookie } })
    ).json();
    assert.equal(b.user.role, "owner");
    assert.equal(
      (await post("/menu/template", { name: "Tea" }, cookie)).status,
      200,
    );
    assert.equal(
      (await post("/admin", { action: "settings", price: 1 }, cookie)).status,
      403,
    );
    assert.equal(
      (
        await post(
          "/settings",
          { orderNotifications: false, announcements: true },
          cookie,
          "https://evil.example",
        )
      ).status,
      403,
    );
    assert.equal((await post("/auth/logout", {}, cookie)).status, 200);
    assert.equal(
      (await post("/menu/template", { name: "Sweets" }, cookie)).status,
      401,
    );
  } finally {
    await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
    db.close();
  }
});
test("CSV import handles quoted commas, escaped quotes, BOM, and JSON", () => {
  const csv =
    '\uFEFFname,ownerEmail,address\r\n"Gordon, Cafe",owner@example.com,"123 ""Bourke"" Street"';
  assert.deepEqual(parseCafeImport(csv), [
    {
      name: "Gordon, Cafe",
      ownerEmail: "owner@example.com",
      address: '123 "Bourke" Street',
    },
  ]);
  assert.equal(
    parseCafeImport('[{"name":"Cafe","ownerEmail":"a@example.com"}]')[0].name,
    "Cafe",
  );
  assert.throws(() => parseCafeImport("wrong,headers\na,b"));
  assert.throws(() =>
    parseCafeImport('name,ownerEmail\n"unclosed,a@example.com'),
  );
});
