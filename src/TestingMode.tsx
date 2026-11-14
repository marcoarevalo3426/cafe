import React, { useState } from "react";
import { Btn, Dialog, Small } from "./ui";
import { useApp } from "./context";
import { api, setSession } from "./api";
import { localTestingClient } from "./platform";
import type { Role, User } from "./types";
import { testingAccountChoices } from "./account-choices";
import { isAdminEmail } from "./allowed-accounts";

export default function TestingMode({ email }: { email?: string }) {
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
  async function openTesting() {
    if (!isAdminEmail(email)) {
      setOpen(true);
      return;
    }
    await run(async () => {
      const result = await api<{ user: User; token?: string }>(
        "/auth/testing",
        { email },
      );
      await setSession(result.token ?? null);
      setCart([]);
      setSelectedItem(null);
      setLastOrder(null);
      await refresh();
      nav("Choose account");
    });
  }
  async function login(role: Role) {
    await run(async () => {
      // Admin uses the existing verified session; demo login cannot grant it.
      if (role === "admin") {
        const user = await api<User>("/auth/role", { role });
        await finish(user);
        return;
      }
      const result = await api<{ user: User; token?: string }>(
        "/auth/testing",
        { role },
      );
      await setSession(result.token ?? null);
      await finish(result.user);
    });
    async function finish(user: User) {
      setCart([]);
      setSelectedItem(null);
      setLastOrder(null);
      await refresh();
      setStoreId(user.storeId ?? "demo-cafe");
      setOpen(false);
      nav(
        role === "admin"
          ? "Management"
          : role === "owner"
            ? "Orders"
            : "My Cafe",
      );
    }
  }
  return (
    <>
      <Btn outline onPress={() => void openTesting()}>
        Testing mode
      </Btn>
      <Dialog
        visible={open}
        title="Testing mode"
        onClose={() => setOpen(false)}
      >
        <Small>
          Local demo only. Choose an account without an email code. Admin is
          available only to designated test accounts.
        </Small>
        {testingAccountChoices(data).map((account) => (
          <Btn key={account.role} onPress={() => void login(account.role)}>
            {account.label}
          </Btn>
        ))}
      </Dialog>
    </>
  );
}
