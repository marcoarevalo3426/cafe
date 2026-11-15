import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "./support/database";
import { Domain, type Checkout } from "../server/domain";
import { createApp } from "../server/app";
import { cartVoucherBalance } from "../src/cart-payment";
import type { MenuItem, User, Voucher, Order } from "../src/types";

async function setup(t: { after: (fn: () => Promise<void>) => void }) {
  const db = new Database();
  t.after(() => db.close());
  const d = new Domain(db, true);
  await d.seed();
  const customer = (await db.get<User>("users", "demo-customer-user"))!;
  const owner = (await db.get<User>("users", "demo-owner"))!;
  const source = await db.put<Voucher>("vouchers", {
    id: "bearer-voucher",
    code: "bearer",
    storeId: "demo-cafe",
    email: "someone-else@example.com",
    balance: 2500,
    initialAmount: 2500,
    expiresAt: Date.now() + 86400000,
  });
  const item = (await db.list<MenuItem>("menu"))[0];
  const order = {
    orderName: "Taylor",
    storeId: "demo-cafe",
    useVouchers: true,
    voucherCode: "bearer",
    lines: [
      {
        itemId: item.id,
        quantity: 1,
        selections: Object.fromEntries(
          item.groups.map((g) => [g.id, g.variations[0].id]),
        ),
      },
    ],
  };
  const generation = {
    storeId: "demo-cafe",
    quantity: 2,
    amount: 1000,
    month: 12,
    year: new Date().getUTCFullYear() + 1,
    useVouchers: true,
    voucherCode: "bearer",
  };
  return { db, d, customer, owner, source, order, generation };
}

test("verification accepts allocated and unallocated bearer codes, normalizes input, and returns no recipient details", async (t) => {
  const { db, d, customer, owner, source } = await setup(t);
  for (const actor of [customer, owner]) {
    const verified = await d.verifyVoucher(actor, " BEARER ", "demo-cafe");
    assert.deepEqual(verified, {
      id: source.id,
      code: source.code,
      storeId: source.storeId,
      balance: 2500,
      expiresAt: source.expiresAt,
      currency: "AUD",
    });
    assert.equal(
      (await db.get<Voucher>("vouchers", source.id))!.email,
      actor.email,
    );
  }
  await db.put("vouchers", { ...source, email: undefined });
  assert.equal(
    (await d.verifyVoucher(customer, "bearer", "demo-cafe")).balance,
    2500,
  );
  for (const invalid of ["", "missing", "absent", {}, null])
    await assert.rejects(
      d.verifyVoucher(customer, invalid, "demo-cafe"),
      /Invalid voucher/,
    );
  for (const changed of [
    { balance: 0 },
    { expiresAt: Date.now() - 1 },
    { reservedBy: "other-checkout" },
    { storeId: "another-cafe" },
  ]) {
    await db.put("vouchers", { ...source, ...changed });
    await assert.rejects(
      d.verifyVoucher(customer, "bearer", "demo-cafe"),
      /Invalid voucher/,
    );
    assert.equal(
      (await db.get<Voucher>("vouchers", source.id))!.email,
      source.email,
    );
  }
});

test("verified vouchers belong to the signed-in account and remain in its wallet without a role restriction", async (t) => {
  const { db, d, source } = await setup(t);
  const customer = (await db.get<User>("users", "demo-customer-user"))!;
  const unselected = await db.put<User>("users", {
    ...customer,
    id: "unselected-account",
    email: "new@example.com",
    role: undefined,
  });
  for (const account of [customer, unselected]) {
    const verified = await d.verifyVoucher(
      account,
      source.code,
      source.storeId,
    );
    const assigned = (await db.get<Voucher>("vouchers", source.id))!;
    assert.equal(assigned.email, account.email);
    assert.equal(assigned.balance, source.balance);
    assert.equal(assigned.expiresAt, source.expiresAt);
    // Selecting Customer later exposes the persisted claim without retyping it.
    const wallet = await d.bootstrap({ ...account, role: "customer" });
    assert.ok(wallet.vouchers.some((v) => v.id === source.id));
    assert.deepEqual(
      await d.verifyVoucher(account, source.code, source.storeId),
      verified,
    );
  }
  await db.put("users", { ...unselected, disabled: true });
  await assert.rejects(
    d.verifyVoucher(unselected, source.code, source.storeId),
    /sign in to verify/,
  );
  assert.equal(
    (await db.get<Voucher>("vouchers", source.id))!.email,
    unselected.email,
  );
});

test("customer checkout spends another recipient's code without transferring ownership or double counting an own code", async (t) => {
  const { db, d, customer, source, order } = await setup(t);
  for (const v of await db.list<Voucher>("vouchers"))
    if (v.email === customer.email) await db.delete("vouchers", v.id);
  const c = await d.orderDraft(customer, order, "bearer-order");
  assert.equal(c.amount, 0);
  assert.equal(
    (await db.get<Voucher>("vouchers", source.id))!.reservedBy,
    c.id,
  );
  const result = await d.fulfill(c.id, "voucher");
  const remaining = (await db.get<Voucher>("vouchers", source.id))!;
  assert.equal(remaining.balance, source.balance - c.payload.total);
  assert.equal(remaining.email, source.email);
  assert.equal(remaining.reservedBy, undefined);
  assert.deepEqual(await d.fulfill(c.id, "voucher"), result);
  assert.equal(
    (await db.get<Voucher>("vouchers", source.id))!.balance,
    remaining.balance,
  );
  await db.put("vouchers", { ...remaining, email: customer.email });
  const own = await d.orderDraft(customer, order, "own-code");
  assert.equal(own.payload.allocations.length, 1);
  assert.equal(
    own.payload.voucherAmount,
    Math.min(remaining.balance, own.payload.total),
  );
});

