import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  ScrollView,
  Pressable,
  Animated,
  Modal,
  ActivityIndicator,
  useWindowDimensions,
  Platform,
  BackHandler,
  AppState,
  SafeAreaView,
  AccessibilityInfo,
} from "react-native";
import {
  Box,
  Row,
  Copy,
  Small,
  Heading,
  Section,
  Btn,
  Empty,
  Transition,
  Dialog,
  Asset,
} from "./ui";
import { AppContext } from "./context";
import { api, initializeSession, setSession } from "./api";
import {
  checkoutParams,
  clearCheckoutParams,
  prepareFonts,
  preferredStoreId,
} from "./platform";
import type { Bootstrap, CartLine, MenuItem, Order } from "./types";
import Auth from "./Auth";
import MenuBuilder from "./MenuBuilder";
import { Vouchers, GenerateVouchers } from "./Vouchers";
import { MyCafe, CafeMenu, MenuItemScreen, Cart, Success } from "./Customer";
import { Profile, Settings, PaymentMethods, Feedback } from "./Account";
import Admin from "./Admin";
import TestingMode from "./TestingMode";
import { APP_NAME } from "./brand";
const initial: Bootstrap = {
  user: null,
  stores: [],
  menu: [],
  orders: [],
  vouchers: [],
  templates: [],
  demo: false,
  paymentsEnabled: false,
  cards: [],
};
function scopeBootstrap(data: Bootstrap): Bootstrap {
  if (!preferredStoreId || (data.user && data.user.role !== "customer"))
    return data;
  return {
    ...data,
    stores: data.stores.filter((s) => s.id === preferredStoreId),
    menu: data.menu.filter((m) => m.storeId === preferredStoreId),
    orders: data.orders.filter((o) => o.storeId === preferredStoreId),
    vouchers: data.vouchers.filter((v) => v.storeId === preferredStoreId),
  };
}
const home = (data: Bootstrap) =>
  !data.user?.role
    ? "Sign up"
    : data.user.role === "owner"
      ? "Orders"
      : data.user.role === "admin"
        ? "Management"
        : "My Cafe";
