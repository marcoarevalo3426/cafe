import { test } from "node:test";
import assert from "node:assert/strict";
import serverlessExpress from "@codegenie/serverless-express";
import { testEmailSignInEnabled } from "../server/test-email-sign-in";
import { Database } from "./support/database";
import { Domain } from "../server/domain";
import { createApp } from "../server/app";

test("email-code bypass is off by default and requires the explicit test stage and setting", () => {
  assert.equal(testEmailSignInEnabled({}), false);
  assert.equal(
    testEmailSignInEnabled({
      APP_STAGE: "production",
      TEST_EMAIL_SIGN_IN: "allowlisted",
    }),
    false,
  );
  assert.equal(
    testEmailSignInEnabled({
      APP_STAGE: "test",
      TEST_EMAIL_SIGN_IN: "disabled",
    }),
    false,
  );
  assert.equal(
    testEmailSignInEnabled({
      APP_STAGE: "test",
      TEST_EMAIL_SIGN_IN: "allowlisted",
    }),
    true,
  );
});

test("only the two allowlisted emails skip codes on the test site and immediately receive account choices", async () => {
  const previous = {
    stage: process.env.APP_STAGE,
    mode: process.env.TEST_EMAIL_SIGN_IN,
  };
  const db = new Database();
  const d = new Domain(db, false);
  const http = serverlessExpress({
    app: createApp(d, { production: true, origin: "https://cafe.example.com" }),
  });
  let cookies: string[] = [];
  let bypassToken = "";
  const request = async (path: string, body?: unknown) => {
    const response = (await http(
      {
        version: "2.0",
        routeKey: "$default",
        rawPath: "/api" + path,
        rawQueryString: "",
        headers: {
          "content-type": "application/json",
          origin: "https://cafe.example.com",
        },
        requestContext: {
          http: {
            method: body === undefined ? "GET" : "POST",
            sourceIp: "127.0.0.1",
          },
        },
        cookies,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        isBase64Encoded: false,
      } as any,
      {} as any,
    )) as any;
    if (response.cookies)
      cookies = response.cookies.map((cookie: string) => cookie.split(";")[0]);
    return {
      status: response.statusCode,
      body: JSON.parse(response.body),
      cookies: response.cookies ?? [],
    };
  };
  try {
    process.env.APP_STAGE = "test";
    process.env.TEST_EMAIL_SIGN_IN = "allowlisted";
    for (const email of [
      "marco.arevalo3426@gmail.com",
      " MAREVALO@NEPGROUP.COM ",
    ]) {
      cookies = [];
      const response = await request("/auth/request", { email });
      assert.equal(response.status, 200);
      assert.equal(response.body.user.email, email.trim().toLowerCase());
      assert.equal(response.body.user.role, undefined);
      assert.equal(response.body.token, undefined);
      bypassToken = cookies[0].slice("cafe_session=".length);
      assert.ok(
        response.cookies.some(
          (cookie: string) => /HttpOnly/.test(cookie) && /Secure/.test(cookie),
        ),
      );
      const bootstrap = await request("/bootstrap");
      assert.equal(bootstrap.body.testEmailSignInAvailable, true);
      assert.deepEqual(bootstrap.body.accountRoles, [
        "owner",
        "customer",
        "admin",
      ]);
      assert.equal(bootstrap.body.users, undefined);
      assert.equal(
        (await request("/auth/role", { role: "admin" })).status,
        200,
      );
    }
    assert.equal((await db.list("otp")).length, 0);
    assert.equal((await db.list("jobs")).length, 0);
    await assert.rejects(
      d.signInForTesting("other@example.com"),
      /verification is required/,
    );
    // The normal OTP path remains intact for every other account.
    d.demo = true;
    const other = await request("/auth/request", {
      email: "other@example.com",
      skipVerification: true,
    });
    assert.equal(other.status, 200);
    assert.equal(other.body.user, undefined);
    assert.match(other.body.developmentCode, /^\d{6}$/);
    process.env.APP_STAGE = "production";
    assert.equal(await d.authenticate(bypassToken), null);
    await assert.rejects(
      d.signInForTesting("marco.arevalo3426@gmail.com"),
      /unavailable/,
    );
    const required = await request("/auth/request", {
      email: "marco.arevalo3426@gmail.com",
    });
    assert.equal(required.body.user, undefined);
    assert.match(required.body.developmentCode, /^\d{6}$/);
    assert.equal(
      (await request("/bootstrap")).body.testEmailSignInAvailable,
      false,
    );
  } finally {
    if (previous.stage === undefined) delete process.env.APP_STAGE;
    else process.env.APP_STAGE = previous.stage;
    if (previous.mode === undefined) delete process.env.TEST_EMAIL_SIGN_IN;
    else process.env.TEST_EMAIL_SIGN_IN = previous.mode;
    await db.close();
  }
});
