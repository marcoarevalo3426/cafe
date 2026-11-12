import React, { useState } from "react";
import { Btn, Dialog, Small } from "./ui";
import { useApp } from "./context";
import { api, setSession } from "./api";
import { localTestingClient } from "./platform";
import type { Role, User } from "./types";

export default function TestingMode() {
  const {
    data,
    run,
    refresh,
    nav,
    setCart,
    setSelectedItem,
    setLastOrder,
    setStoreId,
  } = useApp();
  const [open, setOpen] = useState(false);
  if (!data.testingModeAvailable || !localTestingClient()) return null;
  async function login(role: Role) {
    await run(async () => {
      const result = await api<{ user: User; token?: string }>(
        "/auth/testing",
        { role },
      );
      await setSession(result.token ?? null);
      setCart([]);
      setSelectedItem(null);
      setLastOrder(null);
      await refresh();
      setStoreId(result.user.storeId ?? "demo-cafe");
      setOpen(false);
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
    <>
      <Btn outline onPress={() => setOpen(true)}>
        Testing mode
      </Btn>
      <Dialog
        visible={open}
        title="Testing mode"
        onClose={() => setOpen(false)}
      >
        <Small>
          Local demo only. Choose a test account to sign in without an email
          code.
        </Small>
        {(
          [
            { role: "customer", label: "Customer" },
            { role: "owner", label: "Cafe owner" },
            { role: "organisation", label: "Organisation" },
            { role: "admin", label: "Admin" },
          ] as const
        ).map((account) => (
          <Btn key={account.role} onPress={() => void login(account.role)}>
            {account.label}
          </Btn>
        ))}
      </Dialog>
    </>
  );
}
