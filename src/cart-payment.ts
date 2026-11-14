import type { Voucher, VerifiedVoucher } from "./types";

export type CartPaymentMethod = "voucher" | "card";
export type CartPaymentChoice = { storeId: string; method: CartPaymentMethod };

export function cartVoucherBalance(
  vouchers: Voucher[],
  storeId: string,
  userEmail: string | undefined,
  pendingCheckout = "",
  now = Date.now(),
  verified?: VerifiedVoucher | null,
) {
  if (!userEmail) return 0;
  const wallet = vouchers.filter(
    (v) =>
      v.storeId === storeId &&
      v.email === userEmail &&
      v.balance > 0 &&
      // Keep this checkout's reserved credit visible until payment completes.
      ((!v.reservedBy && v.expiresAt > now) ||
        (pendingCheckout && v.reservedBy === pendingCheckout)),
  );
  const credit = new Map(wallet.map((v) => [v.id, v.balance]));
  const knownVoucher = vouchers.find((v) => v.id === verified?.id);
  if (
    verified &&
    verified.storeId === storeId &&
    (verified.expiresAt > now || !!pendingCheckout) &&
    verified.balance > 0 &&
    (!knownVoucher?.reservedBy || knownVoucher.reservedBy === pendingCheckout)
  ) {
    // Verification is fresher than bootstrap. Replace the same voucher's
    // balance instead of ignoring it or adding its value a second time.
    credit.set(verified.id, verified.balance);
  }
  return [...credit.values()].reduce((sum, balance) => sum + balance, 0);
}

export function cartPaymentMethod(
  balance: number,
  storeId: string,
  choice: CartPaymentChoice | null = null,
): CartPaymentMethod {
  if (balance <= 0) return "card";
  return choice?.storeId === storeId ? choice.method : "voucher";
}
