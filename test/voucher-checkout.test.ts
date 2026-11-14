import { test } from "node:test";
import assert from "node:assert/strict";
import serverlessExpress from "@codegenie/serverless-express";
import { Database } from "./support/database";
import { Domain, digest, type Job } from "../server/domain";
import { createApp } from "../server/app";
import type { Organisation, User, Voucher } from "../src/types";

const form = {
  quantity: 2,
  amount: 1000,
  month: 12,
  year: new Date().getUTCFullYear() + 1,
  storeId: "demo-cafe",
};
test("owner and admin can issue vouchers without an organisation email, account or outgoing email", async () => {
  const db = new Database();
  const d = new Domain(db, true);
  try {
    await d.seed();
    const owner = (await db.get<User>("users", "demo-owner"))!;
    const admin = await db.put<User>("users", {
      id: "test-admin",
      email: "marco.arevalo3426@gmail.com",
      role: "admin",
      name: "Admin",
      phone: "",
      orderNotifications: false,
      announcements: false,
    });
    const userCount = (await db.list("users")).length;
    const organisations: string[] = [];
    for (const [index, actor] of [owner, admin, owner].entries()) {
      const result = await db.atomic(async () => {
        const draft = await d.generateDraft(actor, {
          ...form,
          orgName: `Company ${index}`,
          ...(index === 1 ? { orgEmail: "   " } : {}),
        });
        assert.equal(draft.payload.orgEmail, "");
        const c = await d.newCheckout(
          actor,
          "vouchers",
          draft.store,
          draft.payload,
          draft.total,
          `no-email-${index}`,
        );
        return d.fulfill(c.id, "cash in store");
      });
      assert.equal(result.voucherCount, 2);
      assert.equal(result.organisation.email, "");
      organisations.push(result.organisation.id);
    }
    assert.equal(new Set(organisations).size, 3);
    assert.equal((await db.list("users")).length, userCount);
    assert.equal((await db.list("jobs")).length, 0);
    await db.atomic(async () => {
      const draft = await d.generateDraft(owner, {
        ...form,
        orgId: organisations[0],
      });
      const c = await d.newCheckout(
        owner,
        "vouchers",
        draft.store,
        draft.payload,
        draft.total,
        "existing-no-email",
      );
      await d.fulfill(c.id, "cash in store");
    });
    assert.equal(
      (await db.list<Voucher>("vouchers")).filter(
        (v) => v.orgId === organisations[0],
      ).length,
      4,
    );
    assert.equal((await db.list("users")).length, userCount);
    assert.equal((await db.list("jobs")).length, 0);
    const other = await db.put("stores", {
      ...(await db.get<any>("stores", "demo-cafe")),
      id: "other-cafe",
    });
    await assert.doesNotReject(
      d.generateDraft(admin, {
        ...form,
        storeId: other.id,
        orgName: "Another blank email",
      }),
    );
  } finally {
    await db.close();
  }
});

test("a supplied organisation email is validated and still receives invitation and receipt", async () => {
  const db = new Database();
  const d = new Domain(db, true);
  try {
    await d.seed();
    const owner = (await db.get<User>("users", "demo-owner"))!;
    await assert.rejects(
      d.generateDraft(owner, {
        ...form,
        orgName: "Company",
        orgEmail: "invalid",
      }),
      /Invalid email/,
    );
    await db.atomic(async () => {
      const draft = await d.generateDraft(owner, {
        ...form,
        orgName: "Company",
        orgEmail: " invite@example.com ",
      });
      const c = await d.newCheckout(
        owner,
        "vouchers",
        draft.store,
        draft.payload,
        draft.total,
        "with-email",
      );
      await d.fulfill(c.id, "cash in store");
    });
    const organisation = (await db.list<Organisation>("organisations")).find(
      (o) => o.email === "invite@example.com",
    )!;
    assert.ok(organisation);
    const account = (await db.list<User>("users")).find(
      (u) => u.email === organisation.email,
    )!;
    assert.equal(account.role, "organisation");
    assert.equal(account.orgId, organisation.id);
    const jobs = await db.list<Job>("jobs");
    assert.equal(jobs.length, 2);
    assert.ok(jobs.every((j) => j.to === organisation.email));
    assert.equal((await db.list("otp")).length, 0);
  } finally {
    await db.close();
  }
});

test("voucher API rejects multiple payment methods and requires cash confirmation with an optional email", async () => {
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
            orgName: "No email company",
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
    assert.equal(paid.body.result.organisation.email, "");
    assert.equal((await db.list("jobs")).length, 0);
    assert.ok(!(await db.list<User>("users")).some((u) => !u.email));
  } finally {
    await db.close();
  }
});
