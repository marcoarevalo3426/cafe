import assert from "node:assert/strict";

export const businessKinds = [
  "users",
  "stores",
  "menu",
  "templates",
  "vouchers",
  "orders",
  "settings",
  "feedback",
  "builds",
  "checkouts",
] as const;
export type BusinessData = Record<string, { id: string; [key: string]: any }[]>;

function clean(value: any): any {
  if (Array.isArray(value)) return value.map(clean);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(
        ([key]) =>
          !/stripe|smtp|password|secret|token|credential|paymentMethodId/i.test(
            key,
          ),
      )
      .map(([key, nested]) => [key, clean(nested)]),
  );
}

export function prepareBusinessData(source: BusinessData): BusinessData {
  assert(
    !(source.checkouts ?? []).some((c) => c.status === "pending" && c.stripeId),
    "Finish local provider payments before copying the database.",
  );
  const output: BusinessData = {};
  for (const kind of businessKinds) {
    output[kind] = (source[kind] ?? [])
      .filter((row) => kind !== "checkouts" || row.status !== "pending")
      .map((row) => {
        assert(
          row.id && typeof row.id === "string",
          "Every business record needs an ID.",
        );
        assert(
          !("orgId" in row) && row.role !== "organisation",
          "Start the updated local app to finish the account migration first.",
        );
        const copy = clean(row);
        if (kind === "vouchers") delete copy.reservedBy;
        return JSON.parse(JSON.stringify(copy));
      });
  }
  output.migrations = [
    { id: "direct-voucher-accounts-v1", completedAt: Date.now() },
  ];
  return output;
}
