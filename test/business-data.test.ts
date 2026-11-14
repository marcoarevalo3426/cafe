import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareBusinessData } from "../scripts/test-business-data";

test("database publication keeps business values while excluding local auth, queued mail and provider credentials", () => {
  const data = prepareBusinessData({
    users: [
      {
        id: "user",
        email: "test@example.com",
        role: "customer",
        stripeCustomer: "local-provider-customer",
        password: "private",
      },
    ],
    vouchers: [
      {
        id: "credit",
        code: "abc123",
        balance: 1234,
        initialAmount: 2000,
        email: "test@example.com",
        reservedBy: "unfinished-local-payment",
      },
    ],
    checkouts: [
      { id: "pending", status: "pending" },
      {
        id: "done",
        status: "fulfilled",
        stripeId: "local-provider-session",
        amount: 100,
      },
    ],
    sessions: [{ id: "local-session" }],
    otp: [{ id: "code" }],
    jobs: [{ id: "queued-mail" }],
    settings: [
      { id: "global", subscriptionPrice: 2900, smtpPassword: "private" },
    ],
  });
  assert.equal(data.users[0].email, "test@example.com");
  assert.equal(data.users[0].stripeCustomer, undefined);
  assert.equal(data.users[0].password, undefined);
  assert.equal(data.vouchers[0].balance, 1234);
  assert.equal(data.vouchers[0].email, "test@example.com");
  assert.equal(data.vouchers[0].reservedBy, undefined);
  assert.deepEqual(data.checkouts, [
    { id: "done", status: "fulfilled", amount: 100 },
  ]);
  for (const kind of ["sessions", "otp", "jobs"])
    assert.equal(data[kind], undefined);
  assert.equal(data.settings[0].smtpPassword, undefined);
});

test("unfinished provider payments and unmigrated legacy data stop a database replacement", () => {
  assert.throws(
    () =>
      prepareBusinessData({
        checkouts: [
          { id: "pending", status: "pending", stripeId: "active-payment" },
        ],
      }),
    /Finish local provider payments/,
  );
  assert.throws(
    () => prepareBusinessData({ users: [{ id: "old", role: "organisation" }] }),
    /account migration/,
  );
});
