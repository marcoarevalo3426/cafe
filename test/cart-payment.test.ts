import { test } from "node:test";
import assert from "node:assert/strict";
import { cartPaymentMethod, cartVoucherBalance } from "../src/cart-payment";
import type { Voucher } from "../src/types";

test("cart defaults to vouchers for positive credit and card for zero credit", () => {
  assert.equal(cartPaymentMethod(1500, "cafe"), "voucher");
  assert.equal(cartPaymentMethod(1, "cafe"), "voucher");
  assert.equal(cartPaymentMethod(0, "cafe"), "card");
  assert.equal(cartPaymentMethod(-1, "cafe"), "card");
});

test("cart respects an explicit choice, falls back when credit runs out, and defaults again for another cafe", () => {
  assert.equal(
    cartPaymentMethod(1500, "cafe", { storeId: "cafe", method: "card" }),
    "card",
  );
  assert.equal(
    cartPaymentMethod(0, "cafe", { storeId: "cafe", method: "voucher" }),
    "card",
  );
  assert.equal(
    cartPaymentMethod(1500, "other", { storeId: "cafe", method: "card" }),
    "voucher",
  );
  assert.equal(
    cartPaymentMethod(0, "other", { storeId: "cafe", method: "voucher" }),
    "card",
  );
});

test("cart credit includes only the customer's usable cafe vouchers and this checkout's own reservations", () => {
  const voucher: Voucher = {
    id: "one",
    code: "abc123",
    orgId: "org",
    storeId: "cafe",
    email: "customer@example.com",
    balance: 500,
    initialAmount: 500,
    expiresAt: 2000,
  };
  const vouchers: Voucher[] = [
    voucher,
    { ...voucher, id: "two", balance: 200 },
    { ...voucher, id: "expired", expiresAt: 1000 },
    { ...voucher, id: "empty", balance: 0 },
    { ...voucher, id: "negative", balance: -100 },
    { ...voucher, id: "other-cafe", storeId: "other" },
    { ...voucher, id: "other-person", email: "other@example.com" },
    { ...voucher, id: "reserved", reservedBy: "other-checkout" },
    { ...voucher, id: "pending", reservedBy: "my-checkout", expiresAt: 1000 },
  ];
  assert.equal(
    cartVoucherBalance(vouchers, "cafe", "customer@example.com", "", 1000),
    700,
  );
  assert.equal(
    cartVoucherBalance(
      vouchers,
      "cafe",
      "customer@example.com",
      "my-checkout",
      1000,
    ),
    1200,
  );
  assert.equal(cartVoucherBalance(vouchers, "cafe", undefined, "", 1000), 0);
});
