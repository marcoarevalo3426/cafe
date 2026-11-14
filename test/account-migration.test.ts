import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "./support/database";
import { Domain, digest } from "../server/domain";
import { migrateAccounts } from "../server/migrate-accounts";
import { createApp } from "../server/app";
import { accountChoices, testingAccountChoices } from "../src/account-choices";
import type { User, Voucher } from "../src/types";

test("retiring legacy organisation accounts preserves voucher value, assignments, reservations and paid checkout history", async () => {
  const db = new Database();
  const d = new Domain(db, true);
  try {
    await d.seed();
    const owner = (await db.get<User>("users", "demo-owner"))!;
    const legacy = {
      ...owner,
      id: "legacy-user",
      email: "legacy@example.com",
      role: "organisation",
      orgId: "legacy-company",
      storeId: undefined,
    };
    await db.put("users", legacy);
    await db.put("organisations", {
      id: "legacy-company",
      email: legacy.email,
      storeId: "demo-cafe",
    });
    await db.put("organisations", {
      id: "no-email",
      email: "",
      storeId: "demo-cafe",
    });
    await db.put("recipients", {
      id: "old-directory-entry",
      orgId: "legacy-company",
      email: "friend@example.com",
    });
    const expiresAt = Date.now() + 86400000;
    const credit = {
      id: "legacy-voucher",
      code: "old001",
      storeId: "demo-cafe",
      orgId: "legacy-company",
      balance: 1750,
      initialAmount: 2000,
      expiresAt,
      reservedBy: "pending-payment",
    };
    await db.put("vouchers", credit);
    await db.put("vouchers", {
      ...credit,
      id: "already-assigned",
      code: "old002",
      email: "existing@example.com",
      reservedBy: undefined,
    });
    await db.put("vouchers", {
      ...credit,
      id: "without-email",
      code: "old003",
      orgId: "no-email",
      reservedBy: undefined,
    });
    await db.put("sessions", {
      id: digest("legacy-token"),
      userId: legacy.id,
      activeRole: "organisation",
      expires: expiresAt,
    });
    const checkout = {
      id: "legacy-checkout",
      userId: owner.id,
      type: "vouchers",
      storeId: "demo-cafe",
      currency: "aud",
      amount: 1000,
      status: "pending",
      createdAt: Date.now(),
      key: "legacy",
      payload: {
        orgId: "legacy-company",
        orgName: "Legacy",
        orgEmail: legacy.email,
        quantity: 1,
        amount: 1000,
        expiresAt,
      },
    };
    await db.put("checkouts", checkout);
    await db.put("checkouts", {
      ...checkout,
      id: "completed-checkout",
      status: "fulfilled",
      result: { voucherCount: 1, organisation: { email: legacy.email } },
    });
    await db.put("jobs", {
      id: "old-invitation",
      subject: "Your Café organisation invitation",
    });
    const before = (await db.list<Voucher>("vouchers")).reduce(
      (sum, v) => sum + v.balance,
      0,
    );
    await migrateAccounts(db);
    assert.equal((await d.authenticate("legacy-token"))?.role, "customer");
    const migrated = (await db.get<any>("vouchers", credit.id))!;
    assert.equal(migrated.email, legacy.email);
    assert.equal(migrated.orgId, undefined);
    for (const field of [
      "balance",
      "initialAmount",
      "expiresAt",
      "reservedBy",
    ] as const)
      assert.equal(migrated[field], credit[field]);
    assert.equal(
      (await db.get<Voucher>("vouchers", "already-assigned"))!.email,
      "existing@example.com",
    );
    assert.equal(
      (await db.get<Voucher>("vouchers", "without-email"))!.email,
      owner.email,
    );
    assert.equal(
      (await db.list<Voucher>("vouchers")).reduce(
        (sum, v) => sum + v.balance,
        0,
      ),
      before,
    );
    assert.equal((await db.list("organisations")).length, 0);
    assert.equal((await db.list("recipients")).length, 0);
    assert.equal(await db.get("jobs", "old-invitation"), undefined);
    assert.ok(
      (await db.list<any>("legacy_archive")).some(
        (row) =>
          row.sourceKind === "vouchers" &&
          row.record.id === credit.id &&
          row.record.orgId === "legacy-company",
      ),
    );
    const completed = (await db.get<any>("checkouts", "completed-checkout"))!;
    assert.equal(completed.result.assignedEmail, legacy.email);
    assert.equal(completed.result.organisation, undefined);
    await migrateAccounts(db);
    assert.equal(
      (await db.get<Voucher>("vouchers", credit.id))!.balance,
      credit.balance,
    );
    const result = await d.fulfill(checkout.id, "card");
    assert.equal(result.assignedEmail, legacy.email);
    assert.equal(result.voucherCount, 1);
  } finally {
    await db.close();
  }
});

test("only Customer, Cafe Owner and allowlisted Admin remain; retired endpoints return JSON 404", async () => {
  const db = new Database();
  const d = new Domain(db, true);
  await d.seed();
  const server = createApp(d).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  try {
    assert.deepEqual(
      accountChoices({ user: null }).map((choice) => choice.role),
      ["owner", "customer"],
    );
    assert.deepEqual(
      testingAccountChoices({ user: null }).map((choice) => choice.role),
      ["customer", "owner"],
    );
    const session = await d.testingLogin("customer");
    const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
    for (const path of ["/recipients", "/vouchers/allocate"]) {
      const response = await fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.token}`,
        },
        body: "{}",
      });
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Not found." });
    }
    await assert.rejects(d.testingLogin("organisation"));
    const account = await db.put<User>("users", {
      ...session.user,
      id: "new-account",
      email: "new@example.com",
      role: undefined,
    });
    await assert.rejects(d.setRole(account, "organisation"));
    assert.ok(
      (await d.bootstrap(session.user)).vouchers.every((v) => !("orgId" in v)),
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
    await db.close();
  }
});
