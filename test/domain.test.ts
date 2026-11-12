import { test } from "node:test";
import assert from "node:assert/strict";
import { Database } from "../server/db";
import { Domain, type Checkout } from "../server/domain";
import type { User, Voucher, MenuItem, Order, Store } from "../src/types";
function setup() {
  const db = new Database(":memory:");
  const d = new Domain(db, true);
  d.seed();
  const owner = db.get<User>("users", "demo-owner")!,
    customer = db.get<User>("users", "demo-customer-user")!,
    org = db.get<User>("users", "demo-organisation-user")!;
  return { db, d, owner, customer, org };
}
function draft(d: Domain, customer: User, key = "order-1", quantity = 1) {
  const item = d.db.list<MenuItem>("menu")[0];
  return d.orderDraft(
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
test("OTP is six digits, stored hashed, expires after three minutes, and is single use", () => {
  const { d, db } = setup();
  const before = Date.now();
  const response = d.requestCode("NEW@EXAMPLE.COM");
  assert.match(response.developmentCode!, /^\d{6}$/);
  const row = db.sql
    .prepare("SELECT * FROM otp WHERE email=?")
    .get("new@example.com") as any;
  assert.notEqual(row.hash, response.developmentCode);
  assert.ok(
    row.expires >= before + 180000 && row.expires <= Date.now() + 180000,
  );
  assert.throws(() => d.verify("new@example.com", "incorrect"), /Invalid code/);
  const session = d.verify("new@example.com", response.developmentCode);
  assert.equal(d.authenticate(session.token)?.email, "new@example.com");
  assert.throws(
    () => d.verify("new@example.com", response.developmentCode),
    /Invalid code/,
  );
  d.logout(session.user);
  assert.equal(d.authenticate(session.token), null);
  db.close();
});
test("OTP attempt limit and expiry prevent brute-force login", () => {
  const { d, db } = setup();
  const r = d.requestCode("try@example.com");
  const wrong = r.developmentCode === "000000" ? "111111" : "000000";
  for (let i = 0; i < 5; i++)
    assert.throws(() => d.verify("try@example.com", wrong));
  assert.throws(
    () => d.verify("try@example.com", r.developmentCode),
    /Invalid code/,
  );
  const x = d.requestCode("old@example.com");
  db.sql
    .prepare("UPDATE otp SET expires=0 WHERE email=?")
    .run("old@example.com");
  assert.throws(
    () => d.verify("old@example.com", x.developmentCode),
    /Invalid code/,
  );
  assert.throws(() => d.requestCode("invalid"), /Invalid email address/);
  db.close();
});
test("admin role can only originate from verified allowed emails", () => {
  const { d, db } = setup();
  const r = d.requestCode("marco.arevalo3426@gmail.com");
  const admin = d.verify("marco.arevalo3426@gmail.com", r.developmentCode).user;
  assert.equal(admin.role, "admin");
  const normal = d.requestCode("someone@example.com");
  const user = d.verify("someone@example.com", normal.developmentCode).user;
  assert.throws(() => d.setRole(user, "admin"));
  assert.throws(() => d.setRole(admin, "owner"));
  db.close();
});
test("owner isolation rejects another cafe menu and order access", () => {
  const { d, db, customer, owner } = setup();
  assert.throws(() => d.ownedStore(customer, "demo-cafe"));
  const r = d.requestCode("another@example.com");
  let other = d.verify("another@example.com", r.developmentCode).user;
  other = d.db.atomic(() => d.setRole(other, "owner"));
  assert.throws(() => d.ownedStore(other, owner.storeId));
  const item = db.list<MenuItem>("menu")[0];
  assert.throws(() => d.saveMenu(other, { ...item }));
  assert.throws(() => d.completeOrder(other, db.list<Order>("orders")[0].id));
  db.close();
});
test("voucher generation enforces boundaries and generates 100 unique six-character codes exactly once", () => {
  const { d, db, owner } = setup();
  const b = {
    quantity: 100,
    amount: 1000,
    month: 12,
    year: new Date().getUTCFullYear() + 1,
    orgId: "demo-org",
  };
  assert.throws(() => d.generateDraft(owner, { ...b, quantity: 101 }));
  assert.throws(() => d.generateDraft(owner, { ...b, amount: 999 }));
  const g = d.generateDraft(owner, b);
  const c = d.newCheckout(
    owner,
    "vouchers",
    g.store,
    g.payload,
    g.total,
    "voucher-test",
  );
  d.db.atomic(() => d.fulfill(c.id, "cash"));
  d.db.atomic(() => d.fulfill(c.id, "cash"));
  const all = db.list<Voucher>("vouchers");
  assert.equal(all.length, 104);
  assert.equal(new Set(all.map((v) => v.code)).size, 104);
  all.forEach((v) => assert.match(v.code, /^[a-z0-9]{6}$/));
  db.close();
});
test("split voucher deductions are atomic, zero balances disappear, and repeat requests cannot double spend", () => {
  const { d, db, customer } = setup();
  const c = db.atomic(() => draft(d, customer, "one", 3));
  assert.equal(c.payload.total, 1560);
  assert.equal(c.payload.voucherAmount, 1560);
  assert.equal(c.amount, 0);
  const result = db.atomic(() => d.fulfill(c.id, "voucher")) as Order;
  assert.equal(result.total, 1560);
  const all = db
    .list<Voucher>("vouchers")
    .filter((v) => v.email === customer.email);
  assert.equal(all.length, 1);
  assert.equal(all[0].balance, 440);
  const same = db.atomic(() => draft(d, customer, "one", 3));
  assert.equal(same.id, c.id);
  assert.equal((db.atomic(() => d.fulfill(c.id)) as Order).id, result.id);
  assert.equal(
    db.list<Voucher>("vouchers").find((v) => v.email === customer.email)!
      .balance,
    440,
  );
  db.close();
});
test("pending checkout reserves vouchers, prevents sharing, and cancellation releases them", () => {
  const { d, db, customer } = setup();
  const c = db.atomic(() => draft(d, customer, "pending", 5));
  assert.equal(c.amount, 600);
  assert.equal(c.payload.voucherAmount, 2000);
  const v = db
    .list<Voucher>("vouchers")
    .find((v) => v.email === customer.email)!;
  assert.equal(v.reservedBy, c.id);
  assert.throws(() =>
    db.atomic(() =>
      d.share(customer, { id: v.id, email: "colleague@cafe.test" }),
    ),
  );
  const other = db.atomic(() => draft(d, customer, "second", 1));
  assert.equal(other.payload.voucherAmount, 0);
  db.atomic(() => d.cancelCheckout(c.id));
  assert.equal(db.get<Voucher>("vouchers", v.id)!.reservedBy, undefined);
  db.close();
});
test("cross-organisation sharing is rejected and same-organisation sharing transfers ownership", () => {
  const { d, db, customer } = setup();
  const v = db
    .list<Voucher>("vouchers")
    .find((v) => v.email === customer.email)!;
  assert.throws(
    () =>
      db.atomic(() =>
        d.share(customer, { id: v.id, email: "outsider@example.com" }),
      ),
    /same organisation/,
  );
  db.atomic(() =>
    d.share(customer, { id: v.id, email: "colleague@cafe.test" }),
  );
  assert.equal(db.get<Voucher>("vouchers", v.id)!.email, "colleague@cafe.test");
  assert.ok(!d.bootstrap(customer).vouchers.some((x) => x.id === v.id));
  db.close();
});
test("allocation cannot overwrite an allocated voucher, and recipient removal unlinks it", () => {
  const { d, db, org } = setup();
  const v = db.list<Voucher>("vouchers").find((v) => !v.email)!;
  db.atomic(() =>
    d.allocate(org, { ids: [v.id], email: "colleague@cafe.test" }),
  );
  assert.throws(() =>
    db.atomic(() =>
      d.allocate(org, { ids: [v.id], email: "customer@cafe.test" }),
    ),
  );
  const r = db
    .list<any>("recipients")
    .find((r) => r.email === "colleague@cafe.test");
  db.atomic(() => d.recipients(org, { action: "delete", ids: [r.id] }));
  assert.equal(db.get<Voucher>("vouchers", v.id)!.email, undefined);
  db.close();
});
test("prices and totals are calculated from the owner menu rather than customer input", () => {
  const { d, db, customer } = setup();
  const item = db.list<MenuItem>("menu")[0];
  const c = db.atomic(() =>
    d.orderDraft(
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
  assert.throws(() =>
    db.atomic(() =>
      d.orderDraft(
        customer,
        {
          storeId: "demo-cafe",
          lines: [{ itemId: item.id, quantity: 1, selections: {} }],
        },
        "bad",
      ),
    ),
  );
  db.close();
});
test("invalid bulk operations roll back all selected voucher changes", () => {
  const { d, db, owner } = setup();
  const v = db.list<Voucher>("vouchers")[0];
  assert.throws(() =>
    db.atomic(() => d.deleteVouchers(owner, [v.id, "missing"])),
  );
  assert.ok(db.get("vouchers", v.id));
  db.close();
});
test("cleanup removes expired linked vouchers and respects six-month and two-year order retention", () => {
  const { d, db } = setup();
  const v = db.list<Voucher>("vouchers")[0];
  db.put("vouchers", { ...v, expiresAt: 1 });
  const o = db.list<Order>("orders")[0];
  const eightMonthsAgo = new Date();
  eightMonthsAgo.setUTCMonth(eightMonthsAgo.getUTCMonth() - 8);
  db.put("orders", { ...o, createdAt: eightMonthsAgo.getTime() });
  d.cleanup();
  assert.equal(db.get("vouchers", v.id), undefined);
  assert.equal(db.get("orders", o.id), undefined);
  db.put("stores", { ...db.get<Store>("stores", "demo-cafe")!, tier: "paid" });
  db.put("orders", { ...o, createdAt: eightMonthsAgo.getTime() });
  d.cleanup();
  assert.ok(db.get("orders", o.id));
  db.close();
});
test("notification opt-out prevents new order push jobs", () => {
  const { d, db, owner, customer } = setup();
  db.put("users", { ...owner, orderNotifications: false });
  const c = db.atomic(() => draft(d, customer));
  db.atomic(() => d.fulfill(c.id));
  assert.equal(db.list<any>("jobs").filter((j) => j.type === "push").length, 0);
  db.close();
});
test("email changes require OTP and preserve linked vouchers after successful verification", () => {
  const { d, db, customer } = setup();
  const r = d.changeEmailRequest(customer, "updated@example.com");
  assert.throws(() => d.changeEmailVerify(customer, "wrong"));
  const updated = d.changeEmailVerify(customer, r.developmentCode);
  assert.equal(updated.email, "updated@example.com");
  assert.equal(
    db.list<Voucher>("vouchers").filter((v) => v.email === updated.email)
      .length,
    2,
  );
  db.close();
});
test("expired vouchers remain reserved until the provider checkout is resolved", () => {
  const { d, db, customer } = setup();
  const c = db.atomic(() => draft(d, customer, "late-provider", 5));
  db.put("checkouts", {
    ...c,
    stripeId: "cs_test_delayed",
    createdAt: Date.now() - 26 * 3600000,
  });
  const v = db.list<Voucher>("vouchers").find((v) => v.reservedBy === c.id)!;
  db.put("vouchers", { ...v, expiresAt: Date.now() - 1000 });
  d.cleanup();
  assert.ok(db.get<Voucher>("vouchers", v.id));
  assert.equal(db.get<Checkout>("checkouts", c.id)!.status, "pending");
  db.atomic(() => d.cancelCheckout(c.id));
  d.cleanup();
  assert.equal(db.get("vouchers", v.id), undefined);
  db.close();
});
