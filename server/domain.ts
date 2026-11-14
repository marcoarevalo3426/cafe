import {
  randomBytes,
  randomInt,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import type { Storage, Otp, Session } from "./storage";
import { verificationEmail } from "./verification-email";
import { testEmailSignInEnabled } from "./test-email-sign-in";
import { adminEmails } from "../src/allowed-accounts";
import {
  emailValid,
  type User,
  type Store,
  type MenuItem,
  type Order,
  type CartLine,
  type Voucher,
  type Role,
  type Feedback,
  type Bootstrap,
  type VerifiedVoucher,
} from "../src/types";
export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function assert(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new AppError(message, status);
}
export const id = () => randomUUID();
export const digest = (s: string) =>
  createHash("sha256").update(s).digest("hex");
export const text = (s: unknown, max = 160) => {
  assert(
    typeof s === "string" && s.trim().length > 0 && s.trim().length <= max,
    "Please check the required fields.",
  );
  return s.trim();
};
export const email = (s: unknown) => {
  const value = text(s, 254).toLowerCase();
  assert(emailValid(value), "Invalid email address. Please try again.");
  return value;
};
export const integer = (n: unknown, min: number, max: number) => {
  assert(
    typeof n === "number" && Number.isSafeInteger(n) && n >= min && n <= max,
    `Enter a whole number between ${min} and ${max}.`,
  );
  return n;
};
export const admins = new Set<string>(adminEmails);
export interface Job {
  id: string;
  type: "email" | "push";
  to: string;
  subject: string;
  message: string;
  html?: string;
  data?: Record<string, string>;
  createdAt: number;
  attempts: number;
  nextAttempt?: number;
  sentAt?: number;
  error?: string;
}
export interface Checkout {
  id: string;
  userId: string;
  storeId: string;
  type: "order" | "vouchers";
  amount: number;
  currency: string;
  status: "pending" | "fulfilled" | "cancelled";
  createdAt: number;
  payload: any;
  stripeId?: string;
  result?: any;
  key: string;
}
const templateNames: Record<string, string[]> = {
  Coffee: [
    "Latte",
    "Cappuccino",
    "Flat White",
    "Long Black",
    "Ristretto",
    "Piccolo",
    "Espresso",
    "Short Macchiato",
    "Long Macchiato",
    "Babycino",
    "Magic",
    "Mocha",
    "Hot Chocolate",
    "Chai Latte",
    "Affogato",
  ],
  Tea: ["English Breakfast", "Earl Grey", "Green Tea", "Peppermint"],
  "Cold drinks": ["Iced Latte", "Iced Chocolate", "Orange Juice"],
  Food: ["Avocado Toast", "Ham and Cheese Toastie"],
  Pies: ["Beef Pie", "Vegetable Pie"],
  Sweets: ["Croissant", "Chocolate Brownie", "Banana Bread"],
  "Kids menu": ["Babycino", "Kids Toastie"],
};
export class Domain {
  constructor(
    public db: Storage,
    public demo = false,
  ) {}
  async queue(
    type: Job["type"],
    to: string,
    subject: string,
    message: string,
    data?: Record<string, string>,
    html?: string,
  ) {
    return await this.db.put("jobs", {
      id: id(),
      type,
      to,
      subject,
      message,
      ...(html ? { html } : {}),
      data,
      createdAt: Date.now(),
      attempts: 0,
    } as Job);
  }
  async log(message: string) {
    await this.db.put("logs", { id: id(), message, createdAt: Date.now() });
  }
  async requestCode(raw: unknown) {
    const address = email(raw);
    const code = String(randomInt(0, 1000000)).padStart(6, "0"),
      salt = randomBytes(16).toString("hex");
    await this.db.atomic(async () => {
      const existing = await this.db.get<Otp>("otp", address);
      assert(
        !existing || Date.now() - existing.created >= 30000,
        "Please wait 30 seconds before requesting another code.",
        429,
      );
      await this.db.put("otp", {
        id: address,
        hash: digest(salt + code),
        salt,
        expires: Date.now() + 180000,
        attempts: 0,
        created: Date.now(),
      });
      const verification = verificationEmail(code);
      await this.queue(
        "email",
        address,
        verification.subject,
        verification.message,
        undefined,
        verification.html,
      );
    });
    return {
      expiresAt: Date.now() + 180000,
      ...(this.demo ? { developmentCode: code } : {}),
    };
  }
  async verify(raw: unknown, code: unknown) {
    const address = email(raw);
    await this.consumeCode(address, code);
    return this.signIn(address);
  }
  async signInForTesting(raw: unknown) {
    assert(testEmailSignInEnabled(), "Test email sign-in is unavailable.", 404);
    const address = email(raw);
    assert(
      admins.has(address),
      "Email verification is required for this account.",
      403,
    );
    return this.signIn(address, true);
  }
  async localTestingSignIn(raw: unknown) {
    assert(this.demo, "Testing mode is unavailable.", 404);
    const address = email(raw);
    assert(
      admins.has(address),
      "Choose a demo account or sign in with a designated test email.",
      403,
    );
    return this.signIn(address, false, true);
  }
  private async signIn(
    address: string,
    testEmailSignIn = false,
    localTesting = false,
  ) {
    return await this.db.atomic(async () => {
      let user = (await this.db.list<User>("users")).find(
        (x) => x.email === address,
      );
      if (!user)
        user = await this.db.put("users", {
          id: id(),
          email: address,
          name: "",
          phone: "",
          orderNotifications: true,
          announcements: true,
          ...(admins.has(address) ? { role: "admin" as Role } : {}),
        });
      return await this.createSession(user, localTesting, testEmailSignIn);
    });
  }
  private async consumeCode(address: string, code: unknown) {
    const valid = await this.db.atomic(async () => {
      const row = await this.db.get<Otp>("otp", address);
      if (
        !row ||
        row.expires <= Date.now() ||
        row.attempts >= 5 ||
        typeof code !== "string" ||
        !/^\d{6}$/.test(code)
      )
        return false;
      await this.db.put("otp", { ...row, attempts: row.attempts + 1 });
      if (
        !timingSafeEqual(
          Buffer.from(row.hash),
          Buffer.from(digest(row.salt + code)),
        )
      )
        return false;
      await this.db.delete("otp", address);
      return true;
    });
    assert(valid, "Invalid code. Please try again.");
  }
  private async createSession(
    user: User,
    testing = false,
    testEmailSignIn = false,
  ) {
    assert(!user.disabled, "This account has been disabled.", 403);
    const token = (testing ? "testing_" : "") + randomBytes(32).toString("hex");
    const chooseAccount = admins.has(user.email);
    await this.db.put("sessions", {
      id: digest(token),
      userId: user.id,
      expires: Date.now() + 30 * 86400000,
      ...(chooseAccount ? { activeRole: null } : {}),
      ...(testEmailSignIn ? { testEmailSignIn: true } : {}),
    });
    return { token, user: chooseAccount ? { ...user, role: undefined } : user };
  }
  async testingLogin(role: unknown) {
    assert(this.demo, "Testing mode is unavailable.", 404);
    assert(
      typeof role === "string" && ["customer", "owner"].includes(role),
      "Choose a test account.",
    );
    return await this.db.atomic(async () => {
      const fixtureStore = await this.db.get<Store>("stores", "demo-cafe");
      assert(
        fixtureStore?.ownerId === "demo-owner",
        "Demo accounts are not available in this database.",
        404,
      );
      const accounts: Record<string, string> = {
        owner: "demo-owner",
        customer: "demo-customer-user",
      };
      let user = await this.db.get<User>("users", accounts[role]);
      assert(user?.role === role, "Demo account unavailable.", 404);
      return await this.createSession(user, true);
    });
  }
  async changeEmailRequest(user: User, raw: unknown) {
    const address = email(raw);
    assert(
      !(await this.db.list<User>("users")).some((u) => u.email === address),
      "This email already has an account.",
      409,
    );
    const result = await this.requestCode(address);
    await this.db.put("emailChanges", {
      id: user.id,
      email: address,
      createdAt: Date.now(),
    });
    return result;
  }
  async changeEmailVerify(user: User, code: unknown) {
    const pending = await this.db.get<{ id: string; email: string }>(
      "emailChanges",
      user.id,
    );
    assert(pending, "Request a new email verification code.");
    await this.consumeCode(pending.email, code);
    return await this.db.atomic(async () => {
      assert(
        !(await this.db.list<User>("users")).some(
          (u) => u.email === pending.email,
        ),
        "This email already has an account.",
        409,
      );
      assert(
        (!admins.has(user.email) && user.role !== "admin") ||
          admins.has(pending.email),
        "Administrators must use an allowed email address.",
      );
      for (const kind of ["vouchers"])
        for (const r of (await this.db.list<any>(kind)).filter(
          (r) => r.email === user.email,
        )) {
          assert(
            !r.reservedBy,
            "Finish pending checkout before changing your email.",
            409,
          );
          await this.db.put(kind, { ...r, email: pending.email });
        }
      await this.db.delete("emailChanges", user.id);
      return await this.db.put("users", {
        ...(await this.db.get<User>("users", user.id))!,
        email: pending.email,
      });
    });
  }
  async authenticate(token?: string) {
    if (!token || (token.startsWith("testing_") && !this.demo)) return null;
    const session = await this.db.get<Session>("sessions", digest(token));
    if (session?.testEmailSignIn && !testEmailSignInEnabled()) return null;
    const user =
      session && session.expires > Date.now()
        ? await this.db.get<User>("users", session.userId)
        : null;
    if (!user || user.disabled) return null;
    if (admins.has(user.email)) {
      const role = session?.activeRole;
      return {
        ...user,
        role:
          role && ["owner", "customer", "admin"].includes(role)
            ? role
            : undefined,
      };
    }
    if (user.role === "admin") return { ...user, role: undefined };
    return user;
  }
  async logout(user: User) {
    await this.db.atomic(async () => {
      for (const session of await this.db.list<Session>("sessions"))
        if (session.userId === user.id)
          await this.db.delete("sessions", session.id);
    });
    for (const p of (await this.db.list<any>("devices")).filter(
      (x) => x.userId === user.id,
    ))
      await this.db.delete("devices", p.id);
  }
  async setRole(user: User, raw: unknown) {
    user = (await this.db.get<User>("users", user.id)) ?? user;
    assert(!user.role, "Your account role is already set.", 409);
    assert(["owner", "customer"].includes(String(raw)), "Select a valid role.");
    user.role = raw as Role;
    if (raw === "owner") {
      const store: Store = {
        id: id(),
        ownerId: user.id,
        name: "My Cafe",
        address: "",
        phone: "",
        currency: "AUD",
        logo: "",
        tier: "free",
        subscription: "Free",
      };
      await this.db.put("stores", store);
      user.storeId = store.id;
    }
    return await this.db.put("users", user);
  }
  async chooseAccount(user: User, raw: unknown, token?: string) {
    return this.db.atomic(async () => {
      const stored = await this.db.get<User>("users", user.id);
      const session = token
        ? await this.db.get<Session>("sessions", digest(token))
        : undefined;
      assert(
        stored &&
          !stored.disabled &&
          session?.userId === stored.id &&
          session.expires > Date.now() &&
          (!session.testEmailSignIn || testEmailSignInEnabled()),
        "Please sign in to continue.",
        401,
      );
      if (!admins.has(stored.email)) return this.setRole(stored, raw);
      assert(
        ["owner", "customer", "admin"].includes(String(raw)),
        "Select a valid account.",
      );
      if (raw === "owner") {
        let store =
          (await this.db.list<Store>("stores")).find(
            (store) =>
              store.ownerId === stored.id && store.id === stored.storeId,
          ) ??
          (await this.db.list<Store>("stores")).find(
            (store) => store.ownerId === stored.id,
          );
        if (!store)
          store = await this.db.put("stores", {
            id: id(),
            ownerId: stored.id,
            name: "My Cafe",
            address: "",
            phone: "",
            currency: "AUD",
            logo: "",
            tier: "free",
            subscription: "Free",
          } as Store);
        if (stored.storeId !== store.id) {
          stored.storeId = store.id;
          await this.db.put("users", stored);
        }
      }
      await this.db.put("sessions", { ...session, activeRole: raw as Role });
      return { ...stored, role: raw as Role };
    });
  }
  require(user: User, roles: Role[]) {
    assert(
      user.role &&
        roles.includes(user.role) &&
        (user.role !== "admin" || admins.has(user.email)),
      "You do not have access to this action.",
      403,
    );
  }
  async ownedStore(user: User, storeId?: string) {
    this.require(user, ["owner", "admin"]);
    const store = await this.db.get<Store>(
      "stores",
      storeId ?? user.storeId ?? "",
    );
    assert(
      store && (user.role === "admin" || store.ownerId === user.id),
      "Cafe not found.",
      404,
    );
    return store;
  }
  async cleanup(now = Date.now()) {
    await this.db.atomic(async () => {
      for (const c of await this.db.list<Checkout>("checkouts"))
        if (
          c.status === "pending" &&
          !c.stripeId &&
          c.createdAt < now - 25 * 3600000
        )
          await this.cancelCheckout(c.id);
      for (const v of await this.db.list<Voucher>("vouchers"))
        if ((v.expiresAt <= now || v.balance <= 0) && !v.reservedBy)
          await this.db.delete("vouchers", v.id);
      for (const o of await this.db.list<Order>("orders")) {
        const store = await this.db.get<Store>("stores", o.storeId);
        const cutoff = new Date(now);
        cutoff.setUTCMonth(
          cutoff.getUTCMonth() - (store?.tier === "paid" ? 24 : 6),
        );
        if (o.createdAt < cutoff.getTime())
          await this.db.delete("orders", o.id);
      }
      for (const kind of ["sessions", "otp"])
        for (const row of await this.db.list<Session>(kind))
          if (row.expires < now) await this.db.delete(kind, row.id);
      for (const kind of ["logs", "jobs"])
        for (const r of await this.db.list<any>(kind))
          if (r.createdAt < now - 30 * 86400000)
            await this.db.delete(kind, r.id);
    });
  }
  async addTemplate(user: User, name: string) {
    const store = await this.ownedStore(user);
    assert(templateNames[name], "Unknown template.");
    assert(
      !(await this.db.list<MenuItem>("menu")).some(
        (x) => x.storeId === store.id && x.category === name,
      ),
      "Template already added.",
      409,
    );
    for (const subcategory of templateNames[name])
      await this.db.put("menu", {
        id: id(),
        storeId: store.id,
        category: name,
        subcategory,
        groups: [
          {
            id: id(),
            name: "Size",
            variations: [
              { id: id(), name: "Reg", amount: 520 },
              { id: id(), name: "Large", amount: 620 },
              { id: id(), name: "X Large", amount: 650 },
            ],
          },
        ],
      } as MenuItem);
  }
  async saveMenu(user: User, body: any) {
    const store = await this.ownedStore(user);
    let item: MenuItem | undefined = body.id
      ? await this.db.get("menu", body.id)
      : undefined;
    if (body.id)
      assert(item?.storeId === store.id, "Menu item not found.", 404);
    assert(
      Array.isArray(body.groups) &&
        body.groups.length > 0 &&
        body.groups.length <= 10,
      "Add between 1 and 10 item groups.",
    );
    const groups = body.groups.map((g: any) => {
      assert(
        Array.isArray(g.variations) &&
          g.variations.length > 0 &&
          g.variations.length <= 30,
        "An item must have 1 to 30 variations.",
      );
      return {
        id: typeof g.id === "string" ? g.id : id(),
        name: text(g.name, 80),
        variations: g.variations.map((v: any) => ({
          id: typeof v.id === "string" ? v.id : id(),
          name: text(v.name, 80),
          amount: integer(v.amount, 0, 100000),
        })),
      };
    });
    if (!body.id)
      assert(
        !(await this.db.list<MenuItem>("menu")).some(
          (m) =>
            m.storeId === store.id &&
            m.category === text(body.category, 80) &&
            m.subcategory === text(body.subcategory, 80),
        ),
        "This sub category already exists. Select it in Categories preview to edit it.",
        409,
      );
    const saved = await this.db.put("menu", {
      id: item?.id ?? id(),
      storeId: store.id,
      category: text(body.category, 80),
      subcategory: text(body.subcategory, 80),
      groups,
    } as MenuItem);
    if (body.template)
      await this.db.put("templates", { ...saved, id: id(), template: true });
    return saved;
  }
  async deleteMenu(user: User, body: any) {
    const store = await this.ownedStore(user);
    const matches = (await this.db.list<MenuItem>("menu")).filter(
      (x) =>
        x.storeId === store.id &&
        (body.id ? x.id === body.id : x.category === body.category),
    );
    assert(matches.length, "Menu item not found.", 404);
    for (const x of matches) await this.db.delete("menu", x.id);
  }
  private async voucherByCode(raw: unknown, storeId: string) {
    const code = typeof raw === "string" ? raw.trim().toLowerCase() : "";
    assert(/^[a-z0-9]{6}$/.test(code), "Invalid voucher.");
    const voucher = (await this.db.list<Voucher>("vouchers")).find(
      (v) => v.code === code,
    );
    assert(
      voucher &&
        voucher.storeId === storeId &&
        voucher.balance > 0 &&
        voucher.expiresAt > Date.now() &&
        !voucher.reservedBy,
      "Invalid voucher.",
    );
    return voucher;
  }
  async verifyVoucher(
    user: User,
    raw: unknown,
    storeId: string,
  ): Promise<VerifiedVoucher> {
    return this.db.atomic(async () => {
      const account = await this.db.get<User>("users", user.id);
      assert(
        account && !account.disabled,
        "Please sign in to verify a voucher.",
        401,
      );
      // Claiming a bearer code depends on the code and signed-in identity,
      // rather than the account's current Customer/Owner/Admin selection.
      const store = await this.db.get<Store>("stores", storeId);
      assert(store, "Invalid voucher.");
      const voucher = await this.voucherByCode(raw, store.id);
      if (voucher.email !== account.email)
        await this.db.put("vouchers", { ...voucher, email: account.email });
      return {
        id: voucher.id,
        code: voucher.code,
        storeId: store.id,
        balance: voucher.balance,
        expiresAt: voucher.expiresAt,
        currency: store.currency,
      };
    });
  }
  async generateDraft(user: User, body: any) {
    this.require(user, ["owner", "admin"]);
    const store = await this.ownedStore(user, body.storeId);
    const quantity = integer(body.quantity, 1, 100),
      amount = integer(body.amount, 1000, 1000000),
      month = integer(body.month, 1, 12),
      year = integer(
        body.year,
        new Date().getUTCFullYear(),
        new Date().getUTCFullYear() + 10,
      );
    const expiresAt = Date.UTC(year, month, 1);
    assert(expiresAt > Date.now(), "Voucher validity must be in the future.");
    const payload = { quantity, amount, expiresAt, assignedEmail: user.email };
    const total = quantity * amount;
    if (body.useVouchers === true) {
      this.require(user, ["owner", "admin"]);
      const voucher = await this.voucherByCode(body.voucherCode, store.id);
      const voucherAmount = Math.min(total, voucher.balance);
      return {
        store,
        payload: {
          ...payload,
          total,
          voucherAmount,
          allocations: [{ id: voucher.id, amount: voucherAmount }],
          voucherExpiresAt: voucher.expiresAt,
        },
        total: total - voucherAmount,
      };
    }
    return { store, payload, total };
  }
  async newCheckout(
    user: User,
    type: Checkout["type"],
    store: Store,
    payload: any,
    amount: number,
    key: string,
  ): Promise<Checkout> {
    return this.db.atomic(() =>
      this.newCheckoutAtomic(user, type, store, payload, amount, key),
    );
  }
  private async newCheckoutAtomic(
    user: User,
    type: Checkout["type"],
    store: Store,
    payload: any,
    amount: number,
    key: string,
  ): Promise<Checkout> {
    const existing = (await this.db.list<Checkout>("checkouts")).find(
      (x) => x.userId === user.id && x.key === key,
    );
    if (existing) {
      assert(existing.type === type, "Request key already used.");
      return existing;
    }
    const checkout = await this.db.put("checkouts", {
      id: id(),
      userId: user.id,
      storeId: store.id,
      type,
      payload,
      amount,
      currency: store.currency.toLowerCase(),
      status: "pending",
      createdAt: Date.now(),
      key,
    } as Checkout);
    for (const allocation of payload.allocations ?? []) {
      const voucher = await this.db.get<Voucher>("vouchers", allocation.id);
      assert(
        voucher &&
          voucher.storeId === store.id &&
          !voucher.reservedBy &&
          voucher.expiresAt > Date.now() &&
          allocation.amount > 0 &&
          voucher.balance >= allocation.amount,
        "Invalid voucher.",
      );
      await this.db.put("vouchers", { ...voucher, reservedBy: checkout.id });
    }
    return checkout;
  }
  async fulfill(checkoutId: string, payment = "card") {
    return this.db.atomic(() => this.fulfillAtomic(checkoutId, payment));
  }
  private async fulfillAtomic(checkoutId: string, payment: string) {
    const c = await this.db.get<Checkout>("checkouts", checkoutId);
    assert(c, "Checkout not found.", 404);
    if (c.status === "fulfilled") return c.result;
    assert(c.status === "pending", "Checkout has expired.");
    const user = await this.db.get<User>("users", c.userId);
    assert(user && !user.disabled, "Account unavailable.", 403);
    let result: any;
    if (c.type === "vouchers") {
      const assignedEmail = c.payload.assignedEmail || user.email;
      const vouchers: Voucher[] = [];
      for (let i = 0; i < c.payload.quantity; i++) {
        let code: string;
        do {
          code = Array.from(
            { length: 6 },
            () => "abcdefghijklmnopqrstuvwxyz0123456789"[randomInt(36)],
          ).join("");
        } while (
          (await this.db.list<Voucher>("vouchers")).some((v) => v.code === code)
        );
        vouchers.push(
          await this.db.put("vouchers", {
            id: id(),
            code,
            storeId: c.storeId,
            email: assignedEmail,
            balance: c.payload.amount,
            initialAmount: c.payload.amount,
            expiresAt: c.payload.expiresAt,
          } as Voucher),
        );
      }
      await this.queue(
        "email",
        assignedEmail,
        "Your Café voucher receipt",
        `Receipt ${c.id}: ${vouchers.length} vouchers. Total ${c.currency.toUpperCase()} ${((c.payload.total ?? c.amount) / 100).toFixed(2)}. Voucher credit ${((c.payload.voucherAmount ?? 0) / 100).toFixed(2)}. Payment: ${payment}. Sign in to view your vouchers.`,
      );
      result = { voucherCount: vouchers.length, assignedEmail };
    } else {
      const p = c.payload;
      const order: Order = {
        id: id(),
        storeId: c.storeId,
        userId: c.userId,
        customer: user.name || user.email.split("@")[0],
        lines: p.lines,
        total: p.total,
        voucherAmount: p.voucherAmount,
        status: "incoming",
        createdAt: Date.now(),
        payment,
      };
      await this.db.put("orders", order);
      const store = (await this.db.get<Store>("stores", c.storeId))!;
      const owner = await this.db.get<User>("users", store.ownerId);
      if (owner?.orderNotifications)
        await this.queue(
          "push",
          owner.id,
          "New cafe order",
          `${order.customer}: ${order.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}`,
          { orderId: order.id },
        );
      await this.queue(
        "email",
        user.email,
        "Your Café order receipt",
        `Order ${order.id}. Total ${c.currency.toUpperCase()} ${(p.total / 100).toFixed(2)}. Your order will be ready shortly. Thank you.`,
      );
      result = order;
    }
    for (const allocation of c.payload.allocations ?? []) {
      const voucher = await this.db.get<Voucher>("vouchers", allocation.id);
      assert(
        voucher &&
          voucher.reservedBy === c.id &&
          voucher.balance >= allocation.amount,
        "A voucher is no longer available.",
      );
      const balance = voucher.balance - allocation.amount;
      if (balance === 0) await this.db.delete("vouchers", voucher.id);
      else {
        delete voucher.reservedBy;
        await this.db.put("vouchers", { ...voucher, balance });
      }
    }
    await this.db.put("checkouts", { ...c, status: "fulfilled", result });
    return result;
  }
  async cancelCheckout(checkoutId: string) {
    const c = await this.db.get<Checkout>("checkouts", checkoutId);
    if (!c || c.status !== "pending") return;
    for (const v of (await this.db.list<Voucher>("vouchers")).filter(
      (x) => x.reservedBy === c.id,
    )) {
      delete v.reservedBy;
      await this.db.put("vouchers", v);
    }
    await this.db.put("checkouts", { ...c, status: "cancelled" });
  }
  async orderDraft(user: User, body: any, key: string) {
    // Any signed-in account can buy from a cafe. Ordering does not grant
    // owner/admin permissions or depend on the current account selection.
    const account = await this.db.get<User>("users", user.id);
    assert(
      account && !account.disabled,
      "Please sign in to place an order.",
      401,
    );
    user = account;
    const existing = (await this.db.list<Checkout>("checkouts")).find(
      (c) => c.userId === user.id && c.key === key,
    );
    if (existing) return existing;
    const store = await this.db.get<Store>("stores", body.storeId);
    assert(store, "Cafe not found.", 404);
    assert(
      Array.isArray(body.lines) &&
        body.lines.length > 0 &&
        body.lines.length <= 50,
      "Add 1 to 50 items to your cart.",
    );
    const lines = await Promise.all(
      body.lines.map(async (line: CartLine) => {
        const item = await this.db.get<MenuItem>("menu", line.itemId);
        assert(
          item && item.storeId === store.id,
          "An item is no longer available.",
        );
        let unitAmount = 0;
        const description: string[] = [];
        for (const g of item.groups) {
          const v = g.variations.find((v) => v.id === line.selections?.[g.id]);
          assert(v, "Select a variation for each item.");
          unitAmount += v.amount;
          description.push(v.name);
        }
        return {
          itemId: item.id,
          selections: line.selections,
          quantity: integer(line.quantity, 1, 99),
          note: typeof line.note === "string" ? line.note.slice(0, 500) : "",
          name: item.subcategory,
          description: description.join(", "),
          unitAmount,
        };
      }),
    );
    const total = lines.reduce(
      (s: number, l: any) => s + l.quantity * l.unitAmount,
      0,
    );
    integer(total, 1, 10000000);
    let remaining = total;
    const allocations: { id: string; amount: number }[] = [];
    if (body.useVouchers) {
      const vouchers = (await this.db.list<Voucher>("vouchers"))
        .filter(
          (v) =>
            v.storeId === store.id &&
            v.email === user.email &&
            v.balance > 0 &&
            !v.reservedBy &&
            v.expiresAt > Date.now(),
        )
        .sort((a, b) => a.expiresAt - b.expiresAt);
      if (body.voucherCode !== undefined && body.voucherCode !== "") {
        const supplied = await this.voucherByCode(body.voucherCode, store.id);
        if (!vouchers.some((v) => v.id === supplied.id))
          vouchers.push(supplied);
        vouchers.sort((a, b) => a.expiresAt - b.expiresAt);
      }
      for (const v of vouchers) {
        if (!remaining) break;
        const amount = Math.min(v.balance, remaining);
        allocations.push({ id: v.id, amount });
        remaining -= amount;
      }
    }
    const c = await this.newCheckout(
      user,
      "order",
      store,
      {
        lines,
        total,
        voucherAmount: total - remaining,
        allocations,
        ...(allocations.length
          ? {
              voucherExpiresAt: Math.min(
                ...(await Promise.all(
                  allocations.map(
                    async (a) =>
                      (await this.db.get<Voucher>("vouchers", a.id))!.expiresAt,
                  ),
                )),
              ),
            }
          : {}),
      },
      remaining,
      key,
    );
    return c;
  }
  async completeOrder(user: User, orderId: string) {
    const o = await this.db.get<Order>("orders", orderId);
    assert(o, "Order not found.", 404);
    await this.ownedStore(user, o.storeId);
    await this.db.put("orders", {
      ...o,
      status: "done",
      completedAt: Date.now(),
    });
    const customer = await this.db.get<User>("users", o.userId);
    if (customer?.orderNotifications)
      await this.queue(
        "push",
        customer.id,
        "Your order is ready",
        "Your cafe order is ready to collect.",
        { orderId: o.id },
      );
  }
  async deleteVouchers(user: User, ids: unknown) {
    assert(
      Array.isArray(ids) && ids.length > 0 && ids.length <= 1000,
      "Select vouchers to delete.",
    );
    const store = await this.ownedStore(user);
    for (const value of ids) {
      const v = await this.db.get<Voucher>("vouchers", String(value));
      assert(
        v && v.storeId === store.id && !v.reservedBy,
        "Voucher unavailable.",
        409,
      );
    }
    for (const value of ids) await this.db.delete("vouchers", String(value));
  }
  async share(user: User, body: any) {
    this.require(user, ["customer", "owner", "admin"]);
    const v = await this.db.get<Voucher>("vouchers", text(body.id));
    assert(
      v && v.email === user.email && !v.reservedBy && v.expiresAt > Date.now(),
      "Voucher unavailable.",
      409,
    );
    const address = email(body.email);
    assert(address !== user.email, "Choose another recipient.");
    await this.db.put("vouchers", { ...v, email: address });
    await this.queue(
      "email",
      address,
      "A voucher has been shared with you",
      `Sign in with this email to use your cafe voucher ${v.code}.`,
    );
  }
  async saveProfile(user: User, body: any) {
    user.name = text(body.name, 120);
    user.phone = typeof body.phone === "string" ? body.phone.slice(0, 40) : "";
    if (user.role === "owner") {
      const s = await this.ownedStore(user);
      assert(
        ["AUD", "USD", "NZD", "GBP", "EUR"].includes(body.currency),
        "Select a supported currency.",
      );
      if (s.currency !== body.currency)
        assert(
          !(await this.db.list<Order>("orders")).some(
            (o) => o.storeId === s.id,
          ) &&
            !(await this.db.list<Voucher>("vouchers")).some(
              (v) => v.storeId === s.id,
            ),
          "Currency cannot change while orders or vouchers exist.",
        );
      const logo = typeof body.logo === "string" ? body.logo : "";
      assert(
        !logo ||
          (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) &&
            logo.length < 180000),
        "Upload a PNG, JPEG, or WebP logo smaller than 130 KB.",
      );
      await this.db.put("stores", {
        ...s,
        name: text(body.storeName, 120),
        address:
          typeof body.address === "string" ? body.address.slice(0, 300) : "",
        phone: user.phone,
        currency: body.currency,
        logo,
      });
    }
    return await this.db.put("users", {
      ...(await this.db.get<User>("users", user.id))!,
      name: user.name,
      phone: user.phone,
    });
  }
  async bootstrap(
    user: User | null,
  ): Promise<Omit<Bootstrap, "paymentsEnabled" | "cards">> {
    const allStores = await this.db.list<Store>("stores");
    const stores = allStores.map(({ ownerId, ...s }) => ({
      ...s,
      ownerId: "",
    }));
    if (!user)
      return {
        user: null,
        accountRoles: [],
        stores,
        menu: await this.db.list<MenuItem>("menu"),
        orders: [],
        vouchers: [],
        templates: [],
        demo: this.demo,
      };
    const owner = user.role === "owner";
    const admin = user.role === "admin";
    return {
      user: { ...user, stripeCustomer: undefined },
      accountRoles: admins.has(user.email)
        ? ["owner", "customer", "admin"]
        : [],
      stores,
      menu: (await this.db.list<MenuItem>("menu")).filter(
        (m) => !owner || m.storeId === user.storeId,
      ),
      orders: (await this.db.list<Order>("orders"))
        .filter(
          (o) =>
            admin ||
            (owner && o.storeId === user.storeId) ||
            o.userId === user.id,
        )
        .sort((a, b) => b.createdAt - a.createdAt),
      vouchers: (await this.db.list<Voucher>("vouchers")).filter(
        (v) =>
          v.expiresAt > Date.now() &&
          v.balance > 0 &&
          (admin ||
            (owner && v.storeId === user.storeId) ||
            (user.role === "customer" && v.email === user.email)),
      ),
      templates: (await this.db.list<MenuItem>("templates")).filter(
        (t) => t.storeId === user.storeId,
      ),
      demo: this.demo,
      ...(admin
        ? {
            users: (await this.db.list<User>("users")).map((u) => ({
              ...u,
              stripeCustomer: undefined,
            })),
            feedback: await this.db.list<Feedback>("feedback"),
            logs: (await this.db.list<any>("logs"))
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 100),
            settings: (await this.db.get<{ subscriptionPrice: number }>(
              "settings",
              "global",
            )) ?? {
              subscriptionPrice: 2900,
            },
            builds: await this.db.list("builds"),
          }
        : {}),
    };
  }
  async seed() {
    if (!this.demo || (await this.db.list<Store>("stores")).length) return;
    await this.db.atomic(async () => {
      const owner = await this.db.put("users", {
        id: "demo-owner",
        email: "owner@cafe.test",
        role: "owner",
        name: "Anne Miren Arevalo",
        phone: "",
        storeId: "demo-cafe",
        orderNotifications: true,
        announcements: true,
      } as User);
      await this.db.put("stores", {
        id: "demo-cafe",
        ownerId: owner.id,
        name: "Gordon",
        address: "123 Bourke Street, Melbourne VIC 3000",
        phone: "",
        currency: "AUD",
        logo: "",
        tier: "free",
        subscription: "Free",
      } as Store);
      await this.addTemplate(owner, "Coffee");
      await this.addTemplate(owner, "Food");
      await this.db.put<User>("users", {
        id: "demo-customer-user",
        email: "customer@cafe.test",
        role: "customer",
        name: "John Parker",
        phone: "",
        orderNotifications: true,
        announcements: true,
      });
      for (let i = 0; i < 4; i++)
        await this.db.put("vouchers", {
          id: id(),
          code: `cafe0${i}`,
          storeId: "demo-cafe",
          balance: [1500, 500, 200, 180][i],
          initialAmount: 1500,
          expiresAt: Date.UTC(new Date().getUTCFullYear() + 1, 9, 1),
          ...(i < 2 ? { email: "customer@cafe.test" } : {}),
        });
      const first = (await this.db.list<MenuItem>("menu"))[0];
      for (const [i, name] of [
        "John P.",
        "Maria A.",
        "Stephen K.",
        "Miren A.",
      ].entries())
        await this.db.put("orders", {
          id: id(),
          storeId: "demo-cafe",
          userId: "demo-customer-user",
          customer: name,
          lines: [
            {
              itemId: first.id,
              selections: {},
              name:
                i === 3 ? "Hot chocolate" : i === 0 ? "Latte" : "Cappuccino",
              description:
                i === 0
                  ? "Almond milk, Strong, 1 Sugar"
                  : "Oat milk, Extra Strong, 2 Sugars",
              quantity: i === 2 ? 2 : 1,
              note: "",
              unitAmount: 520,
            },
          ],
          total: i === 2 ? 1040 : 520,
          voucherAmount: 0,
          payment: "demo",
          status: "incoming",
          createdAt: Date.now() - i * 120000,
        } as Order);
    });
  }
}
export { templateNames };
