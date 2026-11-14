import { validity } from "../src/types";
import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "./support/database";
import { Domain, type Checkout } from "../server/domain";
import type { User, Voucher, MenuItem, Order, Store } from "../src/types";
async function setup() {
  const db = new Database(":memory:");
  const d = new Domain(db, true);
  await d.seed();
  const owner = (await db.get<User>("users", "demo-owner"))!,
    customer = (await db.get<User>("users", "demo-customer-user"))!,
    org = (await db.get<User>("users", "demo-organisation-user"))!;
  return { db, d, owner, customer, org };
}
async function draft(d: Domain, customer: User, key = "order-1", quantity = 1) {
  const item = (await d.db.list<MenuItem>("menu"))[0];
  return await d.orderDraft(
    customer,
    {
      storeId: "demo-cafe",
      useVouchers: true,
      lines: [
        {
          itemId: item.id,
          selections: Object.fromEntries(
            item.groups.map((g) => [g.id, g.variations[0].id]),
          ),
          quantity,
          note: "No sugar",
        },
      ],
    },
    key,
  );
}
test("OTP is six digits, stored hashed, expires after three minutes, and is single use", async () => {
  const { d, db } = await setup();
  const before = Date.now();
  const response = await d.requestCode("NEW@EXAMPLE.COM");
  assert.match(response.developmentCode!, /^\d{6}$/);
  const row = await db.get<any>("otp", "new@example.com");
  assert.notEqual(row.hash, response.developmentCode);
  assert.ok(
    row.expires >= before + 180000 && row.expires <= Date.now() + 180000,
  );
  await assert.rejects(
    async () => await d.verify("new@example.com", "incorrect"),
    /Invalid code/,
  );
  const session = await d.verify("new@example.com", response.developmentCode);
  assert.equal((await d.authenticate(session.token))?.email, "new@example.com");
  await assert.rejects(
    async () => await d.verify("new@example.com", response.developmentCode),
    /Invalid code/,
  );
  await d.logout(session.user);
  assert.equal(await d.authenticate(session.token), null);
  await db.close();
});
test("OTP attempt limit and expiry prevent brute-force login", async () => {
  const { d, db } = await setup();
  const r = await d.requestCode("try@example.com");
  const wrong = r.developmentCode === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    await assert.rejects(async () => await d.verify("try@example.com", wrong));
  await assert.rejects(
    async () => await d.verify("try@example.com", r.developmentCode),
    /Invalid code/,
  );
  const x = await d.requestCode("old@example.com");
  await db.put("otp", {
    ...(await db.get<any>("otp", "old@example.com"))!,
    expires: 0,
  });
  await assert.rejects(
    async () => await d.verify("old@example.com", x.developmentCode),
    /Invalid code/,
  );
  await assert.rejects(
    async () => await d.requestCode("invalid"),
    /Invalid email address/,
  );
  await db.close();
});
test("admin role can only originate from verified allowed emails", async () => {
  const { d, db } = await setup();
  const r = await d.requestCode("marco.arevalo3426@gmail.com");
  const admin = (
    await d.verify("marco.arevalo3426@gmail.com", r.developmentCode)
  ).user;
  assert.equal(admin.role, "admin");
  const normal = await d.requestCode("someone@example.com");
  const user = (await d.verify("someone@example.com", normal.developmentCode))
    .user;
  await assert.rejects(async () => await d.setRole(user, "admin"));
  await assert.rejects(async () => await d.setRole(admin, "owner"));
  await db.close();
});
test("owner isolation rejects another cafe menu and order access", async () => {
  const { d, db, customer, owner } = await setup();
  await assert.rejects(async () => await d.ownedStore(customer, "demo-cafe"));
  const r = await d.requestCode("another@example.com");
  let other = (await d.verify("another@example.com", r.developmentCode)).user;
  other = await d.db.atomic(async () => await d.setRole(other, "owner"));
  await assert.rejects(async () => await d.ownedStore(other, owner.storeId));
  const item = (await db.list<MenuItem>("menu"))[0];
  await assert.rejects(async () => await d.saveMenu(other, { ...item }));
  await assert.rejects(
    async () =>
      await d.completeOrder(other, (await db.list<Order>("orders"))[0].id),
  );
  await db.close();
});
test("voucher generation enforces boundaries and generates 100 unique six-character codes exactly once", async () => {
  const { d, db, owner } = await setup();
  const b = {
    quantity: 100,
    amount: 1000,
    month: 12,
    year: new Date().getUTCFullYear() + 1,
    orgId: "demo-org",
  };
  await assert.rejects(
    async () => await d.generateDraft(owner, { ...b, quantity: 101 }),
  );
  await assert.rejects(
    async () => await d.generateDraft(owner, { ...b, amount: 999 }),
  );
  const g = await d.generateDraft(owner, b);
  const c = await d.newCheckout(
    owner,
    "vouchers",
    g.store,
    g.payload,
    g.total,
    "voucher-test",
  );
  await d.db.atomic(async () => await d.fulfill(c.id, "cash"));
  await d.db.atomic(async () => await d.fulfill(c.id, "cash"));
  const all = await db.list<Voucher>("vouchers");
  assert.equal(all.length, 104);
  assert.equal(new Set(all.map((v) => v.code)).size, 104);
  all.forEach((v) => assert.match(v.code, /^[a-z0-9]{6}$/));
  await db.close();
});
test("split voucher deductions are atomic, zero balances disappear, and repeat requests cannot double spend", async () => {
  const { d, db, customer } = await setup();
  const c = await db.atomic(async () => await draft(d, customer, "one", 3));
  assert.equal(c.payload.total, 1560);
  assert.equal(c.payload.voucherAmount, 1560);
  assert.equal(c.amount, 0);
  const result = (await db.atomic(
    async () => await d.fulfill(c.id, "voucher"),
  )) as Order;
  assert.equal(result.total, 1560);
  const all = (await db.list<Voucher>("vouchers")).filter(
    (v) => v.email === customer.email,
  );
  assert.equal(all.length, 1);
  assert.equal(all[0].balance, 440);
  const same = await db.atomic(async () => await draft(d, customer, "one", 3));
  assert.equal(same.id, c.id);
  assert.equal(
    ((await db.atomic(async () => await d.fulfill(c.id))) as Order).id,
    result.id,
  );
  assert.equal(
    (await db.list<Voucher>("vouchers")).find(
      (v) => v.email === customer.email,
    )!.balance,
    440,
  );
  await db.close();
});
test("pending checkout reserves vouchers, prevents sharing, and cancellation releases them", async () => {
  const { d, db, customer } = await setup();
  const c = await db.atomic(async () => await draft(d, customer, "pending", 5));
  assert.equal(c.amount, 600);
  assert.equal(c.payload.voucherAmount, 2000);
  const v = (await db.list<Voucher>("vouchers")).find(
    (v) => v.email === customer.email,
  )!;
  assert.equal(v.reservedBy, c.id);
  await assert.rejects(
    async () =>
      await db.atomic(
        async () =>
          await d.share(customer, { id: v.id, email: "colleague@cafe.test" }),
      ),
  );
  const other = await db.atomic(
    async () => await draft(d, customer, "second", 1),
  );
  assert.equal(other.payload.voucherAmount, 0);
  await db.atomic(async () => await d.cancelCheckout(c.id));
  assert.equal(
    (await db.get<Voucher>("vouchers", v.id))!.reservedBy,
    undefined,
  );
  await db.close();
});
test("cross-organisation sharing is rejected and same-organisation sharing transfers ownership", async () => {
  const { d, db, customer } = await setup();
  const v = (await db.list<Voucher>("vouchers")).find(
    (v) => v.email === customer.email,
  )!;
  await assert.rejects(
    async () =>
      await db.atomic(
        async () =>
          await d.share(customer, { id: v.id, email: "outsider@example.com" }),
      ),
    /same organisation/,
  );
  await db.atomic(
    async () =>
      await d.share(customer, { id: v.id, email: "colleague@cafe.test" }),
  );
  assert.equal(
    (await db.get<Voucher>("vouchers", v.id))!.email,
    "colleague@cafe.test",
  );
  assert.ok(!(await d.bootstrap(customer)).vouchers.some((x) => x.id === v.id));
  await db.close();
});
test("allocation cannot overwrite an allocated voucher, and recipient removal unlinks it", async () => {
  const { d, db, org } = await setup();
  const v = (await db.list<Voucher>("vouchers")).find((v) => !v.email)!;
  await db.atomic(
    async () =>
      await d.allocate(org, { ids: [v.id], email: "colleague@cafe.test" }),
  );
  await assert.rejects(
    async () =>
      await db.atomic(
        async () =>
          await d.allocate(org, { ids: [v.id], email: "customer@cafe.test" }),
      ),
  );
  const r = (await db.list<any>("recipients")).find(
    (r) => r.email === "colleague@cafe.test",
  );
  await db.atomic(
    async () => await d.recipients(org, { action: "delete", ids: [r.id] }),
  );
  assert.equal((await db.get<Voucher>("vouchers", v.id))!.email, undefined);
  await db.close();
});
test("prices and totals are calculated from the owner menu rather than customer input", async () => {
  const { d, db, customer } = await setup();
  const item = (await db.list<MenuItem>("menu"))[0];
  const c = await db.atomic(
    async () =>
      await d.orderDraft(
        customer,
        {
          storeId: "demo-cafe",
          total: 1,
          lines: [
            {
              itemId: item.id,
              quantity: 2,
              note: "",
              unitAmount: 1,
              selections: {
                [item.groups[0].id]: item.groups[0].variations[0].id,
              },
            },
          ],
        },
        "price",
      ),
  );
  assert.equal(c.amount, 1040);
  await assert.rejects(
    async () =>
      await db.atomic(
        async () =>
          await d.orderDraft(
            customer,
            {
              storeId: "demo-cafe",
              lines: [{ itemId: item.id, quantity: 1, selections: {} }],
            },
            "bad",
          ),
      ),
  );
  await db.close();
});
test("invalid bulk operations roll back all selected voucher changes", async () => {
  const { d, db, owner } = await setup();
  const v = (await db.list<Voucher>("vouchers"))[0];
  await assert.rejects(
    async () =>
      await db.atomic(
        async () => await d.deleteVouchers(owner, [v.id, "missing"]),
      ),
  );
  assert.ok(await db.get("vouchers", v.id));
  await db.close();
});
test("cleanup removes expired linked vouchers and respects six-month and two-year order retention", async () => {
  const { d, db } = await setup();
  const v = (await db.list<Voucher>("vouchers"))[0];
  await db.put("vouchers", { ...v, expiresAt: 1 });
  const o = (await db.list<Order>("orders"))[0];
  const eightMonthsAgo = new Date();
  eightMonthsAgo.setUTCMonth(eightMonthsAgo.getUTCMonth() - 8);
  await db.put("orders", { ...o, createdAt: eightMonthsAgo.getTime() });
  await d.cleanup();
  assert.equal(await db.get("vouchers", v.id), undefined);
  assert.equal(await db.get("orders", o.id), undefined);
  await db.put("stores", {
    ...(await db.get<Store>("stores", "demo-cafe"))!,
    tier: "paid",
  });
  await db.put("orders", { ...o, createdAt: eightMonthsAgo.getTime() });
  await d.cleanup();
  assert.ok(await db.get("orders", o.id));
  await db.close();
});
test("notification opt-out prevents new order push jobs", async () => {
  const { d, db, owner, customer } = await setup();
  await db.put("users", { ...owner, orderNotifications: false });
  const c = await db.atomic(async () => await draft(d, customer));
  await db.atomic(async () => await d.fulfill(c.id));
  assert.equal(
    (await db.list<any>("jobs")).filter((j) => j.type === "push").length,
    0,
  );
  await db.close();
});
test("email changes require OTP and preserve linked vouchers after successful verification", async () => {
  const { d, db, customer } = await setup();
  const r = await d.changeEmailRequest(customer, "updated@example.com");
  await assert.rejects(
    async () => await d.changeEmailVerify(customer, "wrong"),
  );
  const updated = await d.changeEmailVerify(customer, r.developmentCode);
  assert.equal(updated.email, "updated@example.com");
  assert.equal(
    (await db.list<Voucher>("vouchers")).filter(
      (v) => v.email === updated.email,
    ).length,
    2,
  );
  await db.close();
});
test("expired vouchers remain reserved until the provider checkout is resolved", async () => {
  const { d, db, customer } = await setup();
  const c = await db.atomic(
    async () => await draft(d, customer, "late-provider", 5),
  );
  await db.put("checkouts", {
    ...c,
    stripeId: "cs_test_delayed",
    createdAt: Date.now() - 26 * 3600000,
  });
  const v = (await db.list<Voucher>("vouchers")).find(
    (v) => v.reservedBy === c.id,
  )!;
  await db.put("vouchers", { ...v, expiresAt: Date.now() - 1000 });
  await d.cleanup();
  assert.ok(await db.get<Voucher>("vouchers", v.id));
  assert.equal((await db.get<Checkout>("checkouts", c.id))!.status, "pending");
  await db.atomic(async () => await d.cancelCheckout(c.id));
  await d.cleanup();
  assert.equal(await db.get("vouchers", v.id), undefined);
  await db.close();
});

test("voucher validity displays the selected month at its exclusive UTC expiry boundary", () => {
  assert.equal(validity(Date.UTC(2027, 11, 1)), "11/27");
  assert.equal(validity(Date.UTC(2028, 0, 1)), "12/27");
});
