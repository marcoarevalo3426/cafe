import React, { useState, useRef } from "react";
import { View, Pressable, ScrollView } from "react-native";
import {
  Box,
  Row,
  Copy,
  Small,
  Section,
  Btn,
  Field,
  Select,
  Check,
  Choice,
  Dialog,
  Empty,
  Link,
  Asset,
  Line,
} from "./ui";
import { useApp } from "./context";
import { api, requestKey } from "./api";
import { money, validity, type Voucher, type VerifiedVoucher } from "./types";
import { VoucherCodeField } from "./VoucherCodeField";
import { openLink } from "./platform";
export function Vouchers() {
  const { data, nav, run, refresh } = useApp();
  const role = data.user?.role;
  const [selected, setSelected] = useState<string[]>([]),
    [sort, setSort] = useState<"balance" | "expiresAt">("balance"),
    [direction, setDirection] = useState(1),
    [share, setShare] = useState<Voucher | null>(null),
    [address, setAddress] = useState(""),
    [confirm, setConfirm] = useState(false);
  const owner = role === "owner" || role === "admin";
  const vouchers = [...data.vouchers].sort(
    (a, b) => (a[sort] - b[sort]) * direction,
  );
  function toggle(id: string) {
    setSelected(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  }
  function sortBy(field: typeof sort) {
    setSort(field);
    setDirection(sort === field ? -direction : 1);
  }
  return (
    <Box style={{ gap: 0 }}>
      {owner && (
        <Section>
          <Btn
            outline
            style={{ alignSelf: "center", borderRadius: 28 }}
            onPress={() => nav("Generate vouchers")}
          >
            Generate Vouchers
          </Btn>
        </Section>
      )}
      <Line />
      <ScrollView horizontal contentContainerStyle={{ flexGrow: 1 }}>
        <Box style={{ flex: 1, gap: 0, minWidth: owner ? 400 : 320 }}>
          <Row style={{ paddingHorizontal: 16, minHeight: 56, gap: 6 }}>
            <Copy style={{ width: owner ? 22 : 72, fontSize: 14 }}>
              {owner ? "#" : "Voucher"}
            </Copy>
            {owner && <Copy style={{ width: 72, fontSize: 14 }}>Voucher</Copy>}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sort vouchers by value"
              onPress={() => sortBy("balance")}
              style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
            >
              <Row style={{ gap: 2 }}>
                <Copy style={{ fontSize: 14 }}>Value</Copy>
                {owner && (
                  <Asset
                    name="16-396-imgArrowDropDown.svg"
                    width={18}
                    height={18}
                  />
                )}
              </Row>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sort vouchers by validity"
              onPress={() => sortBy("expiresAt")}
              style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
            >
              <Copy style={{ fontSize: 14 }}>Valid ⌄</Copy>
            </Pressable>
            <Copy style={{ width: 52, fontSize: 14 }}>
              {owner ? "Delete" : "Share"}
            </Copy>
          </Row>
          <Line />
          {!vouchers.length && <Empty>No valid vouchers yet.</Empty>}
          {vouchers.map((v, i) => (
            <Row
              key={v.id}
              style={{ paddingHorizontal: 16, minHeight: 58, gap: 6 }}
            >
              <Copy
                style={{ width: owner ? 22 : 72, fontSize: owner ? 16 : 13 }}
              >
                {owner ? i + 1 : v.code}
              </Copy>
              {owner && (
                <Copy selectable style={{ width: 72, fontSize: 13 }}>
                  {v.code}
                </Copy>
              )}
              <Copy style={{ flex: 1, fontSize: 14 }}>
                {money(
                  v.balance,
                  data.stores.find((s) => s.id === v.storeId)?.currency,
                )}
              </Copy>
              <Copy style={{ flex: 1, fontSize: 14 }}>
                {validity(v.expiresAt)}
              </Copy>
              <View style={{ width: 52 }}>
                {owner ? (
                  <Check
                    hideLabel
                    label={`Select voucher ${v.code}`}
                    checked={selected.includes(v.id)}
                    disabled={!!v.reservedBy}
                    onPress={() => toggle(v.id)}
                  />
                ) : (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Share voucher ${v.code}`}
                    disabled={!!v.reservedBy}
                    onPress={() => {
                      setShare(v);
                      setAddress("");
                    }}
                    style={{ minHeight: 44, justifyContent: "center" }}
                  >
                    <Copy
                      style={{ fontSize: 13, textDecorationLine: "underline" }}
                    >
                      Share
                    </Copy>
                  </Pressable>
                )}
              </View>
            </Row>
          ))}
        </Box>
      </ScrollView>
      <Section
        style={{
          alignItems: "center",
          marginTop: 30,
          borderTopWidth: 1,
          borderBottomWidth: 1,
          borderColor: "#888",
          padding: 12,
        }}
      >
        <Copy>Total vouchers: {vouchers.length}</Copy>
      </Section>
      {owner && (
        <Section>
          <Row>
            <Btn
              style={{ flex: 1 }}
              onPress={() =>
                setSelected(
                  selected.length === vouchers.length
                    ? []
                    : vouchers.filter((v) => !v.reservedBy).map((v) => v.id),
                )
              }
            >
              {selected.length === vouchers.length && selected.length
                ? "Clear selection"
                : "Select All"}
            </Btn>
            {selected.length > 0 && (
              <Btn style={{ flex: 1 }} onPress={() => setConfirm(true)}>
                Delete ({selected.length})
              </Btn>
            )}
          </Row>
        </Section>
      )}
      <Dialog
        visible={confirm}
        title="Delete selected vouchers?"
        onClose={() => setConfirm(false)}
      >
        <Copy>{selected.length} voucher(s) will be deleted.</Copy>
        <Row>
          <Btn outline style={{ flex: 1 }} onPress={() => setConfirm(false)}>
            Cancel
          </Btn>
          <Btn
            style={{ flex: 1 }}
            onPress={() =>
              void run(async () => {
                await api("/vouchers/delete", { ids: selected });
                setSelected([]);
                setConfirm(false);
                await refresh();
              }, "The selected vouchers have been deleted.")
            }
          >
            Delete
          </Btn>
        </Row>
      </Dialog>
      <Dialog
        visible={!!share}
        title="Share voucher"
        onClose={() => setShare(null)}
      >
        <Field
          label="Email address"
          value={address}
          onChange={setAddress}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="you@example.com"
        />
        <Small>
          Sharing transfers this voucher to the email address entered and
          removes it from your account.
        </Small>
        <Btn
          onPress={() =>
            void run(async () => {
              await api("/vouchers/share", { id: share?.id, email: address });
              setShare(null);
              await refresh();
            }, "Voucher shared successfully.")
          }
        >
          Send
        </Btn>
      </Dialog>
    </Box>
  );
}
export function GenerateVouchers() {
  const { data, nav, run, refresh, notice } = useApp();
  const owner = data.user?.role === "owner" || data.user?.role === "admin";
  const [step, setStep] = useState(0),
    [quantity, setQuantity] = useState("20"),
    [amount, setAmount] = useState("10"),
    [month, setMonth] = useState(String(new Date().getMonth() + 1)),
    [year, setYear] = useState(String(new Date().getFullYear() + 1)),
    [payment, setPayment] = useState<"card" | "cash" | "voucher">("card"),
    [cashReceived, setCashReceived] = useState(false);
  const key = useRef(requestKey());
  const total = Number(quantity) * Math.round(Number(amount) * 100);
  const [adminStore, setAdminStore] = useState(data.stores[0]?.id ?? "");
  const [verifiedVoucher, setVerifiedVoucher] =
    useState<VerifiedVoucher | null>(null);
  const store = data.stores.find(
    (s) =>
      s.id === (data.user?.role === "admin" ? adminStore : data.user?.storeId),
  );
  const voucherBalance =
    verifiedVoucher &&
    verifiedVoucher.storeId === store?.id &&
    verifiedVoucher.expiresAt > Date.now()
      ? verifiedVoucher.balance
      : 0;
  const selectedPayment =
    payment === "voucher" && voucherBalance <= 0 ? "card" : payment;
  const voucherAmount =
    selectedPayment === "voucher" ? Math.min(total, voucherBalance) : 0;
  const remaining = total - voucherAmount;
  function choosePayment(next: "card" | "cash" | "voucher") {
    if (next !== payment) setCashReceived(false);
    setPayment(next);
    key.current = requestKey();
  }
  function validate() {
    if (
      !Number.isInteger(Number(quantity)) ||
      Number(quantity) < 1 ||
      Number(quantity) > 100
    )
      throw new Error("Generate between 1 and 100 vouchers.");
    if (
      !Number.isFinite(Number(amount)) ||
      Number(amount) < 10 ||
      Number(amount) > 10000
    )
      throw new Error("Each voucher must be worth between $10 and $10,000.");
    if (
      !Number.isInteger(Number(month)) ||
      Number(month) < 1 ||
      Number(month) > 12 ||
      !Number.isInteger(Number(year)) ||
      Date.UTC(Number(year), Number(month), 1) <= Date.now()
    )
      throw new Error("Enter a future month and year.");
  }
  async function submit() {
    await run(async () => {
      validate();
      const r = await api(
        "/checkout",
        {
          type: "vouchers",
          storeId: store?.id,
          quantity: Number(quantity),
          amount: Math.round(Number(amount) * 100),
          month: Number(month),
          year: Number(year),
          payment: selectedPayment,
          ...(selectedPayment === "voucher"
            ? { voucherCode: verifiedVoucher?.code }
            : {}),
          cashReceived,
        },
        { "Idempotency-Key": key.current },
      );
      if (r.url) {
        await openLink(r.url);
        notice(
          "Complete payment, then return to the app to view your vouchers.",
        );
      } else {
        await refresh();
        notice(`${r.result.voucherCount} vouchers generated successfully.`);
        nav("Vouchers");
      }
    });
  }
  return (
    <Section style={{ gap: 32 }}>
      {step === 0 ? (
        <>
          {data.user?.role === "admin" && (
            <Select
              label="Cafe"
              value={adminStore}
              onChange={setAdminStore}
              options={data.stores.map((s) => ({ value: s.id, label: s.name }))}
            />
          )}
          <Box style={{ marginTop: 32, alignItems: "center", gap: 24 }}>
            <Row>
              <Copy>Generate</Copy>
              <Field
                value={quantity}
                onChange={setQuantity}
                keyboardType="number-pad"
                accessibilityLabel="Number of vouchers"
                style={{ width: 68 }}
              />
              <Copy>voucher/s</Copy>
            </Row>
            <Row>
              <Copy>worth $</Copy>
              <Field
                value={amount}
                onChange={setAmount}
                keyboardType="decimal-pad"
                accessibilityLabel="Voucher amount"
                style={{ width: 70 }}
              />
              <Copy>each</Copy>
            </Row>
            <Row>
              <Copy>Validity (mm/yyyy)</Copy>
              <Field
                value={month}
                onChange={setMonth}
                keyboardType="number-pad"
                accessibilityLabel="Validity month"
                style={{ width: 56 }}
              />
              <Field
                value={year}
                onChange={setYear}
                keyboardType="number-pad"
                accessibilityLabel="Validity year"
                style={{ width: 78 }}
              />
            </Row>
            <Btn
              style={{ width: 173, marginTop: 12 }}
              onPress={() =>
                void run(async () => {
                  validate();
                  setStep(1);
                })
              }
            >
              Review order
            </Btn>
          </Box>
        </>
      ) : (
        <>
          <Box style={{ gap: 8 }}>
            <Small>MY ORDER</Small>
            <Box
              style={{
                borderWidth: 1,
                borderColor: "#b3b3b3",
                borderRadius: 10,
                padding: 20,
              }}
            >
              <Row style={{ alignItems: "flex-start" }}>
                <Copy style={{ flex: 1 }}>
                  {quantity} x vouchers{`\n`}worth{" "}
                  {money(Math.round(Number(amount) * 100), store?.currency)}{" "}
                  each
                </Copy>
                <Copy>{money(total, store?.currency)}</Copy>
              </Row>
              <Row style={{ justifyContent: "flex-end" }}>
                <Link onPress={() => setStep(0)}>modify</Link>
                <Asset name="16-566-imgImage5.png" width={12} height={12} />
              </Row>
            </Box>
          </Box>
          <Box style={{ gap: 8 }}>
            <Small>ACCOUNT</Small>
            <Copy>{data.user?.email}</Copy>
            <Small>
              New vouchers will be added to your account. Share their codes with
              customers so they can claim them.
            </Small>
          </Box>
          {owner && store && (
            <VoucherCodeField
              key={store.id}
              storeId={store.id}
              initialVoucher={
                verifiedVoucher?.storeId === store.id ? verifiedVoucher : null
              }
              onVerified={(voucher) => {
                setVerifiedVoucher(voucher);
                if (voucher) choosePayment("voucher");
                key.current = requestKey();
              }}
            />
          )}
          <Box style={{ gap: 10 }}>
            <Small>PAYMENT METHOD</Small>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Payment method"
              style={{
                borderRadius: 10,
                overflow: "hidden",
                backgroundColor: "#e8e8e8",
              }}
            >
              <Choice
                selected={selectedPayment === "card"}
                onPress={() => choosePayment("card")}
              >
                Card / Apple Pay / Google Pay
              </Choice>
              {owner && (
                <Choice
                  selected={selectedPayment === "voucher"}
                  disabled={voucherBalance <= 0}
                  onPress={() => choosePayment("voucher")}
                >
                  Voucher ({money(voucherBalance, store?.currency)})
                </Choice>
              )}
              {owner && (
                <Choice
                  selected={selectedPayment === "cash"}
                  onPress={() => choosePayment("cash")}
                >
                  Cash in store
                </Choice>
              )}
            </View>
            {selectedPayment === "cash" ? (
              <Check
                checked={cashReceived}
                onPress={() => setCashReceived(!cashReceived)}
                label="I confirm cash payment has been received"
              />
            ) : remaining > 0 ? (
              <Small>
                {voucherAmount > 0
                  ? `Your voucher covers ${money(voucherAmount, store?.currency)}. Pay the remaining ${money(remaining, store?.currency)} by card or an eligible wallet. `
                  : ""}
                {data.paymentsEnabled
                  ? "Complete payment at secure checkout. Saved cards and eligible wallets will be available."
                  : "Card payments require the payment provider configuration."}
              </Small>
            ) : (
              <Small>Your voucher covers the full total.</Small>
            )}
          </Box>
          {voucherAmount > 0 && (
            <Box>
              <Row>
                <Copy style={{ flex: 1 }}>Voucher credit</Copy>
                <Copy>−{money(voucherAmount, store?.currency)}</Copy>
              </Row>
              <Row>
                <Copy style={{ flex: 1 }}>Total to pay</Copy>
                <Copy>{money(remaining, store?.currency)}</Copy>
              </Row>
            </Box>
          )}
          <Box style={{ gap: 8 }}>
            <Small>ADD PAYMENT METHOD</Small>
            <Btn outline onPress={() => nav("Payment method")}>
              Add or manage cards
            </Btn>
          </Box>
          <Btn
            style={{ width: 173, alignSelf: "flex-end" }}
            disabled={
              (selectedPayment === "cash" && !cashReceived) ||
              (selectedPayment !== "cash" &&
                remaining > 0 &&
                !data.paymentsEnabled)
            }
            onPress={() => void submit()}
          >
            Submit
          </Btn>
        </>
      )}
    </Section>
  );
}
