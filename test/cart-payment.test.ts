import { test } from "node:test";
import assert from "node:assert/strict";
import { cartPaymentMethod, cartVoucherBalance } from "../src/cart-payment";
import type { Voucher, VerifiedVoucher } from "../src/types";

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

test("verified bearer credit updates the cart without counting a wallet voucher twice", () => {
  const own: Voucher = {
    id: "own",
    code: "own001",
    storeId: "cafe",
    email: "customer@example.com",
    balance: 500,
    initialAmount: 500,
    expiresAt: 2000,
  };
  const verified: VerifiedVoucher = {
    id: "bearer",
    code: "bearer",
    storeId: "cafe",
    balance: 1000,
    expiresAt: 2000,
    currency: "AUD",
  };
  const balance = (code: VerifiedVoucher | null) =>
    cartVoucherBalance([own], "cafe", own.email, "", 1000, code);
  assert.equal(balance(verified), 1500);
  assert.equal(balance({ ...verified, id: own.id, balance: 500 }), 500);
  assert.equal(balance({ ...verified, storeId: "other" }), 500);
  assert.equal(balance({ ...verified, expiresAt: 1000 }), 500);
  assert.equal(balance({ ...verified, balance: 0 }), 500);
  assert.equal(balance(null), 500);
});

test("verification replaces stale wallet credit so positive verified vouchers remain selectable", () => {
  const own: Voucher = {
    id: "own",
    code: "own001",
    storeId: "cafe",
    email: "customer@example.com",
    balance: 0,
    initialAmount: 1000,
    expiresAt: 2000,
  };
  const verified: VerifiedVoucher = { ...own, balance: 700, currency: "AUD" };
  assert.equal(
    cartPaymentMethod(
      cartVoucherBalance([own], "cafe", own.email, "", 1000),
      "cafe",
    ),
    "card",
  );
  const balance = cartVoucherBalance(
    [own],
    "cafe",
    own.email,
    "",
    1000,
    verified,
  );
  assert.equal(balance, 700);
  assert.equal(cartPaymentMethod(balance, "cafe"), "voucher");
  assert.equal(
    cartVoucherBalance(
      [{ ...own, balance: 1000 }],
      "cafe",
      own.email,
      "",
      1000,
      verified,
    ),
    700,
  );
  assert.equal(
    cartVoucherBalance(
      [{ ...own, reservedBy: "another-checkout" }],
      "cafe",
      own.email,
      "",
      1000,
      verified,
    ),
    0,
  );
});
