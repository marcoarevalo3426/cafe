import { test } from "node:test";
import assert from "node:assert/strict";
import { Domain, digest, admins } from "../server/domain";
import { Database } from "./support/database";
import type { Session } from "../server/storage";
import type { Store, User } from "../src/types";
import { accountChoices } from "../src/account-choices";

test("both verified allowed emails choose a session account, retain their cafe and cannot use admin actions as a customer", async () => {
  const db = new Database();
  const d = new Domain(db, true);
  try {
    for (const email of admins) {
      const otp = await d.requestCode(email);
      const login = await d.verify(email, otp.developmentCode);
      assert.equal(login.user.role, undefined);
      const pending = (await d.authenticate(login.token))!;
      const initial = await d.bootstrap(pending);
      assert.deepEqual(initial.accountRoles, ["owner", "customer", "admin"]);
      assert.equal(initial.users, undefined);
      assert.deepEqual(
        accountChoices(initial).map((x) => x.label),
        ["Cafe Owner", "Customer", "Admin"],
      );
      assert.throws(() => d.require(pending, ["admin"]));
      let owner = await d.chooseAccount(pending, "owner", login.token);
      const storeId = owner.storeId;
      assert.ok(storeId);
      await d.db.atomic(() => d.addTemplate(owner, "Coffee"));
      const count = (await db.list("menu")).length;
      const customer = await d.chooseAccount(owner, "customer", login.token);
      assert.equal((await d.authenticate(login.token))?.role, "customer");
      assert.throws(() => d.require(customer, ["admin"]));
      assert.throws(() => d.require(customer, ["owner"]));
      assert.equal((await d.bootstrap(customer)).users, undefined);
      owner = await d.chooseAccount(customer, "owner", login.token);
      assert.equal(owner.storeId, storeId);
      assert.equal(
        (await db.list<Store>("stores")).filter((s) => s.ownerId === owner.id)
          .length,
        1,
      );
      assert.equal((await db.list("menu")).length, count);
      const admin = await d.chooseAccount(owner, "admin", login.token);
      assert.doesNotThrow(() => d.require(admin, ["admin"]));
      assert.ok((await d.bootstrap(admin)).users);
      const nextOtp = await d.requestCode(email);
      const nextLogin = await d.verify(email, nextOtp.developmentCode);
      assert.equal(nextLogin.user.role, undefined);
      assert.equal((await d.authenticate(nextLogin.token))?.role, undefined);
      assert.equal((await d.authenticate(login.token))?.role, "admin");
      await assert.rejects(d.chooseAccount(owner, "organisation", login.token));
      await assert.rejects(
        d.chooseAccount(owner, "admin", nextLogin.token + "wrong"),
      );
    }
  } finally {
    await db.close();
  }
});

test("ordinary accounts never receive Admin choices and cannot select Admin or change roles", async () => {
  const db = new Database();
  const d = new Domain(db, true);
  try {
    const otp = await d.requestCode("ordinary@example.com");
    const login = await d.verify("ordinary@example.com", otp.developmentCode);
    const data = await d.bootstrap(login.user);
    assert.deepEqual(data.accountRoles, []);
    assert.ok(!accountChoices(data).some((x) => x.role === "admin"));
    assert.ok(
      !accountChoices({ user: null, accountRoles: ["admin"] }).some(
        (x) => x.role === "admin",
      ),
    );
    await assert.rejects(d.chooseAccount(login.user, "admin", login.token));
    const customer = await d.chooseAccount(login.user, "customer", login.token);
    await assert.rejects(d.chooseAccount(customer, "owner", login.token));
    const session = (await db.get<Session>("sessions", digest(login.token)))!;
    await db.put("sessions", { ...session, activeRole: "admin" });
    await db.put("users", { ...customer, role: "admin" });
    assert.equal((await d.authenticate(login.token))?.role, undefined);
    assert.throws(() => d.require({ ...customer, role: "admin" }, ["admin"]));
  } finally {
    await db.close();
  }
});

test("legacy allowed sessions show the chooser and concurrent owner selection creates a single cafe", async () => {
  const db = new Database();
  const d = new Domain(db, false);
  const user: User = {
    id: "legacy-admin",
    email: "marevalo@nepgroup.com",
    role: "admin",
    name: "",
    phone: "",
    orderNotifications: false,
    announcements: false,
  };
  try {
    await db.put("users", user);
    for (const token of ["legacy-one", "legacy-two"])
      await db.put("sessions", {
        id: digest(token),
        userId: user.id,
        expires: Date.now() + 60000,
      });
    assert.equal((await d.authenticate("legacy-one"))?.role, undefined);
    const [first, second] = await Promise.all([
      d.chooseAccount(user, "owner", "legacy-one"),
      d.chooseAccount(user, "owner", "legacy-two"),
    ]);
    assert.equal(first.storeId, second.storeId);
    assert.equal((await db.list("stores")).length, 1);
  } finally {
    await db.close();
  }
});
