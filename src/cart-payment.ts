import type { Voucher } from "./types";

export type CartPaymentMethod = "voucher" | "card";
export type CartPaymentChoice = { storeId: string; method: CartPaymentMethod };

export function cartVoucherBalance(
  vouchers: Voucher[],
  storeId: string,
  userEmail: string | undefined,
  pendingCheckout = "",
  now = Date.now(),
) {
  if (!userEmail) return 0;
  return vouchers
    .filter(
      (v) =>
        v.storeId === storeId &&
        v.email === userEmail &&
        v.balance > 0 &&
        // Keep this checkout's reserved credit visible until payment completes.
        ((!v.reservedBy && v.expiresAt > now) ||
          (pendingCheckout && v.reservedBy === pendingCheckout)),
    )
    .reduce((sum, v) => sum + v.balance, 0);
}

export function cartPaymentMethod(
  balance: number,
  storeId: string,
  choice: CartPaymentChoice | null = null,
): CartPaymentMethod {
  if (balance <= 0) return "card";
  return choice?.storeId === storeId ? choice.method : "voucher";
}
