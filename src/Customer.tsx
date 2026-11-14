import React, { useRef, useState } from "react";
import { View, Pressable } from "react-native";
import {
  Box,
  Row,
  Copy,
  Small,
  Section,
  Btn,
  Field,
  Choice,
  Empty,
  Link,
  Select,
} from "./ui";
import { useApp } from "./context";
import { money, type CartLine, type VerifiedVoucher } from "./types";
import { VoucherCodeField } from "./VoucherCodeField";
import { api, requestKey } from "./api";
import { externalLink, openLink } from "./platform";
import {
  cartVoucherBalance,
  cartPaymentMethod,
  type CartPaymentChoice,
  type CartPaymentMethod,
} from "./cart-payment";
export function MyCafe() {
  const { data, nav, setStoreId } = useApp();
  return (
    <Section>
      <Row style={{ flexWrap: "wrap", gap: 16 }}>
        <Pressable
          accessibilityRole="button"
          onPress={() => (data.user ? nav("Vouchers") : nav("Sign up"))}
          style={{
            minHeight: 85,
            flexBasis: 173,
            flexGrow: 1,
            backgroundColor: "#d9d9d9",
            borderRadius: 10,
            justifyContent: "center",
            alignItems: "center",
            padding: 16,
          }}
        >
          <Copy style={{ fontWeight: "600" }}>Buy Vouchers</Copy>
        </Pressable>
        {data.stores.map((s) => (
          <Pressable
            accessibilityRole="button"
            key={s.id}
            onPress={() => {
              setStoreId(s.id);
              nav("Cafe menu");
            }}
            style={{
              minHeight: 85,
              flexBasis: 173,
              flexGrow: 1,
              backgroundColor: "#d9d9d9",
              borderRadius: 10,
              justifyContent: "center",
              alignItems: "center",
              padding: 16,
            }}
          >
            <Copy style={{ fontWeight: "600" }}>{s.name}</Copy>
          </Pressable>
        ))}
      </Row>
      {!data.stores.length && <Empty>No cafes are available yet.</Empty>}
    </Section>
  );
}
export function CafeMenu() {
  const { data, nav, storeId, setSelectedItem, cart } = useApp();
  const [filter, setFilter] = useState("All");
  const store = data.stores.find((s) => s.id === storeId);
  const menu = data.menu.filter((m) => m.storeId === storeId);
  const categories = ["All", ...new Set(menu.map((m) => m.category))];
  return (
    <Section>
      <Copy style={{ fontSize: 20, fontWeight: "600" }}>
        {store?.name ?? "Cafe"}
      </Copy>
      {store?.address && (
        <Box style={{ gap: 0 }}>
          <Small>{store.address}</Small>
          <Link
            onPress={() =>
              void externalLink(
                `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(store.address)}`,
              )
            }
          >
            Locate on map
          </Link>
        </Box>
      )}
      <Select
        label="Category"
        value={filter}
        onChange={setFilter}
        options={categories.map((c) => ({ value: c, label: c }))}
      />
      {menu
        .filter((m) => filter === "All" || m.category === filter)
        .map((item) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Order ${item.subcategory}`}
            key={item.id}
            onPress={() => {
              setSelectedItem(item);
              nav("Menu item");
            }}
            style={{
              paddingVertical: 20,
              borderBottomWidth: 1,
              borderColor: "#d9d9d9",
              gap: 8,
            }}
          >
            <Row>
              <Copy style={{ flex: 1, fontWeight: "600" }}>
                {item.subcategory}
              </Copy>
              <Copy>＋</Copy>
            </Row>
            <Small>{item.category}</Small>
            <Copy>
              {money(
                item.groups.reduce(
                  (s, g) => s + Math.min(...g.variations.map((v) => v.amount)),
                  0,
                ),
                store?.currency,
              )}
              +
            </Copy>
          </Pressable>
        ))}
      {!menu.length && <Empty>The cafe is still preparing its menu.</Empty>}
      {cart.length > 0 && (
        <Btn onPress={() => nav(data.user ? "View cart" : "Sign up")}>
          View Cart ({cart.reduce((s, l) => s + l.quantity, 0)})
        </Btn>
      )}
    </Section>
  );
}
export function MenuItemScreen() {
  const {
    selectedItem: item,
    data,
    storeId,
    cart,
    setCart,
    nav,
    notice,
  } = useApp();
  const [choices, setChoices] = useState<Record<string, string>>({}),
    [quantity, setQuantity] = useState(1),
    [note, setNote] = useState("");
  if (!item) return <Empty>Select an item from the cafe menu.</Empty>;
  const total =
    item.groups.reduce(
      (sum, g) =>
        sum + (g.variations.find((v) => v.id === choices[g.id])?.amount ?? 0),
      0,
    ) * quantity;
  function add() {
    if (item!.groups.some((g) => !choices[g.id])) {
      notice("Select a variation for each item.");
      return;
    }
    setCart([
      ...cart,
      { itemId: item!.id, selections: choices, quantity, note },
    ]);
    nav("View cart");
  }
  return (
    <Section>
      <Copy style={{ fontSize: 24, fontWeight: "600" }}>
        {item.subcategory}
      </Copy>
      {item.groups.map((g) => (
        <Box key={g.id} style={{ backgroundColor: "#e8e8e8", padding: 16 }}>
          <Copy style={{ fontWeight: "600" }}>{g.name.toUpperCase()}</Copy>
          <Row style={{ flexWrap: "wrap", gap: 12 }}>
            {g.variations.map((v) => (
              <Btn
                key={v.id}
                outline={choices[g.id] !== v.id}
                onPress={() => setChoices({ ...choices, [g.id]: v.id })}
              >
                {v.name} ·{" "}
                {money(
                  v.amount,
                  data.stores.find((s) => s.id === storeId)?.currency,
                )}
              </Btn>
            ))}
          </Row>
        </Box>
      ))}
      <Field
        label="Note"
        placeholder="Anything we should know?"
        value={note}
        onChange={setNote}
        multiline
        maxLength={500}
      />
      <Row style={{ justifyContent: "center" }}>
        <Btn
          label="Decrease quantity"
          outline
          disabled={quantity === 1}
          onPress={() => setQuantity(quantity - 1)}
        >
          −
        </Btn>
        <Copy accessibilityLabel="Quantity">{quantity}</Copy>
        <Btn
          label="Increase quantity"
          outline
          disabled={quantity === 99}
          onPress={() => setQuantity(quantity + 1)}
        >
          +
        </Btn>
      </Row>
      <Btn
        onPress={() => {
          if (!data.user) {
            notice("Sign in before adding items to your cart.");
            nav("Sign up");
            return;
          }
          add();
        }}
      >
        Add to cart ·{" "}
        {money(total, data.stores.find((s) => s.id === storeId)?.currency)}
      </Btn>
      <Btn outline onPress={() => nav(cart.length ? "View cart" : "Cafe menu")}>
        View Cart ({cart.length})
      </Btn>
    </Section>
  );
}
export function Cart() {
  const {
    data,
    cart,
    setCart,
    storeId,
    nav,
    run,
    refresh,
    setLastOrder,
    notice,
  } = useApp();
  const [paymentChoice, setPaymentChoice] = useState<CartPaymentChoice | null>(
      null,
    ),
    [pending, setPending] = useState(""),
    [editIndex, setEditIndex] = useState<number | null>(null);
  const key = useRef(requestKey());
  const [verifiedVoucher, setVerifiedVoucher] =
    useState<VerifiedVoucher | null>(null);
  const store = data.stores.find((s) => s.id === storeId);
  let total = 0;
  const rows = cart.map((line, index) => {
    const item = data.menu.find((m) => m.id === line.itemId);
    const variants =
      item?.groups
        .map((g) => g.variations.find((v) => v.id === line.selections[g.id]))
        .filter(Boolean) ?? [];
    const unit = variants.reduce((sum, v) => sum + v!.amount, 0);
    total += unit * line.quantity;
    return { line, index, item, unit, variants };
  });
  const balance = cartVoucherBalance(
    data.vouchers,
    storeId,
    data.user?.email,
    pending,
    Date.now(),
    verifiedVoucher,
  );
  const selectedPayment = cartPaymentMethod(balance, storeId, paymentChoice);
  const useVoucher = selectedPayment === "voucher";
  const applied = useVoucher ? Math.min(total, balance) : 0;
  const remaining = total - applied;
  function selectPayment(method: CartPaymentMethod) {
    if (pending || (method === "voucher" && balance <= 0)) return;
    setPaymentChoice({ storeId, method });
    key.current = requestKey();
  }
  async function submit() {
    await run(async () => {
      if (!cart.length) throw new Error("Your cart is empty.");
      const r = await api(
        "/checkout",
        {
          type: "order",
          storeId,
          lines: cart,
          useVouchers: useVoucher,
          ...(useVoucher && verifiedVoucher?.storeId === storeId
            ? { voucherCode: verifiedVoucher.code }
            : {}),
          payment: "card",
        },
        { "Idempotency-Key": key.current },
      );
      if (r.url) {
        setPending(r.checkoutId);
        await openLink(r.url);
      } else {
        setLastOrder(r.result);
        setCart([]);
        await refresh();
        nav("Payment successful");
      }
    });
  }
  async function check() {
    await run(async () => {
      const r = await api(`/checkout/${pending}`);
      if (r.status === "fulfilled") {
        setLastOrder(r.result);
        setCart([]);
        await refresh();
        nav("Payment successful");
      } else
        notice(
          "Your payment is still pending. Complete checkout or cancel it to release your vouchers.",
        );
    });
  }
  return (
    <Section>
      {!cart.length ? (
        <Empty>Your cart is empty.</Empty>
      ) : (
        <>
          {rows.map(({ line, index, item, unit, variants }) => (
            <Box
              key={index}
              style={{
                paddingBottom: 20,
                borderBottomWidth: 1,
                borderColor: "#d9d9d9",
              }}
            >
              <Row>
                <Copy style={{ flex: 1, fontWeight: "600" }}>
                  {item?.subcategory ?? "Unavailable item"}
                </Copy>
                <Copy>{money(unit * line.quantity, store?.currency)}</Copy>
              </Row>
              <Small>{variants.map((v) => v!.name).join(", ")}</Small>
              {line.note && <Small>Note: {line.note}</Small>}
              <Link
                disabled={!!pending}
                onPress={() => setEditIndex(editIndex === index ? null : index)}
              >
                Modify item
              </Link>
              {editIndex === index && (
                <Box>
                  {item?.groups.map((g) => (
                    <Select
                      key={g.id}
                      label={g.name}
                      value={line.selections[g.id] ?? ""}
                      options={g.variations.map((v) => ({
                        value: v.id,
                        label: `${v.name} · ${money(v.amount, store?.currency)}`,
                      }))}
                      onChange={(value) => {
                        key.current = requestKey();
                        setCart(
                          cart.map((x, i) =>
                            i === index
                              ? {
                                  ...x,
                                  selections: {
                                    ...x.selections,
                                    [g.id]: value,
                                  },
                                }
                              : x,
                          ),
                        );
                      }}
                    />
                  ))}
                  <Field
                    label="Note"
                    value={line.note}
                    onChange={(note) => {
                      key.current = requestKey();
                      setCart(
                        cart.map((x, i) => (i === index ? { ...x, note } : x)),
                      );
                    }}
                    multiline
                    maxLength={500}
                  />
                </Box>
              )}
              <Row>
                <Btn
                  small
                  outline
                  disabled={!!pending || line.quantity === 1}
                  label={`Decrease ${item?.subcategory} quantity`}
                  onPress={() => {
                    key.current = requestKey();
                    setCart(
                      cart.map((x, i) =>
                        i === index ? { ...x, quantity: x.quantity - 1 } : x,
                      ),
                    );
                  }}
                >
                  −
                </Btn>
                <Copy>{line.quantity}</Copy>
                <Btn
                  small
                  outline
                  disabled={!!pending || line.quantity === 99}
                  label={`Increase ${item?.subcategory} quantity`}
                  onPress={() => {
                    key.current = requestKey();
                    setCart(
                      cart.map((x, i) =>
                        i === index ? { ...x, quantity: x.quantity + 1 } : x,
                      ),
                    );
                  }}
                >
                  +
                </Btn>
                <Link
                  disabled={!!pending}
                  onPress={() => {
                    key.current = requestKey();
                    setCart(cart.filter((_, i) => i !== index));
                  }}
                >
                  Remove
                </Link>
              </Row>
            </Box>
          ))}
          <Link disabled={!!pending} onPress={() => nav("Cafe menu")}>
            Add more items
          </Link>
          <VoucherCodeField
            key={storeId}
            storeId={storeId}
            initialVoucher={
              verifiedVoucher?.storeId === storeId ? verifiedVoucher : null
            }
            disabled={!!pending}
            onVerified={(voucher) => {
              setVerifiedVoucher(voucher);
              if (voucher) setPaymentChoice({ storeId, method: "voucher" });
              key.current = requestKey();
            }}
          />
          <Copy style={{ fontWeight: "600" }}>Payment method</Copy>
          <View
            accessibilityRole="radiogroup"
            accessibilityLabel="Payment method"
          >
            <Choice
              selected={useVoucher}
              disabled={!!pending || balance <= 0}
              onPress={() => selectPayment("voucher")}
            >
              Voucher ({money(balance, store?.currency)})
            </Choice>
            <Choice
              selected={selectedPayment === "card"}
              disabled={!!pending}
              onPress={() => selectPayment("card")}
            >
              {data.cards.length
                ? "Use existing card / Apple Pay / Google Pay"
                : "Card / Apple Pay / Google Pay"}
            </Choice>
          </View>
          {useVoucher && applied > 0 && (
            <Small>
              Voucher credit applied: {money(applied, store?.currency)}. Voucher
              balance after this order:{" "}
              {money(balance - applied, store?.currency)}.
            </Small>
          )}
          <Row accessibilityLiveRegion="polite">
            <Copy style={{ flex: 1, fontWeight: "600" }}>
              Remaining to pay by card
            </Copy>
            <Copy style={{ fontWeight: "600" }}>
              {money(remaining, store?.currency)}
            </Copy>
          </Row>
          {remaining > 0 && (
            <>
              {useVoucher && (
                <Small>
                  Your remaining balance will be paid by Card / Apple Pay /
                  Google Pay at checkout.
                </Small>
              )}
              <Link disabled={!!pending} onPress={() => nav("Payment method")}>
                Add Credit Card
              </Link>
              <Small>
                {data.paymentsEnabled
                  ? "Available wallets and saved cards appear at secure checkout."
                  : "Card payments are not configured. An order can be placed using vouchers that cover the full total."}
              </Small>
            </>
          )}
          <Box>
            <Row>
              <Copy style={{ flex: 1 }}>Subtotal</Copy>
              <Copy>{money(total, store?.currency)}</Copy>
            </Row>
            {applied > 0 && (
              <Row>
                <Copy style={{ flex: 1 }}>Vouchers</Copy>
                <Copy>−{money(applied, store?.currency)}</Copy>
              </Row>
            )}
            <Row>
              <Copy style={{ flex: 1, fontWeight: "600" }}>Total to pay</Copy>
              <Copy style={{ fontWeight: "600" }}>
                {money(remaining, store?.currency)}
              </Copy>
            </Row>
          </Box>
          {pending ? (
            <>
              <Btn onPress={() => void check()}>Check payment status</Btn>
              <Btn
                outline
                onPress={() =>
                  void run(async () => {
                    await api("/checkout/cancel", { id: pending });
                    setPending("");
                    key.current = requestKey();
                    await refresh();
                  }, "Checkout cancelled.")
                }
              >
                Cancel checkout
              </Btn>
            </>
          ) : (
            <Btn
              disabled={remaining > 0 && !data.paymentsEnabled}
              onPress={() => void submit()}
            >
              Submit Order
            </Btn>
          )}
        </>
      )}
    </Section>
  );
}
export function Success() {
  const { lastOrder: order, nav, data } = useApp();
  return (
    <Section>
      <Copy style={{ fontSize: 26, textAlign: "center", marginTop: 40 }}>
        ✓
      </Copy>
      <Copy style={{ fontWeight: "600", textAlign: "center", fontSize: 22 }}>
        Payment successful
      </Copy>
      <Copy style={{ textAlign: "center" }}>
        Your order will be ready shortly. Thank you.
      </Copy>
      {order && (
        <Box>
          {order.lines.map((l, i) => (
            <Copy key={i}>
              {l.quantity} x {l.name} · {l.description}
            </Copy>
          ))}
          <Copy style={{ fontWeight: "600" }}>
            Total:{" "}
            {money(
              order.total,
              data.stores.find((s) => s.id === order.storeId)?.currency,
            )}
          </Copy>
          {order.voucherAmount > 0 && (
            <Small>Paid with vouchers: {money(order.voucherAmount)}</Small>
          )}
          <Small>Order #{order.id.slice(0, 8)}</Small>
        </Box>
      )}
      <Btn onPress={() => nav("My Cafe")}>Back to My Cafe</Btn>
      <Btn outline onPress={() => nav("Order history")}>
        Order history
      </Btn>
    </Section>
  );
}
