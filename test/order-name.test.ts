import { test } from "node:test";
import assert from "node:assert/strict";
import { isOrderName, cleanOrderName } from "../src/order-name";
import { Database } from "./support/database";
import { Domain } from "../server/domain";
import type { MenuItem, User } from "../src/types";

test("order names require 1–20 letters and input removes digits, punctuation and spaces", () => {
  for (const name of ["Alice", "José", "王小明", "A".repeat(20)])
    assert.equal(isOrderName(name), true);
  for (const name of [
    undefined,
    null,
    "",
    " ",
    "John Smith",
    "Anne-Marie",
    "Sam1",
    "A".repeat(21),
  ])
    assert.equal(isOrderName(name), false);
  assert.equal(cleanOrderName(" Jo3hn! Smith_ "), "JohnSmith");
  assert.equal(cleanOrderName("A".repeat(30)), "A".repeat(20));
});

async function setup() {
  const db = new Database();
  const d = new Domain(db, true);
  await d.seed();
  const customer = (await db.get<User>("users", "demo-customer-user"))!;
  const item = (await db.list<MenuItem>("menu"))[0];
  const body = {
    storeId: item.storeId,
    useVouchers: true,
    orderName: "Alice",
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
  return { db, d, customer, body };
}

test("a successful order uses the entered name and remembers it per account without changing the profile", async () => {
  const { db, d, customer, body } = await setup();
  try {
    assert.equal(customer.lastOrderName, undefined);
    const checkout = await d.orderDraft(customer, body, "named-order");
    assert.equal(
      (await db.get<User>("users", customer.id))!.lastOrderName,
      undefined,
    );
    const result = await d.fulfill(checkout.id, "voucher");
    assert.equal(result.customer, "Alice");
    const account = (await db.get<User>("users", customer.id))!;
    assert.equal(account.lastOrderName, "Alice");
    assert.equal(account.name, customer.name);
    assert.equal((await d.bootstrap(account)).user!.lastOrderName, "Alice");
    const other = (await db.get<User>("users", "demo-owner"))!;
    assert.equal(other.lastOrderName, undefined);
    const abandoned = await d.orderDraft(
      customer,
      { ...body, orderName: "Bob" },
      "abandoned",
    );
    await d.cancelCheckout(abandoned.id);
    assert.equal(
      (await db.get<User>("users", customer.id))!.lastOrderName,
      "Alice",
    );
    const next = await d.orderDraft(
      customer,
      { ...body, orderName: "Carol" },
      "new-name",
    );
    await d.fulfill(next.id, "voucher");
    assert.equal(
      (await db.get<User>("users", customer.id))!.lastOrderName,
      "Carol",
    );
  } finally {
    await db.close();
  }
});

test("missing or invalid order names cannot create a checkout even if a previous name exists", async () => {
  const { db, d, customer, body } = await setup();
  try {
    await db.put("users", { ...customer, lastOrderName: "Alice" });
    const before = (await db.list("checkouts")).length;
    for (const [index, name] of [
      undefined,
      "",
      "Alice Smith",
      "Alice1",
      "A".repeat(21),
    ].entries())
      await assert.rejects(
        d.orderDraft(
          customer,
          { ...body, orderName: name },
          `invalid-${index}`,
        ),
        /Enter a name using letters only/,
      );
    assert.equal((await db.list("checkouts")).length, before);
    assert.equal(
      (await db.get<User>("users", customer.id))!.lastOrderName,
      "Alice",
    );
  } finally {
    await db.close();
  }
});
