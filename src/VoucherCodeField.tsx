import React, { useEffect, useRef, useState } from "react";
import { Box, Row, Copy, Field, Btn, ErrorText, Small } from "./ui";
import { api } from "./api";
import { money, type VerifiedVoucher } from "./types";
import { useApp } from "./context";

export function VoucherCodeField({
  storeId,
  disabled = false,
  initialVoucher = null,
  onVerified,
}: {
  storeId: string;
  disabled?: boolean;
  initialVoucher?: VerifiedVoucher | null;
  onVerified: (voucher: VerifiedVoucher | null) => void;
}) {
  const { refresh } = useApp();
  const [code, setCode] = useState(initialVoucher?.code ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState<VerifiedVoucher | null>(
    initialVoucher,
  );
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  async function verify() {
    if (disabled || busy) return;
    const current = ++request.current;
    setBusy(true);
    setError("");
    setVerified(null);
    onVerified(null);
    try {
      const voucher = await api<VerifiedVoucher>("/vouchers/verify", {
        code: code.trim(),
        storeId,
      });
      await refresh();
      if (request.current !== current) return;
      setVerified(voucher);
      onVerified(voucher);
    } catch (e) {
      if (request.current !== current) return;
      setError(e instanceof Error ? e.message : "Invalid voucher.");
    } finally {
      if (request.current === current) setBusy(false);
    }
  }
  return (
    <Box style={{ gap: 8 }}>
      <Copy>Voucher code</Copy>
      <Row>
        <Field
          accessibilityLabel="Voucher code"
          placeholder="Enter voucher code"
          autoCapitalize="none"
          autoCorrect={false}
          value={code}
          editable={!disabled}
          style={{ flex: 1 }}
          onChange={(value) => {
            request.current++;
            setBusy(false);
            setCode(value);
            setError("");
            setVerified(null);
            onVerified(null);
          }}
          onSubmitEditing={() => void verify()}
        />
        <Btn disabled={disabled || busy} onPress={() => void verify()}>
          {busy ? "Verifying…" : "Verify"}
        </Btn>
      </Row>
      {error && <ErrorText>{error}</ErrorText>}
      {verified && (
        <Small>
          Voucher verified and added to your account:{" "}
          {money(verified.balance, verified.currency)} available.
        </Small>
      )}
    </Box>
  );
}
