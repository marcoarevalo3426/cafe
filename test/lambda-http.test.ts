import { test } from "node:test";
import assert from "node:assert/strict";
import serverlessExpress from "@codegenie/serverless-express";
import { createApp } from "../server/app";
import { Domain } from "../server/domain";
import { Database } from "./support/database";

test("API Gateway events preserve JSON bodies, base64 bodies and session cookies through signup", async () => {
  const db = new Database();
  const domain = new Domain(db, true);
  const http = serverlessExpress({
    app: createApp(domain, { origin: "https://cafe.example.com" }),
  });
  let cookies: string[] = [];
  const post = async (path: string, body: unknown, base64 = false) => {
    const payload = JSON.stringify(body);
    const response = (await http(
      {
        version: "2.0",
        routeKey: "$default",
        rawPath: path,
        rawQueryString: "",
        headers: {
          "content-type": "application/json",
          origin: "https://cafe.example.com",
        },
        requestContext: {
          http: {
            method: "POST",
            sourceIp: "127.0.0.1",
            protocol: "HTTP/1.1",
            path,
          },
          requestId: "test",
          stage: "$default",
        },
        body: base64 ? Buffer.from(payload).toString("base64") : payload,
        isBase64Encoded: base64,
        cookies,
      } as any,
      {} as any,
    )) as any;
    if (response.cookies)
      cookies = response.cookies.map((cookie: string) => cookie.split(";")[0]);
    return {
      status: response.statusCode,
      body: JSON.parse(
        response.isBase64Encoded
          ? Buffer.from(response.body, "base64").toString()
          : response.body,
      ),
    };
  };
  try {
    const invalid = await post("/api/auth/request", { email: "invalid" });
    assert.equal(invalid.status, 400);
    assert.equal(
      invalid.body.error,
      "Invalid email address. Please try again.",
    );
    const requested = await post(
      "/api/auth/request",
      { email: "lambda@cafe.test" },
      true,
    );
    assert.equal(requested.status, 200);
    assert.match(requested.body.developmentCode, /^\d{6}$/);
    const verified = await post("/api/auth/verify", {
      email: "lambda@cafe.test",
      code: requested.body.developmentCode,
    });
    assert.equal(verified.status, 200);
    assert.ok(cookies.some((cookie) => cookie.startsWith("cafe_session=")));
    const assigned = await post("/api/auth/role", { role: "customer" }, true);
    assert.equal(assigned.status, 200);
    assert.equal(assigned.body.role, "customer");
  } finally {
    await db.close();
  }
});
