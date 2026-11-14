import { createHash } from "node:crypto";
import type { Storage } from "./storage";

// One-time compatibility upgrade for databases created before direct accounts.
// Originals are archived before the retired entities and links are removed.
export async function migrateAccounts(db: Storage) {
  const id = "direct-voucher-accounts-v1";
  if (await db.get("migrations", id)) return;
  await db.atomic(async () => {
    if (await db.get("migrations", id)) return;
    const archive = (kind: string, record: any) =>
      db.put("legacy_archive", {
        id: createHash("sha256").update(`${kind}/${record.id}`).digest("hex"),
        sourceKind: kind,
        record,
      });
    const companies = await db.list<any>("organisations");
    const users = await db.list<any>("users");
    const stores = await db.list<any>("stores");
    for (const user of users) {
      if (user.role !== "organisation" && user.orgId === undefined) continue;
      await archive("users", user);
      const { orgId, ...account } = user;
      if (account.role === "organisation") account.role = "customer";
      await db.put("users", account);
    }
    for (const session of await db.list<any>("sessions")) {
      if (session.activeRole !== "organisation") continue;
      await archive("sessions", session);
      await db.put("sessions", { ...session, activeRole: "customer" });
    }
    for (const voucher of await db.list<any>("vouchers")) {
      if (voucher.orgId === undefined) continue;
      await archive("vouchers", voucher);
      const { orgId, ...credit } = voucher;
      const company = companies.find((c) => c.id === orgId);
      const store = stores.find((s) => s.id === voucher.storeId);
      const owner = users.find((u) => u.id === store?.ownerId);
      if (!credit.email && (company?.email || owner?.email))
        credit.email = company?.email || owner.email;
      await db.put("vouchers", credit);
    }
    for (const checkout of await db.list<any>("checkouts")) {
      if (
        checkout.type !== "vouchers" ||
        !["orgId", "orgName", "orgEmail"].some((k) => k in checkout.payload)
      )
        continue;
      await archive("checkouts", checkout);
      const { orgId, orgName, orgEmail, ...payload } = checkout.payload;
      const company = companies.find((c) => c.id === orgId);
      const account = users.find((u) => u.id === checkout.userId);
      payload.assignedEmail = company?.email || orgEmail || account?.email;
      let result = checkout.result;
      if (result?.organisation) {
        const { organisation, ...rest } = result;
        result = {
          ...rest,
          assignedEmail: organisation.email || payload.assignedEmail,
        };
      }
      await db.put("checkouts", {
        ...checkout,
        payload,
        ...(result ? { result } : {}),
      });
    }
    for (const kind of ["organisations", "recipients"]) {
      for (const record of await db.list<any>(kind)) {
        await archive(kind, record);
        await db.delete(kind, record.id);
      }
    }
    for (const job of await db.list<any>("jobs")) {
      if (
        job.sentAt ||
        !String(job.subject).toLowerCase().includes("organisation invitation")
      )
        continue;
      await archive("jobs", job);
      await db.delete("jobs", job.id);
    }
    await db.put("migrations", { id, completedAt: Date.now() });
  });
}
