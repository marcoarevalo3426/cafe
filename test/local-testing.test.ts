import { test } from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import type { Request } from "express";
import { Database } from "./support/database";
import { Domain } from "../server/domain";
import { createApp } from "../server/app";
import { isLocalTestingRequest } from "../server/local-testing";
import { testingAccountChoices } from "../src/account-choices";

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

test("testing mode creates fixed demo sessions without email and cannot grant Admin", async () => {
  const db = new Database(":memory:");
  const d = new Domain(db, true);
  await d.seed();
  const server = createApp(d).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  try {
    assert.equal(
      (await (await fetch(`${base}/bootstrap`)).json()).testingModeAvailable,
      true,
    );
    for (const role of ["owner", "customer"]) {
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
    }
    const forbiddenAdmin = await fetch(`${base}/auth/testing`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "admin" }),
    });
    assert.equal(forbiddenAdmin.status, 400);
    const native = await fetch(`${base}/auth/testing`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cafe-Client": "native",
      },
      body: JSON.stringify({ role: "customer" }),
    });
    const nativeSession = await native.json();
    assert.equal((await d.authenticate(nativeSession.token))?.role, "customer");
    assert.equal((await db.list("jobs")).length, 0);
    assert.equal(
      (await db.list<any>("users")).some(
        (u) => u.email === "other@example.com",
      ),
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
    await db.close();
  }
});

test("local Testing mode skips codes for designated emails, opens account choices and keeps test sessions local", async () => {
  const db = new Database();
  const d = new Domain(db, true);
  await d.seed();
  const server = createApp(d).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  const post = (
    path: string,
    body: unknown,
    token = "",
    extra: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Cafe-Client": "native",
        Authorization: `Bearer ${token}`,
        ...extra,
      },
      body: JSON.stringify(body),
    });
  try {
    for (const email of [
      "marco.arevalo3426@gmail.com",
      " MAREVALO@NEPGROUP.COM ",
    ]) {
      const response = await post("/auth/testing", { email });
      assert.equal(response.status, 200);
      const { token, user } = await response.json();
      assert.match(token, /^testing_/);
      assert.equal(user.email, email.trim().toLowerCase());
      assert.equal(user.role, undefined);
      const data = await (
        await fetch(`${base}/bootstrap`, {
          headers: { Authorization: `Bearer ${token}` },
        })
      ).json();
      assert.deepEqual(data.accountRoles, ["owner", "customer", "admin"]);
      assert.ok(
        testingAccountChoices(data).some((choice) => choice.role === "admin"),
      );
      const admin = await post("/auth/role", { role: "admin" }, token);
      assert.equal(admin.status, 200);
      assert.equal((await admin.json()).email, email.trim().toLowerCase());
      d.demo = false;
      assert.equal(await d.authenticate(token), null);
      assert.equal((await post("/auth/testing", { email })).status, 404);
      d.demo = true;
    }
    assert.equal((await db.list("otp")).length, 0);
    assert.equal((await db.list("jobs")).length, 0);
    assert.equal(
      (await post("/auth/testing", { email: "other@example.com" })).status,
      403,
    );
    const normalSignIn = await post("/auth/request", {
      email: "marevalo@nepgroup.com",
    });
    assert.match((await normalSignIn.json()).developmentCode, /^\d{6}$/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await db.close();
  }
});

for (const config of [
  { demo: true, production: true },
  { demo: false, production: false },
]) {
  test(`testing login is unavailable with demo=${config.demo}, production=${config.production}`, async () => {
    const db = new Database(":memory:");
    const d = new Domain(db, config.demo);
    await d.seed();
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
      assert.equal((await db.list("sessions")).length, 0);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
      await db.close();
    }
  });
}

test("public requests cannot expose Testing mode or reuse a local test session", async () => {
  const db = new Database(":memory:");
  const d = new Domain(db, true);
  await d.seed();
  const session = await d.localTestingSignIn("marevalo@nepgroup.com");
  await d.chooseAccount(session.user, "admin", session.token);
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
      (await send("/auth/testing", { email: "marevalo@nepgroup.com" })).status,
      404,
    );
    assert.equal(
      (await send("/admin", { action: "settings", price: 1 })).status,
      401,
    );
    d.demo = false;
    assert.equal(await d.authenticate(session.token), null);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await db.close();
  }
});
