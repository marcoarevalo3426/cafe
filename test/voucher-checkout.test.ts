import { test } from "node:test";
import assert from "node:assert/strict";
import serverlessExpress from "@codegenie/serverless-express";
import { Database } from "./support/database";
import { Domain, digest, type Job } from "../server/domain";
import { createApp } from "../server/app";
import type { User, Voucher } from "../src/types";

const form = {
  quantity: 2,
  amount: 1000,
  month: 12,
  year: new Date().getUTCFullYear() + 1,
  storeId: "demo-cafe",
};
test("owner and admin generate vouchers directly into their accounts with one receipt and no invitations", async () => {
  const db = new Database();
  const d = new Domain(db, true);
  try {
    await d.seed();
    const owner = (await db.get<User>("users", "demo-owner"))!;
    const admin = await db.put<User>("users", {
      ...owner,
      id: "test-admin",
      email: "marco.arevalo3426@gmail.com",
      role: "admin",
      storeId: undefined,
    });
    const userCount = (await db.list("users")).length;
    for (const actor of [owner, admin]) {
      const before = new Set(
        (await db.list<Voucher>("vouchers")).map((v) => v.id),
      );
      const draft = await d.generateDraft(actor, form);
      assert.equal(draft.payload.assignedEmail, actor.email);
      const checkout = await d.newCheckout(
        actor,
        "vouchers",
        draft.store,
        draft.payload,
        draft.total,
        actor.id,
      );
      const result = await d.fulfill(checkout.id, "cash in store");
      assert.equal(result.voucherCount, 2);
      assert.equal(result.assignedEmail, actor.email);
      assert.deepEqual(await d.fulfill(checkout.id, "cash in store"), result);
      const issued = (await db.list<Voucher>("vouchers")).filter(
        (v) => !before.has(v.id),
      );
      assert.equal(issued.length, 2);
      assert.ok(
        issued.every(
          (v) => v.email === actor.email && v.balance === form.amount,
        ),
      );
    }
    assert.equal((await db.list("users")).length, userCount);
    const jobs = await db.list<Job>("jobs");
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every((job) => job.subject === "Your Café voucher receipt"));
    const customer = (await db.get<User>("users", "demo-customer-user"))!;
    await assert.rejects(d.generateDraft(customer, form), /access/);
  } finally {
    await db.close();
  }
});

test("voucher API rejects multiple payment methods and requires cash confirmation", async () => {
  const db = new Database();
  const d = new Domain(db, true);
  try {
    await d.seed();
    await db.put("sessions", {
      id: digest("voucher-test-token"),
      userId: "demo-owner",
      expires: Date.now() + 60000,
    });
    const http = serverlessExpress({
      app: createApp(d, { origin: "https://cafe.example.com" }),
    });
    let sequence = 0;
    const post = async (extra: Record<string, unknown>) => {
      const response = (await http(
        {
          version: "2.0",
          routeKey: "$default",
          rawPath: "/api/checkout",
          rawQueryString: "",
          headers: {
            "content-type": "application/json",
            origin: "https://cafe.example.com",
            authorization: "Bearer voucher-test-token",
            "idempotency-key": `payment-${++sequence}`,
          },
          requestContext: { http: { method: "POST", sourceIp: "127.0.0.1" } },
          body: JSON.stringify({
            ...form,
            type: "vouchers",
            ...extra,
          }),
          isBase64Encoded: false,
        } as any,
        {} as any,
      )) as any;
      return { status: response.statusCode, body: JSON.parse(response.body) };
    };
    for (const payment of [["card", "cash"], "card,cash", null, "wallet"]) {
      const response = await post({ payment });
      assert.equal(response.status, 400);
      assert.equal(response.body.error, "Choose one payment method.");
    }
    assert.equal((await db.list("checkouts")).length, 0);
    assert.equal((await post({ payment: "cash" })).status, 403);
    const paid = await post({ payment: "cash", cashReceived: true });
    assert.equal(paid.status, 200);
    assert.equal(paid.body.result.voucherCount, 2);
    assert.equal(paid.body.result.assignedEmail, "owner@cafe.test");
    assert.equal((await db.list("jobs")).length, 1);
    assert.ok(!(await db.list<User>("users")).some((u) => !u.email));
  } finally {
    await db.close();
  }
});
