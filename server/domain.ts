import {
  randomBytes,
  randomInt,
  randomUUID,
  createHash,
  timingSafeEqual,
} from "node:crypto";
import { Database } from "./db";
import {
  emailValid,
  type User,
  type Store,
  type MenuItem,
  type Order,
  type CartLine,
  type Voucher,
  type Organisation,
  type Recipient,
  type Role,
  type Feedback,
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
export const admins = new Set([
  "marco.arevalo3426@gmail.com",
  "marevalo@nepgroup.com",
]);
export interface Job {
  id: string;
  type: "email" | "push";
  to: string;
  subject: string;
  message: string;
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
    public db: Database,
    public demo = false,
  ) {}
  queue(
    type: Job["type"],
    to: string,
    subject: string,
    message: string,
    data?: Record<string, string>,
  ) {
    return this.db.put("jobs", {
      id: id(),
      type,
      to,
      subject,
      message,
      data,
      createdAt: Date.now(),
      attempts: 0,
    } as Job);
  }
  log(message: string) {
    this.db.put("logs", { id: id(), message, createdAt: Date.now() });
  }
  requestCode(raw: unknown) {
    const address = email(raw);
    const existing = this.db.sql
      .prepare("SELECT created FROM otp WHERE email=?")
      .get(address) as any;
    assert(
      !existing || Date.now() - existing.created >= 30000,
      "Please wait 30 seconds before requesting another code.",
      429,
    );
    const code = String(randomInt(0, 1000000)).padStart(6, "0"),
      salt = randomBytes(16).toString("hex");
    this.db.atomic(() => {
      this.db.sql
        .prepare(
          "INSERT INTO otp(email,hash,salt,expires,attempts,created) VALUES(?,?,?,?,0,?) ON CONFLICT(email) DO UPDATE SET hash=excluded.hash,salt=excluded.salt,expires=excluded.expires,attempts=0,created=excluded.created",
        )
        .run(
          address,
          digest(salt + code),
          salt,
          Date.now() + 180000,
          Date.now(),
        );
      this.queue(
        "email",
        address,
        "Verify your Café email",
        `Hi there, thank you for signing up. Please verify your details using this code: ${code}. Please note: This code expires in 3 minutes. Kind regards, Admin`,
      );
    });
    return {
      expiresAt: Date.now() + 180000,
      ...(this.demo ? { developmentCode: code } : {}),
    };
  }
  verify(raw: unknown, code: unknown) {
    const address = email(raw);
    const row = this.db.sql
      .prepare("SELECT * FROM otp WHERE email=?")
      .get(address) as any;
    assert(
      row &&
        row.expires > Date.now() &&
        row.attempts < 5 &&
        typeof code === "string" &&
        /^\d{6}$/.test(code),
      "Invalid code. Please try again.",
    );
    this.db.sql
      .prepare("UPDATE otp SET attempts=attempts+1 WHERE email=?")
      .run(address);
    assert(
      timingSafeEqual(
        Buffer.from(row.hash),
        Buffer.from(digest(row.salt + code)),
      ),
      "Invalid code. Please try again.",
    );
    return this.db.atomic(() => {
      this.db.sql.prepare("DELETE FROM otp WHERE email=?").run(address);
      let user = this.db.list<User>("users").find((x) => x.email === address);
      if (!user)
        user = this.db.put("users", {
          id: id(),
          email: address,
          name: "",
          phone: "",
          orderNotifications: true,
          announcements: true,
          ...(admins.has(address) ? { role: "admin" as Role } : {}),
        });
      assert(!user.disabled, "This account has been disabled.", 403);
      const token = randomBytes(32).toString("hex");
      this.db.sql
        .prepare("INSERT INTO sessions VALUES(?,?,?)")
        .run(digest(token), user.id, Date.now() + 30 * 86400000);
      return { token, user };
    });
  }
  changeEmailRequest(user: User, raw: unknown) {
    const address = email(raw);
    assert(
      !this.db.list<User>("users").some((u) => u.email === address),
      "This email already has an account.",
      409,
    );
    const result = this.requestCode(address);
    this.db.put("emailChanges", {
      id: user.id,
      email: address,
      createdAt: Date.now(),
    });
    return result;
  }
  changeEmailVerify(user: User, code: unknown) {
    const pending = this.db.get<{ id: string; email: string }>(
      "emailChanges",
      user.id,
    );
    assert(pending, "Request a new email verification code.");
    const row = this.db.sql
      .prepare("SELECT * FROM otp WHERE email=?")
      .get(pending.email) as any;
    assert(
      row &&
        row.expires > Date.now() &&
        row.attempts < 5 &&
        typeof code === "string" &&
        /^\d{6}$/.test(code),
      "Invalid code. Please try again.",
    );
    this.db.sql
      .prepare("UPDATE otp SET attempts=attempts+1 WHERE email=?")
      .run(pending.email);
    assert(
      timingSafeEqual(
        Buffer.from(row.hash),
        Buffer.from(digest(row.salt + code)),
      ),
      "Invalid code. Please try again.",
    );
    return this.db.atomic(() => {
      assert(
        !this.db.list<User>("users").some((u) => u.email === pending.email),
        "This email already has an account.",
        409,
      );
      assert(
        user.role !== "admin" || admins.has(pending.email),
        "Administrators must use an allowed email address.",
      );
      for (const kind of ["recipients", "vouchers", "organisations"])
        for (const r of this.db
          .list<any>(kind)
          .filter((r) => r.email === user.email)) {
          assert(
            !r.reservedBy,
            "Finish pending checkout before changing your email.",
            409,
          );
          this.db.put(kind, { ...r, email: pending.email });
        }
      this.db.sql.prepare("DELETE FROM otp WHERE email=?").run(pending.email);
      this.db.delete("emailChanges", user.id);
      return this.db.put("users", { ...user, email: pending.email });
    });
  }
  authenticate(token?: string) {
    if (!token) return null;
    const session = this.db.sql
      .prepare("SELECT user_id FROM sessions WHERE hash=? AND expires>?")
      .get(digest(token), Date.now()) as any;
    const user = session ? this.db.get<User>("users", session.user_id) : null;
    return user && !user.disabled ? user : null;
  }
  logout(user: User) {
    this.db.sql.prepare("DELETE FROM sessions WHERE user_id=?").run(user.id);
    for (const p of this.db
      .list<any>("devices")
      .filter((x) => x.userId === user.id))
      this.db.delete("devices", p.id);
  }
  setRole(user: User, raw: unknown) {
    assert(!user.role, "Your account role is already set.", 409);
    assert(
      ["owner", "customer", "organisation"].includes(String(raw)),
      "Select a valid role.",
    );
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
      this.db.put("stores", store);
      user.storeId = store.id;
    }
    if (raw === "organisation") {
      const org = this.db
        .list<Organisation>("organisations")
        .find((x) => x.email === user.email);
      if (org) user.orgId = org.id;
    }
    return this.db.put("users", user);
  }
  require(user: User, roles: Role[]) {
    assert(
      user.role && roles.includes(user.role),
      "You do not have access to this action.",
      403,
    );
  }
  ownedStore(user: User, storeId?: string) {
    this.require(user, ["owner", "admin"]);
    const store = this.db.get<Store>("stores", storeId ?? user.storeId ?? "");
    assert(
      store && (user.role === "admin" || store.ownerId === user.id),
      "Cafe not found.",
      404,
    );
    return store;
  }
  org(user: User) {
    this.require(user, ["organisation"]);
    const org = this.db.get<Organisation>("organisations", user.orgId ?? "");
    assert(
      org && org.email === user.email,
      "Your organisation has not been invited by a cafe yet.",
      403,
    );
    return org;
  }
  cleanup(now = Date.now()) {
    this.db.atomic(() => {
      for (const c of this.db.list<Checkout>("checkouts"))
        if (
          c.status === "pending" &&
          !c.stripeId &&
          c.createdAt < now - 25 * 3600000
        )
          this.cancelCheckout(c.id);
      for (const v of this.db.list<Voucher>("vouchers"))
        if ((v.expiresAt <= now || v.balance <= 0) && !v.reservedBy)
          this.db.delete("vouchers", v.id);
      for (const o of this.db.list<Order>("orders")) {
        const store = this.db.get<Store>("stores", o.storeId);
        const cutoff = new Date(now);
        cutoff.setUTCMonth(
          cutoff.getUTCMonth() - (store?.tier === "paid" ? 24 : 6),
        );
        if (o.createdAt < cutoff.getTime()) this.db.delete("orders", o.id);
      }
      this.db.sql.prepare("DELETE FROM sessions WHERE expires<?").run(now);
      this.db.sql.prepare("DELETE FROM otp WHERE expires<?").run(now);
      for (const kind of ["logs", "jobs"])
        for (const r of this.db.list<any>(kind))
          if (r.createdAt < now - 30 * 86400000) this.db.delete(kind, r.id);
    });
  }
  addTemplate(user: User, name: string) {
    const store = this.ownedStore(user);
    assert(templateNames[name], "Unknown template.");
    assert(
      !this.db
        .list<MenuItem>("menu")
        .some((x) => x.storeId === store.id && x.category === name),
      "Template already added.",
      409,
    );
    for (const subcategory of templateNames[name])
      this.db.put("menu", {
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
  saveMenu(user: User, body: any) {
    const store = this.ownedStore(user);
    let item: MenuItem | undefined = body.id
      ? this.db.get("menu", body.id)
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
        !this.db
          .list<MenuItem>("menu")
          .some(
            (m) =>
              m.storeId === store.id &&
              m.category === text(body.category, 80) &&
              m.subcategory === text(body.subcategory, 80),
          ),
        "This sub category already exists. Select it in Categories preview to edit it.",
        409,
      );
    const saved = this.db.put("menu", {
      id: item?.id ?? id(),
      storeId: store.id,
      category: text(body.category, 80),
      subcategory: text(body.subcategory, 80),
      groups,
    } as MenuItem);
    if (body.template)
      this.db.put("templates", { ...saved, id: id(), template: true });
    return saved;
  }
  deleteMenu(user: User, body: any) {
    const store = this.ownedStore(user);
    const matches = this.db
      .list<MenuItem>("menu")
      .filter(
        (x) =>
          x.storeId === store.id &&
          (body.id ? x.id === body.id : x.category === body.category),
      );
    assert(matches.length, "Menu item not found.", 404);
    for (const x of matches) this.db.delete("menu", x.id);
  }
  generateDraft(user: User, body: any) {
    this.require(user, ["owner", "organisation", "admin"]);
    const org = user.role === "organisation" ? this.org(user) : undefined;
    const store = org
      ? this.db.get<Store>("stores", org.storeId)!
      : this.ownedStore(user, body.storeId);
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
    let organisation = org;
    if (!org && body.orgId) {
      organisation = this.db.get("organisations", body.orgId);
      assert(
        organisation?.storeId === store.id,
        "Organisation not found.",
        404,
      );
    }
    const payload = {
      quantity,
      amount,
      expiresAt,
      orgId: organisation?.id,
      orgName: organisation?.name ?? text(body.orgName, 120),
      orgEmail: organisation?.email ?? email(body.orgEmail),
    };
    if (!organisation) {
      const match = this.db
        .list<Organisation>("organisations")
        .find((x) => x.email === payload.orgEmail);
      assert(
        !match || match.storeId === store.id,
        "This organisation already belongs to another cafe.",
      );
      if (match) payload.orgId = match.id;
      const account = this.db
        .list<User>("users")
        .find((x) => x.email === payload.orgEmail);
      assert(
        !account?.role || account.role === "organisation",
        "Use an organisation account email.",
      );
    }
    return { store, payload, total: quantity * amount };
  }
  newCheckout(
    user: User,
    type: Checkout["type"],
    store: Store,
    payload: any,
    amount: number,
    key: string,
  ) {
    const existing = this.db
      .list<Checkout>("checkouts")
      .find((x) => x.userId === user.id && x.key === key);
    if (existing) {
      assert(existing.type === type, "Request key already used.");
      return existing;
    }
    return this.db.put("checkouts", {
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
  }
  fulfill(checkoutId: string, payment = "card") {
    const c = this.db.get<Checkout>("checkouts", checkoutId);
    assert(c, "Checkout not found.", 404);
    if (c.status === "fulfilled") return c.result;
    assert(c.status === "pending", "Checkout has expired.");
    const user = this.db.get<User>("users", c.userId);
    assert(user && !user.disabled, "Account unavailable.", 403);
    let result: any;
    if (c.type === "vouchers") {
      let org = this.db.get<Organisation>(
        "organisations",
        c.payload.orgId ?? "",
      );
      if (!org) {
        org = this.db.put("organisations", {
          id: id(),
          storeId: c.storeId,
          name: c.payload.orgName,
          email: c.payload.orgEmail,
          contact: "",
        });
        const invited = this.db
          .list<User>("users")
          .find((x) => x.email === org!.email);
        if (invited && (!invited.role || invited.role === "organisation"))
          this.db.put("users", {
            ...invited,
            role: "organisation",
            orgId: org.id,
          });
        else if (!invited)
          this.db.put("users", {
            id: id(),
            email: org.email,
            role: "organisation",
            orgId: org.id,
            name: org.contact,
            phone: "",
            orderNotifications: true,
            announcements: true,
          } as User);
        this.queue(
          "email",
          org.email,
          "Your Café organisation invitation",
          `You have been invited to manage ${org.name}'s vouchers. Sign in using this email at the Café app to accept your invitation.`,
        );
      }
      const vouchers: Voucher[] = [];
      for (let i = 0; i < c.payload.quantity; i++) {
        let code: string;
        do {
          code = Array.from(
            { length: 6 },
            () => "abcdefghijklmnopqrstuvwxyz0123456789"[randomInt(36)],
          ).join("");
        } while (
          this.db.list<Voucher>("vouchers").some((v) => v.code === code)
        );
        vouchers.push(
          this.db.put("vouchers", {
            id: id(),
            code,
            storeId: c.storeId,
            orgId: org.id,
            balance: c.payload.amount,
            initialAmount: c.payload.amount,
            expiresAt: c.payload.expiresAt,
          } as Voucher),
        );
      }
      this.queue(
        "email",
        org.email,
        "Your Café voucher receipt",
        `Receipt ${c.id}: ${vouchers.length} vouchers. Total ${c.currency.toUpperCase()} ${(c.amount / 100).toFixed(2)}. Payment: ${payment}. Sign in to allocate your vouchers.`,
      );
      result = { voucherCount: vouchers.length, organisation: org };
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
      for (const a of p.allocations) {
        const v = this.db.get<Voucher>("vouchers", a.id);
        assert(
          v && v.reservedBy === c.id && v.balance >= a.amount,
          "A voucher is no longer available.",
        );
        v.balance -= a.amount;
        delete v.reservedBy;
        if (v.balance === 0) this.db.delete("vouchers", v.id);
        else this.db.put("vouchers", v);
      }
      this.db.put("orders", order);
      const store = this.db.get<Store>("stores", c.storeId)!;
      const owner = this.db.get<User>("users", store.ownerId);
      if (owner?.orderNotifications)
        this.queue(
          "push",
          owner.id,
          "New cafe order",
          `${order.customer}: ${order.lines.map((l) => `${l.quantity} × ${l.name}`).join(", ")}`,
          { orderId: order.id },
        );
      this.queue(
        "email",
        user.email,
        "Your Café order receipt",
        `Order ${order.id}. Total ${c.currency.toUpperCase()} ${(p.total / 100).toFixed(2)}. Your order will be ready shortly. Thank you.`,
      );
      result = order;
    }
    this.db.put("checkouts", { ...c, status: "fulfilled", result });
    return result;
  }
  cancelCheckout(checkoutId: string) {
    const c = this.db.get<Checkout>("checkouts", checkoutId);
    if (!c || c.status !== "pending") return;
    for (const v of this.db
      .list<Voucher>("vouchers")
      .filter((x) => x.reservedBy === c.id)) {
      delete v.reservedBy;
      this.db.put("vouchers", v);
    }
    this.db.put("checkouts", { ...c, status: "cancelled" });
  }
  orderDraft(user: User, body: any, key: string) {
    this.require(user, ["customer"]);
    const existing = this.db
      .list<Checkout>("checkouts")
      .find((c) => c.userId === user.id && c.key === key);
    if (existing) return existing;
    const store = this.db.get<Store>("stores", body.storeId);
    assert(store, "Cafe not found.", 404);
    assert(
      Array.isArray(body.lines) &&
        body.lines.length > 0 &&
        body.lines.length <= 50,
      "Add 1 to 50 items to your cart.",
    );
    const lines = body.lines.map((line: CartLine) => {
      const item = this.db.get<MenuItem>("menu", line.itemId);
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
    });
    const total = lines.reduce(
      (s: number, l: any) => s + l.quantity * l.unitAmount,
      0,
    );
    integer(total, 1, 10000000);
    let remaining = total;
    const allocations: { id: string; amount: number }[] = [];
    if (body.useVouchers) {
      const vouchers = this.db
        .list<Voucher>("vouchers")
        .filter(
          (v) =>
            v.storeId === store.id &&
            v.email === user.email &&
            !v.reservedBy &&
            v.expiresAt > Date.now(),
        )
        .sort((a, b) => a.expiresAt - b.expiresAt);
      for (const v of vouchers) {
        if (!remaining) break;
        const amount = Math.min(v.balance, remaining);
        allocations.push({ id: v.id, amount });
        remaining -= amount;
      }
    }
    const c = this.newCheckout(
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
                ...allocations.map(
                  (a) => this.db.get<Voucher>("vouchers", a.id)!.expiresAt,
                ),
              ),
            }
          : {}),
      },
      remaining,
      key,
    );
    for (const a of allocations) {
      const v = this.db.get<Voucher>("vouchers", a.id)!;
      this.db.put("vouchers", { ...v, reservedBy: c.id });
    }
    return c;
  }
  completeOrder(user: User, orderId: string) {
    const o = this.db.get<Order>("orders", orderId);
    assert(o, "Order not found.", 404);
    this.ownedStore(user, o.storeId);
    this.db.put("orders", { ...o, status: "done", completedAt: Date.now() });
    const customer = this.db.get<User>("users", o.userId);
    if (customer?.orderNotifications)
      this.queue(
        "push",
        customer.id,
        "Your order is ready",
        "Your cafe order is ready to collect.",
        { orderId: o.id },
      );
  }
  deleteVouchers(user: User, ids: unknown) {
    assert(
      Array.isArray(ids) && ids.length > 0 && ids.length <= 1000,
      "Select vouchers to delete.",
    );
    const store = this.ownedStore(user);
    for (const value of ids) {
      const v = this.db.get<Voucher>("vouchers", String(value));
      assert(
        v && v.storeId === store.id && !v.reservedBy,
        "Voucher unavailable.",
        409,
      );
    }
    for (const value of ids) this.db.delete("vouchers", String(value));
  }
  allocate(user: User, body: any) {
    const org = this.org(user);
    const recipient = this.db
      .list<Recipient>("recipients")
      .find((r) => r.orgId === org.id && r.email === email(body.email));
    assert(recipient, "Add this email to your recipients first.");
    assert(
      Array.isArray(body.ids) && body.ids.length > 0 && body.ids.length <= 100,
      "Select up to 100 vouchers.",
    );
    for (const value of body.ids) {
      const v = this.db.get<Voucher>("vouchers", value);
      assert(
        v &&
          v.orgId === org.id &&
          !v.email &&
          !v.reservedBy &&
          v.expiresAt > Date.now(),
        "A selected voucher is unavailable.",
        409,
      );
    }
    for (const value of body.ids) {
      const v = this.db.get<Voucher>("vouchers", value)!;
      this.db.put("vouchers", { ...v, email: recipient.email });
    }
    this.queue(
      "email",
      recipient.email,
      "A little coffee, on us",
      `${org.name} has shared ${body.ids.length} cafe voucher(s) with you. Sign in with this email to view them.`,
    );
  }
  share(user: User, body: any) {
    this.require(user, ["customer"]);
    const v = this.db.get<Voucher>("vouchers", text(body.id));
    assert(
      v && v.email === user.email && !v.reservedBy && v.expiresAt > Date.now(),
      "Voucher unavailable.",
      409,
    );
    const address = email(body.email);
    assert(address !== user.email, "Choose another recipient.");
    assert(
      this.db
        .list<Recipient>("recipients")
        .some((r) => r.orgId === v.orgId && r.email === address),
      "You can only share with a recipient in the same organisation.",
    );
    this.db.put("vouchers", { ...v, email: address });
    this.queue(
      "email",
      address,
      "A voucher has been shared with you",
      `Sign in with this email to use your cafe voucher ${v.code}.`,
    );
  }
  recipients(user: User, body: any) {
    const org = this.org(user);
    if (body.action === "delete") {
      assert(
        Array.isArray(body.ids) && body.ids.length <= 1000,
        "Select recipients.",
      );
      for (const rid of body.ids) {
        const r = this.db.get<Recipient>("recipients", rid);
        assert(r?.orgId === org.id, "Recipient not found.", 404);
        for (const v of this.db
          .list<Voucher>("vouchers")
          .filter((v) => v.orgId === org.id && v.email === r.email)) {
          assert(!v.reservedBy, "A recipient has a payment in progress.", 409);
          delete v.email;
          this.db.put("vouchers", v);
        }
        this.db.delete("recipients", rid);
      }
    } else {
      const address = email(body.email);
      let r: Recipient | undefined = body.id
        ? this.db.get("recipients", body.id)
        : undefined;
      if (body.id) {
        assert(r?.orgId === org.id, "Recipient not found.", 404);
        for (const v of this.db
          .list<Voucher>("vouchers")
          .filter((v) => v.orgId === org.id && v.email === r!.email)) {
          assert(!v.reservedBy, "A recipient has a payment in progress.", 409);
          this.db.put("vouchers", { ...v, email: address });
        }
      }
      assert(
        !this.db
          .list<Recipient>("recipients")
          .some(
            (x) => x.orgId === org.id && x.email === address && x.id !== r?.id,
          ),
        "Recipient already exists.",
      );
      this.db.put("recipients", {
        id: r?.id ?? id(),
        orgId: org.id,
        email: address,
      });
    }
  }
  saveProfile(user: User, body: any) {
    user.name = text(body.name, 120);
    user.phone = typeof body.phone === "string" ? body.phone.slice(0, 40) : "";
    if (user.role === "owner") {
      const s = this.ownedStore(user);
      assert(
        ["AUD", "USD", "NZD", "GBP", "EUR"].includes(body.currency),
        "Select a supported currency.",
      );
      if (s.currency !== body.currency)
        assert(
          !this.db.list<Order>("orders").some((o) => o.storeId === s.id) &&
            !this.db.list<Voucher>("vouchers").some((v) => v.storeId === s.id),
          "Currency cannot change while orders or vouchers exist.",
        );
      const logo = typeof body.logo === "string" ? body.logo : "";
      assert(
        !logo ||
          (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) &&
            logo.length < 180000),
        "Upload a PNG, JPEG, or WebP logo smaller than 130 KB.",
      );
      this.db.put("stores", {
        ...s,
        name: text(body.storeName, 120),
        address:
          typeof body.address === "string" ? body.address.slice(0, 300) : "",
        phone: user.phone,
        currency: body.currency,
        logo,
      });
    }
    if (user.role === "organisation") {
      const org = this.org(user);
      this.db.put("organisations", {
        ...org,
        name: text(body.orgName, 120),
        contact: user.name,
      });
    }
    return this.db.put("users", user);
  }
  bootstrap(user: User | null) {
    const allStores = this.db.list<Store>("stores");
    const stores = allStores.map(({ ownerId, ...s }) => ({
      ...s,
      ownerId: "",
    }));
    if (!user)
      return {
        user: null,
        stores,
        menu: this.db.list<MenuItem>("menu"),
        orders: [],
        vouchers: [],
        organisations: [],
        recipients: [],
        templates: [],
        demo: this.demo,
      };
    const owner = user.role === "owner";
    const org =
      user.role === "organisation"
        ? this.db.get<Organisation>("organisations", user.orgId ?? "")
        : undefined;
    const admin = user.role === "admin";
    return {
      user: { ...user, stripeCustomer: undefined },
      stores,
      menu: this.db
        .list<MenuItem>("menu")
        .filter((m) => !owner || m.storeId === user.storeId),
      orders: this.db
        .list<Order>("orders")
        .filter(
          (o) =>
            admin ||
            (owner && o.storeId === user.storeId) ||
            o.userId === user.id,
        )
        .sort((a, b) => b.createdAt - a.createdAt),
      vouchers: this.db
        .list<Voucher>("vouchers")
        .filter(
          (v) =>
            v.expiresAt > Date.now() &&
            v.balance > 0 &&
            (admin ||
              (owner && v.storeId === user.storeId) ||
              (org && v.orgId === org.id) ||
              (user.role === "customer" && v.email === user.email)),
        ),
      organisations: this.db
        .list<Organisation>("organisations")
        .filter(
          (o) =>
            admin || (owner && o.storeId === user.storeId) || o.id === org?.id,
        ),
      recipients: this.db
        .list<Recipient>("recipients")
        .filter((r) => admin || r.orgId === org?.id),
      templates: this.db
        .list<MenuItem>("templates")
        .filter((t) => t.storeId === user.storeId),
      demo: this.demo,
      ...(admin
        ? {
            users: this.db
              .list<User>("users")
              .map((u) => ({ ...u, stripeCustomer: undefined })),
            feedback: this.db.list<Feedback>("feedback"),
            logs: this.db
              .list<any>("logs")
              .sort((a, b) => b.createdAt - a.createdAt)
              .slice(0, 100),
            settings: this.db.get("settings", "global") ?? {
              subscriptionPrice: 2900,
            },
            builds: this.db.list("builds"),
          }
        : {}),
    };
  }
  seed() {
    if (!this.demo || this.db.list<Store>("stores").length) return;
    this.db.atomic(() => {
      const owner = this.db.put("users", {
        id: "demo-owner",
        email: "owner@cafe.test",
        role: "owner",
        name: "Anne Miren Arevalo",
        phone: "",
        storeId: "demo-cafe",
        orderNotifications: true,
        announcements: true,
      } as User);
      this.db.put("stores", {
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
      this.addTemplate(owner, "Coffee");
      this.addTemplate(owner, "Food");
      this.db.put("organisations", {
        id: "demo-org",
        storeId: "demo-cafe",
        name: "NEP Group",
        email: "organisation@cafe.test",
        contact: "John",
      });
      for (const [key, address, role] of [
        ["customer", "customer@cafe.test", "customer"],
        ["organisation", "organisation@cafe.test", "organisation"],
      ] as const)
        this.db.put("users", {
          id: `demo-${key}-user`,
          email: address,
          role,
          name: key === "customer" ? "John Parker" : "John",
          phone: "",
          ...(role === "organisation" ? { orgId: "demo-org" } : {}),
          orderNotifications: true,
          announcements: true,
        });
      for (const address of ["customer@cafe.test", "colleague@cafe.test"])
        this.db.put("recipients", {
          id: id(),
          orgId: "demo-org",
          email: address,
        });
      for (let i = 0; i < 4; i++)
        this.db.put("vouchers", {
          id: id(),
          code: `cafe0${i}`,
          storeId: "demo-cafe",
          orgId: "demo-org",
          balance: [1500, 500, 200, 180][i],
          initialAmount: 1500,
          expiresAt: Date.UTC(new Date().getUTCFullYear() + 1, 9, 1),
          ...(i < 2 ? { email: "customer@cafe.test" } : {}),
        });
      const first = this.db.list<MenuItem>("menu")[0];
      for (const [i, name] of [
        "John P.",
        "Maria A.",
        "Stephen K.",
        "Miren A.",
      ].entries())
        this.db.put("orders", {
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
