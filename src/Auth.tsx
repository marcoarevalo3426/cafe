import React, { useState, useRef, useEffect } from "react";
import { View, TextInput, KeyboardAvoidingView, Platform } from "react-native";
import { Box, Copy, Card, Btn, Field, ErrorText, Small, Link } from "./ui";
import { api, setSession } from "./api";
import { emailValid, type Role } from "./types";
import { useApp } from "./context";
import TestingMode from "./TestingMode";
import { accountChoices } from "./account-choices";
export default function Auth() {
  const { data, refresh, nav, run, setStoreId, logout } = useApp();
  const [stage, setStage] = useState<"email" | "verify" | "role">(
    data.user ? "role" : "email",
  );
  const [email, setEmail] = useState(""),
    [code, setCode] = useState(Array(6).fill("")),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [devCode, setDevCode] = useState(""),
    [expires, setExpires] = useState(0),
    [now, setNow] = useState(Date.now());
  const fields = useRef<(React.ComponentRef<typeof TextInput> | null)[]>([]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  async function send() {
    setError("");
    if (!emailValid(email.trim())) {
      setError("Invalid email address. Please try again.");
      return;
    }
    setBusy(true);
    try {
      const r = await api("/auth/request", { email });
      setExpires(r.expiresAt);
      setNow(Date.now());
      setDevCode(r.developmentCode ?? "");
      setCode(Array(6).fill(""));
      setStage("verify");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setError("");
    if (code.join("").length !== 6) {
      setError("Invalid code. Please try again.");
      return;
    }
    setBusy(true);
    try {
      const r = await api("/auth/verify", { email, code: code.join("") });
      if (r.token) await setSession(r.token);
      await refresh();
      if (!r.user.role) setStage("role");
      else
        nav(
          r.user.role === "owner"
            ? "Orders"
            : r.user.role === "organisation"
              ? "Vouchers"
              : r.user.role === "admin"
                ? "Management"
                : "My Cafe",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function role(role: Role) {
    await run(async () => {
      const user = await api("/auth/role", { role });
      await refresh();
      setStoreId(user.storeId ?? "");
      nav(
        role === "admin"
          ? "Management"
          : role === "owner"
            ? "Orders"
            : role === "organisation"
              ? "Vouchers"
              : "My Cafe",
      );
    });
  }
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{
        flex: 1,
        backgroundColor: "#e8e8e8",
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 24,
      }}
    >
      <Card style={{ width: 320, maxWidth: "100%", gap: 24 }}>
        {stage === "email" ? (
          <>
            <Field
              label="Email"
              value={email}
              onChange={setEmail}
              placeholder="you@example.com"
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              onSubmitEditing={() => void send()}
            />
            <Btn disabled={busy} onPress={() => void send()}>
              {busy ? "Sending…" : "Sign up"}
            </Btn>
            <TestingMode />
            {error && <ErrorText>{error}</ErrorText>}
          </>
        ) : stage === "verify" ? (
          <>
            <Box style={{ gap: 4 }}>
              <Copy>Verify your email address</Copy>
              <Small style={{ color: "#b3b3b3" }}>
                Check your email and enter the code here
              </Small>
            </Box>
            <View
              style={{
                flexDirection: "row",
                gap: 10,
                justifyContent: "center",
              }}
            >
              {code.map((digit, i) => (
                <TextInput
                  ref={(r) => {
                    fields.current[i] = r;
                  }}
                  key={i}
                  accessibilityLabel={`Code digit ${i + 1}`}
                  value={digit}
                  keyboardType="number-pad"
                  selectTextOnFocus
                  maxLength={6}
                  onKeyPress={(e) => {
                    if (e.nativeEvent.key === "Backspace" && !code[i] && i > 0)
                      fields.current[i - 1]?.focus();
                  }}
                  onChangeText={(value) => {
                    const digits = value.replace(/\D/g, "");
                    const next = [...code];
                    if (digits.length > 1) {
                      for (let j = i; j < Math.min(6, i + digits.length); j++)
                        next[j] = digits[j - i];
                      setCode(next);
                      fields.current[Math.min(5, i + digits.length)]?.focus();
                    } else {
                      next[i] = digits;
                      setCode(next);
                      if (digits && i < 5) fields.current[i + 1]?.focus();
                    }
                  }}
                  style={{
                    width: 31,
                    height: 44,
                    borderWidth: 1,
                    borderColor: "#d9d9d9",
                    borderRadius: 8,
                    textAlign: "center",
                    fontSize: 20,
                    color: "#1e1e1e",
                  }}
                />
              ))}
            </View>
            <Box style={{ gap: 8 }}>
              <Btn disabled={busy} onPress={() => void verify()}>
                {busy ? "Verifying…" : "Verify"}
              </Btn>
              {error ? (
                <ErrorText>{error}</ErrorText>
              ) : (
                <Small style={{ color: "#bf6a02", textAlign: "center" }}>
                  The code will expire in{" "}
                  {Math.max(0, Math.ceil((expires - now) / 1000))} seconds
                </Small>
              )}
            </Box>
          </>
        ) : (
          <>
            <Copy>
              {data.accountRoles?.length ? "Choose account" : "Sign up as"}
            </Copy>
            {accountChoices(data).map((account) => (
              <Btn key={account.role} onPress={() => void role(account.role)}>
                {account.label}
              </Btn>
            ))}
            {data.user && <Link onPress={() => void run(logout)}>Log out</Link>}
          </>
        )}
      </Card>
      {stage === "verify" && (
        <Box
          style={{
            position: "absolute",
            top: "50%",
            marginTop: 140,
            alignItems: "center",
            gap: 4,
          }}
        >
          <Link onPress={() => void send()}>Resend code</Link>
          <Link
            onPress={() => {
              setStage("email");
              setError("");
            }}
          >
            Change email
          </Link>
          {data.demo && devCode && (
            <Small testID="development-code">
              Development inbox code: {devCode}
            </Small>
          )}
        </Box>
      )}
      {stage === "email" && (
        <View
          style={{ position: "absolute", bottom: 24, alignItems: "center" }}
        >
          <Link onPress={() => nav("My Cafe")}>Browse cafes</Link>
          {data.demo && (
            <Small>Development demo · email delivery is simulated</Small>
          )}
        </View>
      )}
    </KeyboardAvoidingView>
  );
}
