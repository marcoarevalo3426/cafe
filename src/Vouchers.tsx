import React, { useState, useRef } from "react";
import { View, Pressable } from "react-native";
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
import { money, validity, type Voucher } from "./types";
import { openLink } from "./platform";
export function Vouchers() {
  const { data, nav, run, refresh } = useApp();
  const role = data.user?.role;
  const [selected, setSelected] = useState<string[]>([]),
    [sort, setSort] = useState<"balance" | "expiresAt">("balance"),
    [direction, setDirection] = useState(1),
    [share, setShare] = useState<Voucher | null>(null),
    [address, setAddress] = useState(""),
    [recipient, setRecipient] = useState(""),
    [confirm, setConfirm] = useState(false);
  const owner = role === "owner" || role === "admin",
    org = role === "organisation";
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
      {(owner || org) && (
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
      {org && !data.organisations.length && (
        <Empty>
          Your cafe will invite this email to an organisation. Sign in again
          after the invitation arrives.
        </Empty>
      )}
      <Line />
      <Row style={{ paddingHorizontal: 16, minHeight: 56, gap: 6 }}>
        <Copy style={{ width: owner ? 22 : 72, fontSize: 14 }}>
          {owner ? "#" : "Voucher"}
        </Copy>
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
        {owner && <Copy style={{ flex: 1.5, fontSize: 14 }}>Company</Copy>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sort vouchers by validity"
          onPress={() => sortBy("expiresAt")}
          style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
        >
          <Copy style={{ fontSize: 14 }}>Valid ⌄</Copy>
        </Pressable>
        <Copy style={{ width: 52, fontSize: 14 }}>
          {owner ? "Delete" : org ? "Select" : "Share"}
        </Copy>
      </Row>
      <Line />
      {!vouchers.length && <Empty>No valid vouchers yet.</Empty>}
      {vouchers.map((v, i) => (
        <Row
          key={v.id}
          style={{ paddingHorizontal: 16, minHeight: 58, gap: 6 }}
        >
          <Copy style={{ width: owner ? 22 : 72, fontSize: owner ? 16 : 13 }}>
            {owner ? i + 1 : v.code}
          </Copy>
          <Copy style={{ flex: 1, fontSize: 14 }}>
            {money(
              v.balance,
              data.stores.find((s) => s.id === v.storeId)?.currency,
            )}
          </Copy>
          {owner && (
            <Copy numberOfLines={2} style={{ flex: 1.5, fontSize: 14 }}>
              {data.organisations.find((o) => o.id === v.orgId)?.name ??
                "Organisation"}
            </Copy>
          )}
          <Copy style={{ flex: 1, fontSize: 14 }}>{validity(v.expiresAt)}</Copy>
          <View style={{ width: 52 }}>
            {owner || org ? (
              <Check
                hideLabel
                label={`Select voucher ${v.code}`}
                checked={selected.includes(v.id)}
                disabled={!!v.reservedBy || (org && !!v.email)}
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
                <Copy style={{ fontSize: 13, textDecorationLine: "underline" }}>
                  Share
                </Copy>
              </Pressable>
            )}
          </View>
        </Row>
      ))}
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
        {org && (
          <Small>
            {vouchers.filter((v) => !v.email).length} available to allocate
          </Small>
        )}
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
      {org && selected.length > 0 && (
        <Section>
          <Select
            label="Allocate to recipient"
            value={recipient}
            onChange={setRecipient}
            options={data.recipients.map((r) => ({
              value: r.email,
              label: r.email,
            }))}
          />
          <Btn
            disabled={!recipient}
            onPress={() =>
              void run(async () => {
                await api("/vouchers/allocate", {
                  ids: selected,
                  email: recipient,
                });
                setSelected([]);
                await refresh();
              }, "Vouchers allocated. The recipient will receive an email.")
            }
          >
            Allocate {selected.length} vouchers
          </Btn>
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
          Note: You can share your voucher to same organisation as you and
          voucher will be removed from your account
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
    [existing, setExisting] = useState(false),
    [orgId, setOrgId] = useState(data.organisations[0]?.id ?? ""),
    [orgName, setOrgName] = useState(""),
    [orgEmail, setOrgEmail] = useState(""),
    [payment, setPayment] = useState(owner ? "cash" : "card"),
    [cashReceived, setCashReceived] = useState(false);
  const key = useRef(requestKey());
  const organisation = data.organisations.find((o) => o.id === orgId);
  const total = Number(quantity) * Math.round(Number(amount) * 100);
  const [adminStore, setAdminStore] = useState(data.stores[0]?.id ?? "");
  const store = data.stores.find(
    (s) =>
      s.id ===
      (data.user?.storeId ??
        (data.user?.role === "organisation"
          ? data.organisations[0]?.storeId
          : adminStore)),
  );
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
          ...(owner ? (existing ? { orgId } : { orgName, orgEmail }) : {}),
          payment,
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
                  if (!owner && !data.organisations.length)
                    throw new Error(
                      "Your cafe must invite your organisation before purchasing vouchers.",
                    );
                  setStep(owner ? 1 : 2);
                })
              }
            >
              {owner ? "Submit" : "Next"}
            </Btn>
          </Box>
        </>
      ) : step === 1 ? (
        <>
          <Box
            style={{
              borderWidth: 1,
              borderColor: "#b3b3b3",
              borderRadius: 10,
              gap: 0,
              overflow: "hidden",
            }}
          >
            <Choice selected={existing} onPress={() => setExisting(true)}>
              Existing account
            </Choice>
            <Choice selected={!existing} onPress={() => setExisting(false)}>
              Add new
            </Choice>
          </Box>
          {existing ? (
            <>
              <Select
                label="Select organisation"
                value={orgId}
                onChange={setOrgId}
                options={data.organisations
                  .filter((o) => o.storeId === store?.id)
                  .map((o) => ({ value: o.id, label: o.name }))}
              />
              <Copy>
                Email Address: {organisation?.email ?? "No organisations yet"}
              </Copy>
            </>
          ) : (
            <>
              <Field
                label="Company name"
                value={orgName}
                onChange={setOrgName}
              />
              <Field
                label="Email Address"
                value={orgEmail}
                onChange={setOrgEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </>
          )}
          <Btn
            style={{ width: 188, alignSelf: "flex-end" }}
            onPress={() =>
              void run(async () => {
                if (existing && !organisation)
                  throw new Error("Select an existing organisation.");
                if (
                  !existing &&
                  (!orgName.trim() || !/^\S+@\S+\.\S+$/.test(orgEmail))
                )
                  throw new Error(
                    "Enter the company name and a valid email address.",
                  );
                setStep(2);
              })
            }
          >
            Submit
          </Btn>
          <Link onPress={() => setStep(0)}>Back</Link>
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
          <Box style={{ gap: 12 }}>
            <Small>ACCOUNT</Small>
            <Box style={{ alignItems: "center", gap: 0 }}>
              <Copy>
                {owner
                  ? existing
                    ? organisation?.name
                    : orgName
                  : data.organisations[0]?.name}
              </Copy>
              <Copy style={{ color: "#999" }}>
                {owner
                  ? existing
                    ? organisation?.email
                    : orgEmail
                  : data.user?.email}
              </Copy>
            </Box>
            {owner && (
              <Link onPress={() => setStep(1)}>Modify organisation</Link>
            )}
          </Box>
          <Box style={{ gap: 10 }}>
            <Small>PAYMENT METHOD</Small>
            <View
              style={{
                borderRadius: 10,
                overflow: "hidden",
                backgroundColor: "#e8e8e8",
              }}
            >
              {owner && (
                <Choice
                  selected={payment === "cash"}
                  onPress={() => setPayment("cash")}
                >
                  Cash in store
                </Choice>
              )}
              <Choice
                selected={payment === "card"}
                onPress={() => setPayment("card")}
              >
                Card / Apple Pay / Google Pay
              </Choice>
            </View>
            {payment === "cash" ? (
              <Check
                checked={cashReceived}
                onPress={() => setCashReceived(!cashReceived)}
                label="I confirm cash payment has been received"
              />
            ) : (
              <Small>
                {data.paymentsEnabled
                  ? "Complete payment at secure checkout. Saved cards and eligible wallets will be available."
                  : "Card payments require the payment provider configuration."}
              </Small>
            )}
          </Box>
          <Box style={{ gap: 8 }}>
            <Small>ADD PAYMENT METHOD</Small>
            <Btn outline onPress={() => nav("Payment method")}>
              Add or manage cards
            </Btn>
          </Box>
          <Btn
            style={{ width: 173, alignSelf: "flex-end" }}
            disabled={
              (payment === "cash" && !cashReceived) ||
              (payment === "card" && !data.paymentsEnabled)
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
export function Recipients() {
  const { data, run, refresh } = useApp();
  const [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState(1),
    [selected, setSelected] = useState<string[]>([]),
    [editor, setEditor] = useState<{ id?: string; email: string } | null>(null),
    [confirm, setConfirm] = useState(false);
  const list = data.recipients
    .filter((r) => r.email.includes(search.toLowerCase()))
    .sort((a, b) => a.email.localeCompare(b.email) * sort);
  return (
    <Section>
      <Row>
        <Field
          style={{ flex: 1 }}
          placeholder="Search email address"
          value={query}
          onChange={setQuery}
        />
        <Btn small onPress={() => setSearch(query)}>
          Search
        </Btn>
      </Row>
      <Btn outline onPress={() => setEditor({ email: "" })}>
        Add recipient
      </Btn>
      <Row>
        <Pressable
          accessibilityRole="button"
          onPress={() => setSort(-sort)}
          style={{ flex: 1, minHeight: 44, justifyContent: "center" }}
        >
          <Copy>Email addresses {sort === 1 ? "↓" : "↑"}</Copy>
        </Pressable>
        <Copy>Delete</Copy>
      </Row>
      {!list.length && <Empty>No recipients found.</Empty>}
      {list.map((r) => (
        <Row
          key={r.id}
          style={{ borderBottomWidth: 1, borderColor: "#d9d9d9" }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Edit ${r.email}`}
            onPress={() => setEditor(r)}
            style={{ flex: 1, paddingVertical: 16 }}
          >
            <Copy>{r.email}</Copy>
          </Pressable>
          <Check
            hideLabel
            label={`Select ${r.email}`}
            checked={selected.includes(r.id)}
            onPress={() =>
              setSelected(
                selected.includes(r.id)
                  ? selected.filter((x) => x !== r.id)
                  : [...selected, r.id],
              )
            }
          />
        </Row>
      ))}
      {selected.length > 0 && (
        <Btn onPress={() => setConfirm(true)}>Submit ({selected.length})</Btn>
      )}
      <Dialog
        visible={!!editor}
        title={editor?.id ? "Edit recipient" : "Add recipient"}
        onClose={() => setEditor(null)}
      >
        <Field
          label="Email address"
          autoCapitalize="none"
          keyboardType="email-address"
          value={editor?.email ?? ""}
          onChange={(email) => setEditor({ ...editor, email })}
        />
        <Btn
          onPress={() =>
            void run(async () => {
              await api("/recipients", editor);
              setEditor(null);
              await refresh();
            }, "Recipient saved.")
          }
        >
          Save
        </Btn>
      </Dialog>
      <Dialog
        visible={confirm}
        title="Delete recipients?"
        onClose={() => setConfirm(false)}
      >
        <Copy>
          Delete {selected.length} recipient(s)? Their allocated vouchers will
          return to your organisation.
        </Copy>
        <Row>
          <Btn outline style={{ flex: 1 }} onPress={() => setConfirm(false)}>
            Cancel
          </Btn>
          <Btn
            style={{ flex: 1 }}
            onPress={() =>
              void run(async () => {
                await api("/recipients", { action: "delete", ids: selected });
                setSelected([]);
                setConfirm(false);
                await refresh();
              }, "The selected recipients have been deleted.")
            }
          >
            Proceed
          </Btn>
        </Row>
      </Dialog>
    </Section>
  );
}