test("HTTP verification claims a voucher without the generic role-access error and refreshes the customer's wallet", async (t) => {
  const { db, d, source } = await setup(t);
  const server = createApp(d).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  try {
    const email = "claimant@example.com";
    const code = await d.requestCode(email);
    const login = await d.verify(email, code.developmentCode!);
    const response = await fetch(`${base}/vouchers/verify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${login.token}`,
      },
      body: JSON.stringify({
        code: source.code,
        storeId: source.storeId,
        email: "someone-else@example.com",
      }),
    });
    assert.equal(response.status, 200);
    const verified = await response.json();
    assert.equal(verified.balance, source.balance);
    assert.equal(verified.email, undefined);
    assert.equal((await db.get<Voucher>("vouchers", source.id))!.email, email);
    await d.chooseAccount(login.user, "customer", login.token);
    const wallet = await (
      await fetch(`${base}/bootstrap`, {
        headers: { Authorization: `Bearer ${login.token}` },
      })
    ).json();
    assert.ok(
      wallet.vouchers.some(
        (v: Voucher) => v.id === source.id && v.email === email,
      ),
    );
    assert.equal(
      wallet.vouchers.filter((v: Voucher) => v.id === source.id).length,
      1,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

test("verified vouchers complete cart checkout in Owner, Admin and unselected sessions without a role-access error", async (t) => {
  const { db, d, source, order } = await setup(t);
  const server = createApp(d).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  try {
    let expectedBalance = source.balance;
    for (const [email, role] of [
      ["marco.arevalo3426@gmail.com", "owner"],
      ["marevalo@nepgroup.com", "admin"],
      ["unselected@example.com", undefined],
    ] as const) {
      const code = await d.requestCode(email);
      const login = await d.verify(email, code.developmentCode!);
      if (role) await d.chooseAccount(login.user, role, login.token);
      const post = (path: string, body: unknown) =>
        fetch(base + path, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${login.token}`,
            "Idempotency-Key": `order-${email}`,
          },
          body: JSON.stringify(body),
        });
      const verify = await post("/vouchers/verify", {
        code: source.code,
        storeId: source.storeId,
      });
      assert.equal(verify.status, 200);
      assert.equal(
        (await db.get<Voucher>("vouchers", source.id))!.email,
        email,
      );
      const request = { ...order, type: "order", payment: "card" };
      const response = await post("/checkout", request);
      const data = await response.json();
      assert.equal(response.status, 200, JSON.stringify(data));
      assert.equal(data.result.userId, login.user.id);
      assert.equal(data.result.voucherAmount, data.result.total);
      assert.equal(data.result.payment, "voucher");
      expectedBalance -= data.result.total;
      assert.equal(
        (await db.get<Voucher>("vouchers", source.id))!.balance,
        expectedBalance,
      );
      const retried = await post("/checkout", request);
      assert.equal(retried.status, 200);
      assert.equal((await retried.json()).result.id, data.result.id);
      assert.equal(
        (await db.get<Voucher>("vouchers", source.id))!.balance,
        expectedBalance,
      );
      assert.equal((await d.authenticate(login.token))?.role, role);
    }
    assert.equal(
      (await db.list<Order>("orders")).filter(
        (row) => row.payment === "voucher",
      ).length,
      3,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});

test("cart checkout still requires a live account and rejects an invalid voucher", async (t) => {
  const { db, d, customer, order } = await setup(t);
  await assert.rejects(
    d.orderDraft(customer, { ...order, voucherCode: "absent" }, "bad-code"),
    /Invalid voucher/,
  );
  await db.put("users", { ...customer, disabled: true });
  await assert.rejects(
    d.orderDraft(customer, order, "disabled"),
    /sign in to place an order/,
  );
  await assert.rejects(
    d.orderDraft({ ...customer, id: "missing-user" }, order, "missing"),
    /sign in to place an order/,
  );
});

test("partial verified voucher credit matches the card remainder and only that credit is consumed", async (t) => {
  const { db, d, customer, source, order } = await setup(t);
  for (const voucher of await db.list<Voucher>("vouchers"))
    if (voucher.email === customer.email)
      await db.delete("vouchers", voucher.id);
  await db.put("vouchers", { ...source, balance: 100 });
  const verified = await d.verifyVoucher(customer, source.code, source.storeId);
  const balance = cartVoucherBalance(
    [],
    source.storeId,
    customer.email,
    "",
    Date.now(),
    verified,
  );
  const checkout = await d.orderDraft(customer, order, "split-verified-code");
  assert.equal(balance, 100);
  assert.ok(checkout.payload.total > balance);
  assert.equal(checkout.payload.voucherAmount, balance);
  assert.equal(checkout.amount, checkout.payload.total - balance);
  const result = await d.fulfill(checkout.id, "card");
  assert.equal(result.voucherAmount, balance);
  assert.equal(await db.get("vouchers", source.id), undefined);
});

test("owner voucher purchases reserve and spend existing credit once, conserving value", async (t) => {
  const { db, d, owner, source, generation } = await setup(t);
  const before = (await db.list<Voucher>("vouchers")).reduce(
    (s, v) => s + v.balance,
    0,
  );
  const draft = await d.generateDraft(owner, generation);
  const c = await d.newCheckout(
    owner,
    "vouchers",
    draft.store,
    draft.payload,
    draft.total,
    "voucher-purchase",
  );
  assert.equal(c.amount, 0);
  assert.equal(
    (await db.get<Voucher>("vouchers", source.id))!.reservedBy,
    c.id,
  );
  const result = await d.fulfill(c.id, "voucher");
  assert.equal(result.voucherCount, 2);
  assert.deepEqual(await d.fulfill(c.id), result);
  const vouchers = await db.list<Voucher>("vouchers");
  assert.equal(
    vouchers.reduce((s, v) => s + v.balance, 0),
    before,
  );
  assert.equal((await db.get<Voucher>("vouchers", source.id))!.balance, 500);
});

test("partial credit is reserved until payment, cancellation releases it, and stale verification cannot spend it twice", async (t) => {
  const { db, d, owner, source, generation } = await setup(t);
  await db.put("vouchers", { ...source, balance: 500 });
  const verified = await d.verifyVoucher(owner, "bearer", "demo-cafe");
  assert.equal(verified.balance, 500);
  const draft = await d.generateDraft(owner, generation);
  const outcomes = await Promise.allSettled(
    ["a", "b"].map((key) =>
      d.newCheckout(
        owner,
        "vouchers",
        draft.store,
        draft.payload,
        draft.total,
        key,
      ),
    ),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((r) => r.status === "rejected").length, 1);
  const c = (
    outcomes.find(
      (r) => r.status === "fulfilled",
    ) as PromiseFulfilledResult<Checkout>
  ).value;
  assert.equal(c.amount, 1500);
  assert.equal(c.payload.voucherAmount, 500);
  await assert.rejects(d.generateDraft(owner, generation), /Invalid voucher/);
  await d.cancelCheckout(c.id);
  assert.equal(
    (await db.get<Voucher>("vouchers", source.id))!.reservedBy,
    undefined,
  );
  assert.equal((await db.get<Voucher>("vouchers", source.id))!.balance, 500);
  await db.put("vouchers", { ...source, balance: 0 });
  await assert.rejects(d.generateDraft(owner, generation), /Invalid voucher/);
});

test("failed fulfillment rolls back new vouchers when reserved source credit is unavailable", async (t) => {
  const { db, d, owner, source, generation } = await setup(t);
  const draft = await d.generateDraft(owner, generation);
  const c = await d.newCheckout(
    owner,
    "vouchers",
    draft.store,
    draft.payload,
    draft.total,
    "rollback",
  );
  await db.delete("vouchers", source.id);
  const before = await db.list("vouchers");
  await assert.rejects(d.fulfill(c.id, "voucher"), /no longer available/);
  assert.deepEqual(await db.list("vouchers"), before);
  assert.equal((await db.get<Checkout>("checkouts", c.id))!.status, "pending");
});

test("HTTP verification requires login and owner checkout can be funded by a verified code without card configuration", async (t) => {
  const { db, d, owner, generation } = await setup(t);
  const server = createApp(d).listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.on("listening", r));
  // Close HTTP requests before the database registered in setup's after hook.
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}/api`;
    const otp = await d.requestCode(owner.email);
    const login = await d.verify(owner.email, otp.developmentCode!);
    const post = (path: string, body: unknown, token = login.token) =>
      fetch(base + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "Idempotency-Key": "http-code-purchase",
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (
        await post(
          "/vouchers/verify",
          { code: "bearer", storeId: "demo-cafe" },
          "",
        )
      ).status,
      401,
    );
    const verification = await post("/vouchers/verify", {
      code: "bearer",
      storeId: "demo-cafe",
    });
    assert.equal(verification.status, 200);
    assert.equal((await verification.json()).email, undefined);
    const invalid = await post("/vouchers/verify", {
      code: "absent",
      storeId: "demo-cafe",
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error, "Invalid voucher.");
    const response = await post("/checkout", {
      ...generation,
      type: "vouchers",
      payment: "voucher",
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).result.voucherCount, 2);
    assert.equal(
      (await db.get<Voucher>("vouchers", "bearer-voucher"))!.balance,
      500,
    );
    const retry = await post("/checkout", {
      ...generation,
      type: "vouchers",
      payment: "voucher",
    });
    assert.equal(retry.status, 200);
    assert.equal(
      (await db.get<Voucher>("vouchers", "bearer-voucher"))!.balance,
      500,
    );
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