export default function App() {
  const [data, setData] = useState(initial),
    [page, setPage] = useState("Sign up"),
    [loading, setLoading] = useState(true),
    [fatal, setFatal] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [drawer, setDrawer] = useState(false),
    [cart, setCart] = useState<CartLine[]>([]),
    [storeId, setStore] = useState(""),
    [selectedItem, setSelectedItem] = useState<MenuItem | null>(null),
    [lastOrder, setLastOrder] = useState<Order | null>(null);
  const { width } = useWindowDimensions();
  const desktop = width >= 1000;
  const slide = useRef(new Animated.Value(240)).current;
  const stack = useRef<string[]>([]);
  const generation = useRef(0),
    lock = useRef(false);
  const current = useRef(data);
  current.current = data;
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const scrollToTop = useCallback(() => {
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, []);
  const refresh = useCallback(async () => {
    const n = ++generation.current;
    const next = scopeBootstrap(await api<Bootstrap>("/bootstrap"));
    if (n === generation.current) {
      current.current = next;
      setData(next);
      setStore((s) => s || next.stores[0]?.id || "");
    }
  }, []);
  const nav = useCallback((next: string) => {
    const user = current.current.user;
    const publicPages = ["Sign up", "My Cafe", "Cafe menu", "Menu item"];
    if (!user && !publicPages.includes(next)) next = "Sign up";
    if (next === "Choose account") {
      if (!current.current.accountRoles?.length) return;
      stack.current = [];
      setCart([]);
      setSelectedItem(null);
      setLastOrder(null);
    }
    setPage((previous) => {
      if (
        previous === "Choose account" ||
        previous === "Sign up" ||
        next === "Choose account"
      )
        stack.current = [];
      else if (previous !== next) stack.current.push(previous);
      return next;
    });
    setDrawer(false);
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, []);
  const run = useCallback(
    async <T,>(
      fn: () => Promise<T>,
      success?: string,
    ): Promise<T | undefined> => {
      if (lock.current) return;
      lock.current = true;
      setBusy(true);
      try {
        const result = await fn();
        if (success) setMessage(success);
        return result;
      } catch (e) {
        setMessage(
          e instanceof Error
            ? e.message
            : "Something went wrong. Please try again.",
        );
        return undefined;
      } finally {
        lock.current = false;
        setBusy(false);
      }
    },
    [],
  );
  const logout = useCallback(async () => {
    await api("/auth/logout", {});
    await setSession(null);
    setCart([]);
    setLastOrder(null);
    setSelectedItem(null);
    stack.current = [];
    await refresh();
    setPage("Sign up");
    setDrawer(false);
  }, [refresh]);
  const start = useCallback(async () => {
    setLoading(true);
    setFatal("");
    try {
      await Promise.all([initializeSession(), prepareFonts()]);
      const next = scopeBootstrap(await api<Bootstrap>("/bootstrap"));
      current.current = next;
      setData(next);
      setStore(next.user?.storeId ?? next.stores[0]?.id ?? "");
      setPage(home(next));
      const params = checkoutParams();
      if (next.user && params.checkout) {
        const r = await api(`/checkout/${params.checkout}`);
        if (r.status === "fulfilled") {
          if (r.result?.lines) {
            setLastOrder(r.result);
            setPage("Payment successful");
          } else {
            setMessage(
              `${r.result?.voucherCount ?? 0} vouchers generated successfully.`,
            );
            setPage("Vouchers");
          }
          await refresh();
        } else
          setMessage(
            "Payment is still pending. Please check your account shortly.",
          );
        clearCheckoutParams();
      }
      if (next.user && params.cancelled) {
        await api("/checkout/cancel", { id: params.cancelled });
        setMessage("Checkout cancelled. Your vouchers have been released.");
        clearCheckoutParams();
      }
    } catch (e) {
      setFatal((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [refresh]);
  useEffect(() => {
    void start();
  }, [start]);
  useEffect(() => {
    const interval = setInterval(() => {
      if (current.current.user) void refresh().catch(() => {});
    }, 10000);
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") void refresh().catch(() => {});
    });
    return () => {
      clearInterval(interval);
      subscription.remove();
    };
  }, [refresh]);
  useEffect(() => {
    if (!drawer) return;
    slide.setValue(240);
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) =>
      Animated.timing(slide, {
        toValue: 0,
        duration: reduce ? 0 : 230,
        useNativeDriver: true,
      }).start(),
    );
  }, [drawer]);
  function back() {
    if (drawer) {
      setDrawer(false);
      return true;
    }
    const previous = stack.current.pop();
    if (previous) {
      setPage(previous);
      return true;
    }
    return false;
  }
  useEffect(() => {
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      back,
    );
    return () => subscription.remove();
  }, [drawer]);
  function changeStore(id: string) {
    if (id !== storeId && cart.length) {
      setMessage("Your cart was cleared because you selected another cafe.");
      setCart([]);
    }
    setStore(id);
  }
  const owner = data.user?.role === "owner",
    admin = data.user?.role === "admin";
  const menu = owner
    ? [
        "Orders",
        "Vouchers",
        "Generate vouchers",
        "Menu",
        "Profile",
        "Settings",
        "Send feedback",
      ]
    : admin
      ? ["Management", "Vouchers", "Generate vouchers", "Profile", "Settings"]
      : [
          "My Cafe",
          "Order history",
          "Profile",
          "Payment method",
          "Vouchers",
          "Settings",
          "Submit feedback",
        ];
  const title =
    page === "Menu item"
      ? (selectedItem?.subcategory ?? "Menu")
      : page === "Cafe menu"
        ? "Menu"
        : page === "Send feedback" || page === "Submit feedback"
          ? "Send your feedback"
          : page;
  const isAuth =
    page === "Sign up" ||
    page === "Choose account" ||
    (!!data.user && !data.user.role);
  function navigation() {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#191919",
          paddingTop: 19,
          paddingHorizontal: 24,
          gap: 8,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close navigation"
          onPress={() => setDrawer(false)}
          style={{
            width: 44,
            height: 44,
            justifyContent: "center",
            alignSelf: "flex-end",
            marginRight: -10,
          }}
        >
          <Hamburger light />
        </Pressable>
        <View style={{ height: 12 }} />
        {menu.map((item) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{
              selected: item === page,
              disabled: !data.user && item !== "My Cafe",
            }}
            disabled={!data.user && item !== "My Cafe"}
            onPress={() => nav(item)}
            style={{
              minHeight: 44,
              justifyContent: "center",
              paddingHorizontal: 12,
              backgroundColor: item === page ? "#2c2c2c" : "transparent",
              borderRadius: 8,
              opacity: !data.user && item !== "My Cafe" ? 0.35 : 1,
            }}
          >
            <Copy style={{ color: "#f5f5f5", textAlign: "right" }}>{item}</Copy>
          </Pressable>
        ))}
        {!!data.user && !!data.accountRoles?.length && (
          <Pressable
            accessibilityRole="button"
            onPress={() => nav("Choose account")}
            style={{ padding: 12, minHeight: 44 }}
          >
            <Copy style={{ color: "#f5f5f5", textAlign: "right" }}>
              Switch account
            </Copy>
          </Pressable>
        )}
        {!!data.user &&
          data.accountRoles?.includes("admin") &&
          data.user.role !== "admin" && <TestingMode />}
        <Pressable
          accessibilityRole="button"
          onPress={() => (data.user ? void run(logout) : nav("Sign up"))}
          style={{ padding: 12, minHeight: 44 }}
        >
          <Copy style={{ color: "#f5f5f5", textAlign: "right" }}>
            {data.user ? "Log out" : "Sign up / Sign in"}
          </Copy>
        </Pressable>
      </View>
    );
  }
  let content: React.ReactNode;
  switch (page) {
    case "Orders":
    case "Order history":
      content = (
        <Orders
          history={page === "Order history"}
          data={data}
          owner={owner}
          complete={(id) =>
            void run(async () => {
              await api("/orders/complete", { id });
              await refresh();
            })
          }
        />
      );
      break;
    case "Menu":
      content = <MenuBuilder />;
      break;
    case "Vouchers":
      content = <Vouchers />;
      break;
    case "Generate vouchers":
      content = <GenerateVouchers />;
      break;
    case "Profile":
      content = <Profile />;
      break;
    case "Settings":
      content = <Settings />;
      break;
    case "Payment method":
      content = <PaymentMethods />;
      break;
    case "Send feedback":
    case "Submit feedback":
      content = <Feedback />;
      break;
    case "Management":
      content = <Admin />;
      break;
    case "My Cafe":
      content = <MyCafe />;
      break;
    case "Cafe menu":
      content = <CafeMenu />;
      break;
    case "Menu item":
      content = <MenuItemScreen key={selectedItem?.id} />;
      break;
    case "View cart":
      content = <Cart />;
      break;
    case "Payment successful":
      content = <Success />;
      break;
    default:
      content = <Empty>Choose a page from the menu.</Empty>;
  }
  return (
    <AppContext.Provider
      value={{
        data,
        refresh,
        nav,
        scrollToTop,
        page,
        run,
        notice: setMessage,
        selectedItem,
        setSelectedItem,
        cart,
        setCart,
        storeId,
        setStoreId: changeStore,
        lastOrder,
        setLastOrder,
        logout,
      }}
    >
      <SafeAreaView
        style={{ flex: 1, backgroundColor: isAuth ? "#e8e8e8" : "#fff" }}
      >
        {loading ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
            }}
          >
            <ActivityIndicator color="#2c2c2c" size="large" />
            <Copy>Loading {APP_NAME}…</Copy>
          </View>
        ) : fatal ? (
          <Section
            style={{
              flex: 1,
              justifyContent: "center",
              maxWidth: 480,
              alignSelf: "center",
            }}
          >
            <Heading>Unable to connect</Heading>
            <Copy>{fatal}</Copy>
            <Btn onPress={() => void start()}>Try again</Btn>
          </Section>
        ) : isAuth ? (
          <Transition route="auth">
            <Auth />
          </Transition>
        ) : (
          <View style={{ flex: 1, flexDirection: "row" }}>
            <View
              style={{
                flex: 1,
                minWidth: 0,
                backgroundColor: page === "Orders" ? "#e8e8e8" : "#fff",
              }}
            >
              <View
                style={{
                  height: 120,
                  backgroundColor: "#fff",
                  borderBottomWidth: 0,
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open navigation"
                  onPress={() => setDrawer(true)}
                  style={{
                    position: "absolute",
                    top: 19,
                    right: 14,
                    width: 44,
                    height: 44,
                    justifyContent: "center",
                    alignItems: "center",
                  }}
                >
                  <Hamburger />
                </Pressable>
                {stack.current.length > 0 && page !== home(data) && (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    onPress={() => back()}
                    style={{
                      position: "absolute",
                      top: 20,
                      left: 16,
                      minHeight: 44,
                      justifyContent: "center",
                    }}
                  >
                    <Row style={{ gap: 4 }}>
                      <Asset
                        name="16-371-imgImage2.png"
                        width={15}
                        height={15}
                        style={{ transform: [{ rotate: "180deg" }] }}
                      />
                      <Copy>Back</Copy>
                    </Row>
                  </Pressable>
                )}
                {page !== "Orders" && (
                  <Asset
                    name={
                      page === "Menu"
                        ? "29-678-imgLine5.svg"
                        : page === "Profile"
                          ? "78-514-imgLine5.svg"
                          : page === "Send feedback" ||
                              page === "Submit feedback"
                            ? "104-231-imgLine5.svg"
                            : page === "Generate vouchers"
                              ? "16-487-imgLine5.svg"
                              : "168-490-imgLine5.svg"
                    }
                    width={width}
                    height={1}
                    style={{ position: "absolute", bottom: 0, left: 0 }}
                  />
                )}
                <Heading
                  accessibilityRole="header"
                  style={{
                    textAlign: "center",
                    position: "absolute",
                    bottom: 17,
                    left: 0,
                    right: 0,
                    pointerEvents: "none",
                  }}
                >
                  {title}
                </Heading>
              </View>
              <Transition route={page}>
                <ScrollView
                  ref={scroll}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{ flexGrow: 1 }}
                >
                  <View
                    style={{
                      width: "100%",
                      maxWidth: desktop ? (page === "Orders" ? 700 : 760) : 760,
                      alignSelf: "center",
                      flex: 1,
                    }}
                  >
                    {content}
                  </View>
                </ScrollView>
              </Transition>
              {page === "Orders" && (
                <View
                  style={{
                    paddingVertical: 28,
                    paddingHorizontal: 20,
                    alignItems: "center",
                  }}
                >
                  <Btn
                    style={{ width: 272, maxWidth: "100%" }}
                    onPress={() => nav("Order history")}
                  >
                    Order history
                  </Btn>
                </View>
              )}
              {(page === "Cafe menu" || page === "Menu item") &&
                cart.length > 0 && (
                  <View
                    style={{
                      padding: 16,
                      backgroundColor: "#fff",
                      borderTopWidth: 1,
                      borderColor: "#d9d9d9",
                    }}
                  >
                    <Btn
                      style={{
                        width: "100%",
                        maxWidth: 500,
                        alignSelf: "center",
                      }}
                      onPress={() => nav("View cart")}
                    >
                      View Cart ({cart.reduce((n, l) => n + l.quantity, 0)})
                    </Btn>
                  </View>
                )}
            </View>
          </View>
        )}
        <Modal
          visible={drawer}
          transparent
          animationType="none"
          onRequestClose={() => setDrawer(false)}
        >
          <View style={{ flex: 1, flexDirection: "row" }}>
            <Pressable
              accessibilityLabel="Close navigation backdrop"
              accessibilityRole="button"
              onPress={() => setDrawer(false)}
              style={{ flex: 1, backgroundColor: "rgba(0,0,0,.08)" }}
            />
            <Animated.View
              accessibilityViewIsModal
              style={{ width: 240, transform: [{ translateX: slide }] }}
            >
              {navigation()}
            </Animated.View>
          </View>
        </Modal>
        <Dialog
          visible={!!message}
          title={APP_NAME}
          onClose={() => setMessage("")}
        >
          <Copy>{message}</Copy>
          <Btn onPress={() => setMessage("")}>OK</Btn>
        </Dialog>
        {busy && (
          <View
            accessibilityRole="progressbar"
            accessibilityLabel="Processing"
            style={{
              position: "absolute",
              top: 0,
              right: 0,
              bottom: 0,
              left: 0,
              backgroundColor: "rgba(255,255,255,.45)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ActivityIndicator size="large" color="#2c2c2c" />
          </View>
        )}
      </SafeAreaView>
    </AppContext.Provider>
  );
}
function Hamburger({ light = false }: { light?: boolean }) {
  return (
    <View style={{ width: 28, gap: 5 }}>
      {[1, 2, 3].map((n) => (
        <View
          key={n}
          style={{
            height: 3,
            borderRadius: 2,
            backgroundColor: light ? "#fff" : "#2c2c2c",
          }}
        />
      ))}
    </View>
  );
}
function Orders({
  history,
  data,
  owner,
  complete,
}: {
  history: boolean;
  data: Bootstrap;
  owner: boolean;
  complete: (id: string) => void;
}) {
  const orders = data.orders.filter((o) =>
    owner
      ? history
        ? o.status === "done" &&
          new Date(o.completedAt ?? o.createdAt).toDateString() ===
            new Date().toDateString()
        : o.status === "incoming"
      : true,
  );
  return (
    <Section style={{ gap: 30 }}>
      {!orders.length && (
        <Empty>
          {history ? "No orders in your history yet." : "No orders yet"}
        </Empty>
      )}
      {orders.map((o, i) => (
        <Pressable
          accessibilityRole={owner && !history ? "button" : undefined}
          accessibilityLabel={
            owner && !history ? `Complete order for ${o.customer}` : undefined
          }
          disabled={!owner || history}
          key={o.id}
          onPress={() => complete(o.id)}
          style={{
            padding: 24,
            gap: 10,
            minHeight: 100,
            justifyContent: "center",
            backgroundColor: "#fff",
            borderRadius: 10,
            borderWidth: history || i === 0 ? 2 : 0,
            borderColor: history ? "#b3b3b3" : "#000",
          }}
        >
          {o.lines.map((l, j) => (
            <Copy key={j} style={{ textAlign: "center" }}>
              {l.quantity} x {l.name}
              {l.description ? ", " + l.description : ""}
              {l.note ? `\nNote: ${l.note}` : ""}
            </Copy>
          ))}
          <Copy style={{ fontWeight: "700", textAlign: "center" }}>
            {o.customer.includes("@")
              ? o.customer
              : o.customer
                  .split(" ")
                  .map((n, j) => (j === 0 ? n : n[0] + "."))
                  .join(" ")}
          </Copy>
          {!owner && (
            <Small style={{ textAlign: "center" }}>
              {o.status === "done" ? "Ready to collect" : "Preparing"} · #
              {o.id.slice(0, 8)}
            </Small>
          )}
        </Pressable>
      ))}
    </Section>
  );
}
