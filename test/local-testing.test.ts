import { test } from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import type { Request } from "express";
import { Database } from "../server/db";
import { Domain } from "../server/domain";
import { createApp } from "../server/app";
import { isLocalTestingRequest } from "../server/local-testing";

const request = (
  peer: string,
  host: string,
  headers: Request["headers"] = {},
) => ({
  socket: { remoteAddress: peer } as Request["socket"],
  headers: { host, ...headers },
});
test("local testing rejects public hosts, remote peers, and forged forwarded headers", () => {
  assert.equal(
    isLocalTestingRequest(request("127.0.0.1", "localhost:4000")),
    true,
  );
  assert.equal(isLocalTestingRequest(request("::1", "[::1]:4000")), true);
  assert.equal(
    isLocalTestingRequest(request("::ffff:127.0.0.1", "127.0.0.1:4000")),
    true,
  );
  assert.equal(
    isLocalTestingRequest(
      request("192.168.1.9", "localhost:4000", {
        "x-forwarded-for": "127.0.0.1",
      }),
    ),
    false,
  );
  assert.equal(
    isLocalTestingRequest(request("::ffff:192.168.1.9", "localhost:4000")),
    false,
  );
  assert.equal(
    isLocalTestingRequest(
      request("127.0.0.1", "cafe.example.com", {
        "x-forwarded-host": "localhost:4000",
      }),
    ),
    false,
  );
  assert.equal(
    isLocalTestingRequest(request("127.0.0.1", "localhost.evil.example")),
    false,
  );
  assert.equal(
    isLocalTestingRequest(
      request("127.0.0.1", "localhost:4000", {
        origin: "https://evil.example",
      }),
    ),
    false,
  );
});

test("testing mode creates sessions for fixed demo accounts including admin without sending email", async () => {
  const db = new Database(":memory:");
  const d = new Domain(db, true);
  d.seed();
  const server = createApp(d).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  try {
    assert.equal(
      (await (await fetch(`${base}/bootstrap`)).json()).testingModeAvailable,
      true,
    );
    for (const role of ["owner", "customer", "organisation", "admin"]) {
      const response = await fetch(`${base}/auth/testing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, email: "other@example.com" }),
      });
      assert.equal(response.status, 200);
      const { user, token } = await response.json();
      assert.equal(user.role, role);
      assert.equal(token, undefined);
      assert.ok(user.email.endsWith("@cafe.test"));
      const cookie = response.headers.get("set-cookie")!;
      assert.ok(cookie.includes("HttpOnly"));
      const bootstrap = await (
        await fetch(`${base}/bootstrap`, {
          headers: { Cookie: cookie.split(";")[0] },
        })
      ).json();
      assert.equal(bootstrap.user.id, user.id);
      if (role === "admin") {
        assert.equal(user.email, "admin@cafe.test");
        const adminResponse = await fetch(`${base}/admin`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookie.split(";")[0],
          },
          body: JSON.stringify({ action: "settings", price: 2900 }),
        });
        assert.equal(adminResponse.status, 200);
      }
    }
    const native = await fetch(`${base}/auth/testing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cafe-Client": "native",
      },
      body: JSON.stringify({ role: "customer" }),
    });
    const nativeSession = await native.json();
    assert.equal(d.authenticate(nativeSession.token)?.role, "customer");
    assert.equal(db.list("jobs").length, 0);
    assert.equal(
      db.list<any>("users").some((u) => u.email === "other@example.com"),
      false,
    );
    const invalid = await fetch(`${base}/auth/testing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "superadmin" }),
    });
    assert.equal(invalid.status, 400);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    db.close();
  }
});

for (const config of [
  { demo: true, production: true },
  { demo: false, production: false },
]) {
  test(`testing login is unavailable with demo=${config.demo}, production=${config.production}`, async () => {
    const db = new Database(":memory:");
    const d = new Domain(db, config.demo);
    d.seed();
    const server = createApp(d, { production: config.production }).listen(
      0,
      "127.0.0.1",
    );
    await new Promise<void>((resolve) => server.on("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
    try {
      assert.equal(
        (await (await fetch(`${base}/bootstrap`)).json()).testingModeAvailable,
        false,
      );
      assert.equal(
        (
          await fetch(`${base}/auth/testing`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ role: "admin" }),
          })
        ).status,
        404,
      );
      assert.equal(
        db.sql.prepare("SELECT COUNT(*) AS n FROM sessions").get()!.n,
        0,
      );
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      db.close();
    }
  });
}

test("public requests cannot expose Testing mode or reuse a local test session", async () => {
  const db = new Database(":memory:");
  const d = new Domain(db, true);
  d.seed();
  const session = d.testingLogin("admin");
  const server = createApp(d).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const send = (path: string, body?: unknown) =>
    new Promise<{ status: number; data: any }>((resolve, reject) => {
      const req = httpRequest(
        `${base}${path}`,
        {
          method: body === undefined ? "GET" : "POST",
          headers: {
            Host: "cafe.example.com",
            "X-Forwarded-Host": "localhost",
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.token}`,
          },
        },
        (res) => {
          let content = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => (content += chunk));
          res.on("end", () =>
            resolve({ status: res.statusCode!, data: JSON.parse(content) }),
          );
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  try {
    const bootstrap = await send("/bootstrap");
    assert.equal(bootstrap.data.testingModeAvailable, false);
    assert.equal(bootstrap.data.user, null);
    assert.equal((await send("/auth/testing", { role: "admin" })).status, 404);
    assert.equal(
      (await send("/admin", { action: "settings", price: 1 })).status,
      401,
    );
    d.demo = false;
    assert.equal(d.authenticate(session.token), null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    db.close();
  }
});
