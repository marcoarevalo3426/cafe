import React, { useState } from "react";
import { View, Pressable, Image, Platform, Switch } from "react-native";
import {
  Box,
  Row,
  Copy,
  Small,
  Section,
  Btn,
  Field,
  Select,
  Dialog,
  Asset,
  Link,
  Choice,
} from "./ui";
import { useApp } from "./context";
import { api } from "./api";
import { chooseFile, enablePush, checkUpdate, openLink } from "./platform";
export function Profile() {
  const { data, run, refresh, notice } = useApp();
  const u = data.user!;
  const s = data.stores.find((s) => s.id === u.storeId);
  const [editing, setEditing] = useState(false),
    [name, setName] = useState(u.name),
    [phone, setPhone] = useState(u.phone),
    [storeName, setStoreName] = useState(s?.name ?? ""),
    [address, setAddress] = useState(s?.address ?? ""),
    [currency, setCurrency] = useState(s?.currency ?? "AUD"),
    [logo, setLogo] = useState(s?.logo ?? ""),
    [newEmail, setNewEmail] = useState(""),
    [emailCode, setEmailCode] = useState(""),
    [emailStage, setEmailStage] = useState(false);
  return (
    <Section>
      {editing ? (
        <>
          <Field label="Name" value={name} onChange={setName} />
          {u.role === "owner" && (
            <>
              <Field
                label="Shop name"
                value={storeName}
                onChange={setStoreName}
              />
              <Field
                label="Shop Address"
                value={address}
                onChange={setAddress}
              />
              <Select
                label="Currency"
                value={currency}
                onChange={setCurrency}
                options={["AUD", "USD", "NZD", "GBP", "EUR"].map((c) => ({
                  value: c,
                  label: c,
                }))}
              />
              {logo && (
                <Image
                  source={{ uri: logo }}
                  style={{ width: 80, height: 80 }}
                />
              )}
              <Btn
                outline
                onPress={() =>
                  void run(async () => {
                    const file = await chooseFile(
                      "image/png,image/jpeg,image/webp",
                    );
                    if (file) {
                      if (file.data.length > 180000 || !file.data)
                        throw new Error(
                          "Choose a PNG, JPEG or WebP image smaller than 130 KB.",
                        );
                      setLogo(file.data);
                    }
                  })
                }
              >
                Upload logo
              </Btn>
              {logo && <Link onPress={() => setLogo("")}>Remove logo</Link>}
            </>
          )}
          <Field
            label="Contact number"
            value={phone}
            onChange={setPhone}
            keyboardType="phone-pad"
          />
          <Btn
            onPress={() =>
              void run(async () => {
                await api("/profile", {
                  name,
                  phone,
                  storeName,
                  address,
                  currency,
                  logo,
                });
                await refresh();
                setEditing(false);
              }, "Profile updated.")
            }
          >
            Update
          </Btn>
          <Btn outline onPress={() => setEditing(false)}>
            Cancel
          </Btn>
        </>
      ) : (
        <>
          {s && (
            <>
              <Box>
                <Copy style={{ fontWeight: "700" }}>Shop name:</Copy>
                <Copy>{s.name}</Copy>
              </Box>
              <Box>
                <Copy style={{ fontWeight: "700" }}>Shop Address:</Copy>
                <Copy>{s.address || "Add your shop address"}</Copy>
              </Box>
              {s.logo && (
                <Image
                  source={{ uri: s.logo }}
                  style={{ width: 80, height: 80 }}
                />
              )}
            </>
          )}

          <Box>
            <Copy style={{ fontWeight: "700" }}>
              {u.role === "owner" ? "Shop owner name:" : "Contact name:"}
            </Copy>
            <Copy>{u.name || "Add your name"}</Copy>
          </Box>
          <Box>
            <Copy style={{ fontWeight: "700" }}>Email address:</Copy>
            <Copy>{u.email}</Copy>
          </Box>
          <Box>
            <Copy style={{ fontWeight: "700" }}>Contact number:</Copy>
            <Copy>{u.phone || "Add your contact number"}</Copy>
          </Box>
          <Btn
            style={{ width: 172, alignSelf: "flex-end" }}
            onPress={() => setEditing(true)}
          >
            Modify
          </Btn>
        </>
      )}
      <Box
        style={{
          marginTop: 24,
          paddingTop: 24,
          borderTopWidth: 1,
          borderColor: "#d9d9d9",
        }}
      >
        <Copy style={{ fontWeight: "600" }}>Change email address</Copy>
        <Field
          label="New email address"
          value={newEmail}
          onChange={setNewEmail}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        {emailStage ? (
          <>
            <Field
              label="Verification code"
              value={emailCode}
              onChange={setEmailCode}
              keyboardType="number-pad"
              maxLength={6}
            />
            <Btn
              outline
              onPress={() =>
                void run(async () => {
                  await api("/profile/email/verify", { code: emailCode });
                  await refresh();
                  setEmailStage(false);
                  setEmailCode("");
                  setNewEmail("");
                }, "Email address updated.")
              }
            >
              Verify new email
            </Btn>
          </>
        ) : (
          <Btn
            outline
            onPress={() =>
              void run(async () => {
                const r = await api("/profile/email/request", {
                  email: newEmail,
                });
                setEmailStage(true);
                if (r.developmentCode)
                  notice(`Development inbox code: ${r.developmentCode}`);
              }, "Verification email requested.")
            }
          >
            Send verification code
          </Btn>
        )}
      </Box>
    </Section>
  );
}
export function Settings() {
  const { data, run, refresh, notice } = useApp();
  const u = data.user!;
  const [orders, setOrders] = useState(u.orderNotifications),
    [announcements, setAnnouncements] = useState(u.announcements);
  return (
    <Section>
      <Row>
        <Box style={{ flex: 1 }}>
          <Copy>Order notifications</Copy>
          <Small>New orders and ready-to-collect alerts</Small>
        </Box>
        <Switch
          accessibilityLabel="Order notifications"
          value={orders}
          onValueChange={setOrders}
          trackColor={{ true: "#2c2c2c", false: "#b3b3b3" }}
        />
      </Row>
      <Row>
        <Box style={{ flex: 1 }}>
          <Copy>Announcements</Copy>
          <Small>News and updates from Café</Small>
        </Box>
        <Switch
          accessibilityLabel="Announcements"
          value={announcements}
          onValueChange={setAnnouncements}
          trackColor={{ true: "#2c2c2c", false: "#b3b3b3" }}
        />
      </Row>
      <Btn
        onPress={() =>
          void run(async () => {
            await api("/settings", {
              orderNotifications: orders,
              announcements,
            });
            await refresh();
          }, "Notification preferences saved.")
        }
      >
        Save settings
      </Btn>
      {Platform.OS !== "web" && (
        <Btn
          outline
          onPress={() =>
            void run(async () => {
              const token = await enablePush();
              await api("/devices", { token });
            }, "This device can now receive notifications.")
          }
        >
          Enable device notifications
        </Btn>
      )}
      <Small>
        {Platform.OS === "web"
          ? "Install the iOS or Android app for push notifications while the app is closed."
          : "Allow device notifications to receive alerts while the app is closed."}
      </Small>
      <Btn
        outline
        onPress={() =>
          void run(async () => {
            const available = await checkUpdate();
            notice(
              available
                ? "An update has downloaded. Restart the app to apply it."
                : "You are up to date.",
            );
          })
        }
      >
        Check for app updates
      </Btn>
    </Section>
  );
}
export function PaymentMethods() {
  const { data, run, refresh, notice } = useApp();
  const [remove, setRemove] = useState("");
  return (
    <Section>
      <Copy>Saved payment methods</Copy>
      {data.paymentWarning && <Small>{data.paymentWarning}</Small>}
      {data.cards.map((c) => (
        <Box
          key={c.id}
          style={{
            borderWidth: 1,
            borderColor: "#b3b3b3",
            borderRadius: 10,
            padding: 16,
          }}
        >
          <Copy style={{ fontWeight: "600" }}>
            {c.brand.toUpperCase()} •••• {c.last4}
          </Copy>
          <Small>
            Valid {String(c.exp_month).padStart(2, "0")}/{c.exp_year}
          </Small>
          <Row>
            <Link
              onPress={() =>
                void run(async () => {
                  const r = await api("/cards/setup", {});
                  await openLink(r.url);
                })
              }
            >
              Modify card
            </Link>
            <Link onPress={() => setRemove(c.id)}>Delete card</Link>
          </Row>
        </Box>
      ))}
      {!data.cards.length && <Small>No cards saved.</Small>}
      <Btn
        disabled={!data.paymentsEnabled}
        onPress={() =>
          void run(async () => {
            const r = await api("/cards/setup", {});
            await openLink(r.url);
            notice("Save your card at secure checkout, then return here.");
          })
        }
      >
        Add Card
      </Btn>
      <Small>
        {data.paymentsEnabled
          ? "Enter the name on card, card number, expiry, and CVC at secure checkout. You can save the card for future orders. To change card details, save a replacement and delete the old card."
          : "Card payments need the payment provider configuration before a card can be added."}
      </Small>
      <Btn
        outline
        onPress={() => void run(refresh, "Payment methods refreshed.")}
      >
        Refresh saved cards
      </Btn>
      <Dialog
        visible={!!remove}
        title="Delete card?"
        onClose={() => setRemove("")}
      >
        <Copy>This card will be removed from your saved payment methods.</Copy>
        <Row>
          <Btn outline style={{ flex: 1 }} onPress={() => setRemove("")}>
            Cancel
          </Btn>
          <Btn
            style={{ flex: 1 }}
            onPress={() =>
              void run(async () => {
                await api("/cards/delete", { id: remove });
                setRemove("");
                await refresh();
              }, "Card deleted.")
            }
          >
            Delete card
          </Btn>
        </Row>
      </Dialog>
    </Section>
  );
}
export function Feedback() {
  const { run, nav } = useApp();
  const [rating, setRating] = useState(4),
    [subject, setSubject] = useState("Technical problem"),
    [message, setMessage] = useState(""),
    [sent, setSent] = useState(false);
  return (
    <Section>
      {sent ? (
        <Box style={{ paddingTop: 80, alignItems: "center" }}>
          <Copy style={{ fontSize: 40 }}>✓</Copy>
          <Copy style={{ fontSize: 24, fontWeight: "600" }}>
            Thanks for sharing!
          </Copy>
          <Copy style={{ textAlign: "center" }}>
            Your feedback has been sent successfully.
          </Copy>
          <Btn onPress={() => nav("Profile")}>Done</Btn>
        </Box>
      ) : (
        <>
          <Copy>How do you rate this App?</Copy>
          <Row style={{ justifyContent: "space-between" }}>
            {[1, 2, 3, 4, 5].map((n) => (
              <Pressable
                key={n}
                accessibilityRole="button"
                accessibilityLabel={`${n} star rating`}
                onPress={() => setRating(n)}
                style={{
                  minHeight: 55,
                  minWidth: 44,
                  justifyContent: "center",
                  alignItems: "center",
                }}
              >
                {n <= rating ? (
                  <Asset
                    name="104-231-imgStarFilled.svg"
                    width={55}
                    height={55}
                  />
                ) : (
                  <Copy style={{ fontSize: 48, lineHeight: 55 }}>☆</Copy>
                )}
              </Pressable>
            ))}
          </Row>
          <Row style={{ justifyContent: "space-between" }}>
            <Small style={{ color: "black" }}>Poor</Small>
            <Small style={{ color: "black" }}>Excellent</Small>
          </Row>
          <Copy>Pick a subject and provide your feedback</Copy>
          <Box style={{ gap: 0 }}>
            {[
              "Technical problem",
              "Suggestion for improvement",
              "Compliment",
              "Other",
            ].map((s) => (
              <Choice
                key={s}
                selected={s === subject}
                onPress={() => setSubject(s)}
              >
                {s}
              </Choice>
            ))}
          </Box>
          <Field
            label="Tell us more about your experience"
            value={message}
            onChange={setMessage}
            placeholder="Enter your feedback here"
            multiline
            numberOfLines={7}
            maxLength={4000}
          />
          <Btn
            style={{ width: 173, alignSelf: "flex-end" }}
            onPress={() =>
              void run(async () => {
                await api("/feedback", { rating, subject, message });
                setSent(true);
              })
            }
          >
            Send Feedback
          </Btn>
        </>
      )}
    </Section>
  );
}
