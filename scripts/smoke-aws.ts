import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { DynamoDatabase } from "../server/dynamodb";
import { digest } from "../server/domain";
import type { User } from "../src/types";
import type { Session } from "../server/storage";

async function main() {
  // Creates only synthetic verification data; sends no email and never touches vouchers.
  const deployment = JSON.parse(await readFile(".aws-deployment.json", "utf8"));
  const identity = JSON.parse(
    execFileSync("aws", ["sts", "get-caller-identity", "--output", "json"], {
      encoding: "utf8",
    }),
  );
  assert.equal(identity.Account, "375033595717");
  assert.equal(deployment.stack, "cafe-test");
  process.env.AWS_REGION = deployment.region;
  const db = new DynamoDatabase(deployment.Table);
  const email = `smoke-${randomUUID()}@example.invalid`;
  const code = String(100000 + Math.floor(Math.random() * 900000));
  const salt = randomBytes(16).toString("hex");
  let cookie = "";
  const post = async (path: string, data: unknown) => {
    const response = await fetch(`${deployment.Website}/api${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: deployment.Website,
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(30000),
    });
    const setCookie = response.headers.get("set-cookie");
    if (setCookie) cookie = setCookie.split(";")[0];
    const body = await response.json();
    assert.equal(
      response.status,
      200,
      `Public ${path} failed (${response.status}).`,
    );
    return { body, setCookie };
  };
  try {
    await db.put("otp", {
      id: email,
      hash: digest(salt + code),
      salt,
      attempts: 0,
      created: Date.now(),
      expires: Date.now() + 180000,
    });
    const verified = await post("/auth/verify", { email, code });
    assert.equal(verified.body.user.email, email);
    assert.match(verified.setCookie ?? "", /HttpOnly/i);
    assert.match(verified.setCookie ?? "", /Secure/i);
    assert.match(verified.setCookie ?? "", /SameSite=Strict/i);
    assert.equal(verified.body.token, undefined);
    const role = await post("/auth/role", { role: "customer" });
    assert.equal(role.body.role, "customer");
    const bootstrap = await fetch(`${deployment.Website}/api/bootstrap`, {
      headers: { cookie },
      signal: AbortSignal.timeout(30000),
    });
    const state = await bootstrap.json();
    assert.equal(state.user.email, email);
    assert.equal(state.testingModeAvailable, false);
    assert.deepEqual(state.accountRoles, []);
    const forbidden = await fetch(`${deployment.Website}/api/admin`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: deployment.Website,
        cookie,
      },
      body: JSON.stringify({
        action: "settings",
        price: 0,
        email: "marco.arevalo3426@gmail.com",
      }),
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(forbidden.status, 403);
    await post("/settings", {
      orderNotifications: false,
      announcements: false,
    });
    await post("/auth/logout", {});
    console.log(
      "PASS: public verification, secure cookie, cookie forwarding, role selection, saved settings and logout. No email or payment sent.",
    );
  } finally {
    await db.atomic(async () => {
      const users = (await db.list<User>("users")).filter(
        (user) => user.email === email,
      );
      for (const user of users) {
        for (const session of await db.list<Session>("sessions"))
          if (session.userId === user.id)
            await db.delete("sessions", session.id);
        await db.delete("users", user.id);
      }
      await db.delete("otp", email);
    });
    console.log("Synthetic smoke-test records removed.");
    await db.close();
  }
}
void main().catch(() => {
  console.error("AWS public signup smoke check failed.");
  process.exitCode = 1;
});
