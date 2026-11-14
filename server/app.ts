import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import {
  Domain,
  AppError,
  assert,
  email,
  text,
  integer,
  id,
  admins,
  type Checkout,
} from "./domain";
import { checkout, stripe, customer, getCards } from "./integrations";
import { isLocalTestingRequest } from "./local-testing";
import { emailConfiguration } from "./email";
import { normalizeBasePath } from "../src/paths";
import type { User, Store, Voucher, Organisation } from "../src/types";
export function createApp(
  d: Domain,
  {
    origin = "http://localhost:8080",
    production = false,
    basePath = process.env.APP_BASE_PATH ?? "",
  }: { origin?: string; production?: boolean; basePath?: string } = {},
) {
  const prefix = normalizeBasePath(basePath);
  const app = express();
  const testingAvailable = (req: express.Request) =>
    d.demo &&
    !production &&
    process.env.NODE_ENV !== "production" &&
    isLocalTestingRequest(req);
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY === "1") app.set("trust proxy", 1);
  app.use(
    helmet({
      contentSecurityPolicy: production
        ? {
            directives: {
              defaultSrc: ["'self'"],
              scriptSrc: ["'self'"],
              styleSrc: ["'self'", "'unsafe-inline'"],
              imgSrc: ["'self'", "data:", "blob:"],
              connectSrc: ["'self'"],
              fontSrc: ["'self'", "data:"],
              frameAncestors: ["'none'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.post(
    "/api/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res, next) => {
      try {
        assert(
          stripe && process.env.STRIPE_WEBHOOK_SECRET,
          "Webhook not configured.",
          503,
        );
        const event = stripe.webhooks.constructEvent(
          req.body,
          req.headers["stripe-signature"] as string,
          process.env.STRIPE_WEBHOOK_SECRET,
        );
        await d.db.atomic(async () => {
          if (await d.db.get("events", event.id)) return;
          const session = event.data.object as any;
          const c = await d.db.get<Checkout>(
            "checkouts",
            session.metadata?.checkoutId ?? "",
          );
          if (c && c.stripeId === session.id) {
            if (
              (event.type === "checkout.session.completed" ||
                event.type === "checkout.session.async_payment_succeeded") &&
              session.payment_status === "paid"
            ) {
              assert(
                session.amount_total === c.amount &&
                  session.currency === c.currency,
                "Payment amount mismatch.",
                409,
              );
              await d.fulfill(c.id);
            }
            if (
              event.type === "checkout.session.expired" ||
              event.type === "checkout.session.async_payment_failed"
            )
              await d.cancelCheckout(c.id);
          }
          await d.db.put("events", { id: event.id, createdAt: Date.now() });
        });
        res.json({ received: true });
      } catch (e) {
        next(e);
      }
    },
  );
  // Parse before asynchronous middleware: Lambda's synthetic request already has
  // a Buffer body and can otherwise appear complete before body-parser runs.
  // The Stripe route above must retain its raw body for signature verification.
  app.use(express.json({ limit: "1mb" }));
  app.use(
    "/api",
    rateLimit({
      windowMs: 60000,
      limit: 300,
      standardHeaders: "draft-8",
      legacyHeaders: false,
    }),
  );
  app.use("/api", async (req, res, next) => {
    const incoming = req.headers.origin;
    if (
      incoming &&
      incoming !== origin &&
      (production || incoming !== "http://127.0.0.1:8080")
    )
      return res.status(403).json({ error: "Origin not allowed." });
    if (incoming) {
      res.setHeader("Access-Control-Allow-Origin", incoming);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Cafe-Client, Idempotency-Key",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, DELETE, OPTIONS",
      );
    }
    if (req.method === "OPTIONS") return res.sendStatus(204);
    if (
      !["GET", "HEAD"].includes(req.method) &&
      req.headers["sec-fetch-site"] === "cross-site"
    )
      return res.status(403).json({ error: "Origin not allowed." });
    res.setHeader("Cache-Control", "no-store");
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("cafe_session="))
      ?.slice(13);
    const sessionToken = bearer ?? cookie;
    res.locals.sessionToken = sessionToken;
    res.locals.user =
      sessionToken?.startsWith("testing_") && !testingAvailable(req)
        ? null
        : await d.authenticate(sessionToken);
    next();
  });
  const auth = (req: any, res: any, next: any) => {
    if (!res.locals.user)
      return res.status(401).json({ error: "Please sign in to continue." });
    next();
  };
  const loginLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  });
  const respondSession = (
    req: express.Request,
    res: express.Response,
    result: Awaited<ReturnType<Domain["verify"]>>,
  ) => {
    res.cookie("cafe_session", result.token, {
      httpOnly: true,
      secure: production,
      sameSite: "strict",
      maxAge: 30 * 86400000,
      path: "/",
    });
    res.json({
      ...result,
      token:
        req.headers["x-cafe-client"] === "native" ? result.token : undefined,
    });
  };
  app.post("/api/auth/testing", loginLimit, async (req, res) => {
    assert(testingAvailable(req), "Testing mode is unavailable.", 404);
    respondSession(req, res, await d.testingLogin(req.body.role));
  });
  app.post("/api/auth/request", loginLimit, async (req, res) => {
    assert(
      d.demo || emailConfiguration(),
      "Email sign-in is not configured yet.",
      503,
    );
    res.json(await d.requestCode(req.body.email));
  });
  app.post("/api/auth/verify", loginLimit, async (req, res) => {
    const result = await d.verify(req.body.email, req.body.code);
    respondSession(req, res, result);
  });
  app.post("/api/auth/logout", auth, async (_req, res) => {
    await d.logout(res.locals.user);
    res.clearCookie("cafe_session", { path: "/" });
    res.json({ ok: true });
  });
  app.post("/api/auth/role", auth, async (req, res) => {
    res.json(
      await d.db.atomic(
        async () =>
          await d.chooseAccount(
            res.locals.user,
            req.body.role,
            res.locals.sessionToken,
          ),
      ),
    );
  });
  app.get("/api/bootstrap", async (req, res) => {
    const result = await d.bootstrap(res.locals.user);
    let cards: Awaited<ReturnType<typeof getCards>> = [];
    let paymentWarning: string | undefined;
    try {
      cards = res.locals.user ? await getCards(res.locals.user) : [];
    } catch {
      paymentWarning =
        "Saved cards are temporarily unavailable. Please try again.";
    }
    res.json({
      ...result,
      paymentsEnabled: !!stripe,
      cards,
      paymentWarning,
      testingModeAvailable: testingAvailable(req),
    });
  });
  app.post("/api/menu/template", auth, async (req, res) => {
    await d.db.atomic(
      async () => await d.addTemplate(res.locals.user, text(req.body.name)),
    );
    res.json({ ok: true });
  });
  app.post("/api/menu", auth, async (req, res) => {
    res.json(
      await d.db.atomic(
        async () => await d.saveMenu(res.locals.user, req.body),
      ),
    );
  });
  app.post("/api/menu/delete", auth, async (req, res) => {
    await d.db.atomic(
      async () => await d.deleteMenu(res.locals.user, req.body),
    );
    res.json({ ok: true });
  });
  app.post("/api/profile", auth, async (req, res) =>
    res.json(
      await d.db.atomic(
        async () => await d.saveProfile(res.locals.user, req.body),
      ),
    ),
  );
  app.post("/api/profile/email/request", auth, loginLimit, async (req, res) => {
    assert(
      d.demo || emailConfiguration(),
      "Email delivery is not configured.",
      503,
    );
    res.json(await d.changeEmailRequest(res.locals.user, req.body.email));
  });
  app.post("/api/profile/email/verify", auth, loginLimit, async (req, res) =>
    res.json(await d.changeEmailVerify(res.locals.user, req.body.code)),
  );
  app.post("/api/settings", auth, async (req, res) => {
    const u = res.locals.user as User;
    assert(
      typeof req.body.orderNotifications === "boolean" &&
        typeof req.body.announcements === "boolean",
      "Invalid settings.",
    );
    res.json(
      await d.db.put("users", {
        ...(await d.db.get<User>("users", u.id))!,
        orderNotifications: req.body.orderNotifications,
        announcements: req.body.announcements,
      }),
    );
  });
  app.post("/api/devices", auth, async (req, res) => {
    const token = text(req.body.token, 300);
    assert(
      /^(ExponentPushToken|ExpoPushToken)\[[a-zA-Z0-9_-]+\]$/.test(token),
      "Invalid push token.",
    );
    const previous = (await d.db.list<any>("devices")).find(
      (x) => x.token === token,
    );
    await d.db.put("devices", {
      id: previous?.id ?? id(),
      userId: res.locals.user.id,
      token,
    });
    res.json({ ok: true });
  });
  app.post("/api/orders/complete", auth, async (req, res) => {
    await d.db.atomic(
      async () => await d.completeOrder(res.locals.user, text(req.body.id)),
    );
    res.json({ ok: true });
  });
  app.post("/api/vouchers/delete", auth, async (req, res) => {
    await d.db.atomic(
      async () => await d.deleteVouchers(res.locals.user, req.body.ids),
    );
    res.json({ ok: true });
  });
  app.post("/api/vouchers/share", auth, async (req, res) => {
    await d.db.atomic(async () => await d.share(res.locals.user, req.body));
    res.json({ ok: true });
  });
  app.post("/api/vouchers/allocate", auth, async (req, res) => {
    await d.db.atomic(async () => await d.allocate(res.locals.user, req.body));
    res.json({ ok: true });
  });
  app.post("/api/recipients", auth, async (req, res) => {
    await d.db.atomic(
      async () => await d.recipients(res.locals.user, req.body),
    );
    res.json({ ok: true });
  });
  app.post("/api/feedback", auth, async (req, res) => {
    await d.db.put("feedback", {
      id: id(),
      userId: res.locals.user.id,
      email: res.locals.user.email,
      rating: integer(req.body.rating, 1, 5),
      subject: text(req.body.subject, 100),
      message: text(req.body.message, 4000),
      createdAt: Date.now(),
    });
    res.json({ ok: true });
  });
  app.post("/api/checkout", auth, async (req, res) => {
    const user: User = res.locals.user;
    const key = text(req.headers["idempotency-key"], 100);
    let c: Checkout = await d.db.atomic(async () => {
      if (req.body.type === "vouchers") {
        const existing = (await d.db.list<Checkout>("checkouts")).find(
          (c) => c.userId === user.id && c.key === key,
        );
        if (existing) return existing;
        const draft = await d.generateDraft(user, req.body);
        return await d.newCheckout(
          user,
          "vouchers",
          draft.store,
          draft.payload,
          draft.total,
          key,
        );
      }
      return await d.orderDraft(user, req.body, key);
    });
    if (c.status === "fulfilled")
      return res.json({ result: c.result, checkoutId: c.id });
    assert(c.status === "pending", "This checkout has expired.", 409);
    if (c.amount === 0 || req.body.payment === "cash") {
      try {
        assert(
          c.amount === 0 ||
            (c.type === "vouchers" &&
              (user.role === "owner" || user.role === "admin") &&
              req.body.cashReceived === true),
          "Only cafe owners can confirm cash received.",
          403,
        );
        const result = await d.db.atomic(
          async () =>
            await d.fulfill(c.id, c.amount === 0 ? "voucher" : "cash in store"),
        );
        return res.json({ result, checkoutId: c.id });
      } catch (e) {
        await d.db.atomic(async () => await d.cancelCheckout(c.id));
        throw e;
      }
    }
    try {
      assert(
        stripe,
        "Card payments have not been configured. Choose vouchers or contact the cafe.",
        503,
      );
      const url = await checkout(d, c, user, origin + prefix);
      res.json({ url, checkoutId: c.id });
    } catch (e) {
      await d.db.atomic(async () => await d.cancelCheckout(c.id));
      throw e;
    }
  });
  app.get("/api/checkout/:id", auth, async (req, res) => {
    let c = await d.db.get<Checkout>("checkouts", String(req.params.id));
    assert(c && c.userId === res.locals.user.id, "Checkout not found.", 404);
    if (c.status === "pending" && c.stripeId && stripe) {
      const s = await stripe.checkout.sessions.retrieve(c.stripeId);
      if (s.payment_status === "paid") {
        assert(
          s.amount_total === c.amount && s.currency === c.currency,
          "Payment amount mismatch.",
        );
        await d.db.atomic(async () => await d.fulfill(c!.id));
        c = (await d.db.get("checkouts", c.id))!;
      } else if (s.status === "expired")
        await d.db.atomic(async () => await d.cancelCheckout(c!.id));
    }
    res.json({ status: c.status, result: c.result });
  });
  app.post("/api/checkout/cancel", auth, async (req, res) => {
    const c = await d.db.get<Checkout>("checkouts", text(req.body.id));
    assert(c && c.userId === res.locals.user.id, "Checkout not found.", 404);
    if (c.stripeId && stripe) {
      const s = await stripe.checkout.sessions.retrieve(c.stripeId);
      assert(
        s.payment_status !== "paid",
        "Payment has already completed.",
        409,
      );
      if (s.status === "open") await stripe.checkout.sessions.expire(s.id);
    }
    await d.db.atomic(async () => await d.cancelCheckout(c.id));
    res.json({ ok: true });
  });
  app.post("/api/cards/setup", auth, async (_req, res) => {
    assert(stripe, "Card payments have not been configured.", 503);
    const user: User = res.locals.user;
    const customerId = await customer(d, user);
    const s = await stripe.checkout.sessions.create({
      mode: "setup",
      customer: customerId,
      currency: "aud",
      success_url: `${origin}${prefix}/?card=saved`,
      cancel_url: `${origin}${prefix}/?card=cancelled`,
    });
    res.json({ url: s.url });
  });
  app.post("/api/cards/delete", auth, async (req, res) => {
    assert(stripe && res.locals.user.stripeCustomer, "No saved card.", 404);
    const method = await stripe.paymentMethods.retrieve(text(req.body.id));
    assert(
      method.customer === res.locals.user.stripeCustomer,
      "Card not found.",
      404,
    );
    await stripe.paymentMethods.detach(method.id);
    res.json({ ok: true });
  });
  app.post("/api/admin", auth, async (req, res) => {
    const user: User = res.locals.user;
    d.require(user, ["admin"]);
    const b = req.body;
    const result = await d.db.atomic(async () => {
      switch (b.action) {
        case "settings":
          return await d.db.put("settings", {
            id: "global",
            subscriptionPrice: integer(b.price, 0, 1000000),
          });
        case "announcement": {
          const message = text(b.message, 1000);
          for (const u of (await d.db.list<User>("users")).filter(
            (u) => u.announcements && !u.disabled,
          ))
            await d.queue("push", u.id, "Cafe announcement", message, {
              kind: "announcement",
            });
          return { ok: true };
        }
        case "user": {
          const address = email(b.email);
          let u = (await d.db.list<User>("users")).find(
            (x) => x.email === address,
          );
          assert(
            !b.role || ["owner", "customer", "organisation"].includes(b.role),
            "Invalid role.",
          );
          if (!u) {
            u = await d.db.put("users", {
              id: id(),
              email: address,
              name: typeof b.name === "string" ? b.name.slice(0, 120) : "",
              phone: typeof b.phone === "string" ? b.phone.slice(0, 40) : "",
              orderNotifications: true,
              announcements: true,
            });
            await d.setRole(u, b.role ?? "customer");
          } else {
            assert(
              (u.role !== "admin" && !admins.has(u.email)) || !b.disabled,
              "Cannot disable an administrator.",
            );
            if (b.role && u.role !== b.role) {
              assert(!admins.has(address), "Administrator role is fixed.");
              assert(
                !u.role || u.role === "customer",
                "Only customer accounts can be reassigned.",
              );
              u.role = undefined;
              await d.setRole(u, b.role);
            }
          }
          const updated = {
            ...(await d.db.get<User>("users", u.id))!,
            name: typeof b.name === "string" ? b.name.slice(0, 120) : u.name,
            phone: typeof b.phone === "string" ? b.phone.slice(0, 40) : u.phone,
            disabled: !!b.disabled,
          };
          await d.db.put("users", updated);
          return { ok: true };
        }
        case "delete-user": {
          const target = await d.db.get<User>("users", text(b.id));
          assert(
            target && target.role !== "admin" && !admins.has(target.email),
            "Account cannot be deleted.",
          );
          const storeIds = (await d.db.list<Store>("stores"))
            .filter((s) => s.ownerId === target.id)
            .map((s) => s.id);
          assert(
            !(await d.db.list<Checkout>("checkouts")).some(
              (c) =>
                c.status === "pending" &&
                (c.userId === target.id || storeIds.includes(c.storeId)),
            ),
            "Resolve pending checkouts before deleting this account.",
            409,
          );
          if (target.orgId) {
            for (const kind of ["vouchers", "recipients"])
              for (const row of await d.db.list<any>(kind))
                if (row.orgId === target.orgId) await d.db.delete(kind, row.id);
            await d.db.delete("organisations", target.orgId);
          }
          for (const v of (await d.db.list<Voucher>("vouchers")).filter(
            (v) => v.email === target.email,
          )) {
            assert(
              !v.reservedBy,
              "Resolve pending checkouts before deleting this account.",
              409,
            );
            delete v.email;
            await d.db.put("vouchers", v);
          }
          for (const kind of [
            "vouchers",
            "menu",
            "templates",
            "orders",
            "organisations",
            "checkouts",
            "builds",
          ])
            for (const row of await d.db.list<any>(kind))
              if (storeIds.includes(row.storeId) || row.userId === target.id)
                await d.db.delete(kind, row.id);
          for (const r of await d.db.list<any>("recipients"))
            if (!(await d.db.get("organisations", r.orgId)))
              await d.db.delete("recipients", r.id);
          for (const sid of storeIds) await d.db.delete("stores", sid);
          await d.logout(target);
          await d.db.delete("users", target.id);
          return { ok: true };
        }
        case "subscription": {
          const s = await d.db.get<Store>("stores", text(b.storeId));
          assert(s, "Cafe not found.", 404);
          assert(["free", "paid"].includes(b.tier), "Invalid tier.");
          return await d.db.put("stores", {
            ...s,
            tier: b.tier,
            subscription:
              b.tier === "paid" ? "Paid · manually managed" : "Free",
          });
        }
        case "import": {
          assert(
            Array.isArray(b.cafes) &&
              b.cafes.length > 0 &&
              b.cafes.length <= 500,
            "Import 1 to 500 cafes.",
          );
          for (const row of b.cafes) {
            const address = email(row.ownerEmail);
            let owner = (await d.db.list<User>("users")).find(
              (x) => x.email === address,
            );
            assert(
              !owner?.role || owner.role === "owner",
              "An imported email belongs to a different role.",
            );
            if (!owner)
              owner = await d.db.put("users", {
                id: id(),
                email: address,
                name:
                  typeof row.ownerName === "string"
                    ? row.ownerName.slice(0, 120)
                    : "",
                phone: "",
                orderNotifications: true,
                announcements: true,
              });
            if (!owner.role) owner = await d.setRole(owner, "owner");
            const s = (await d.db.get<Store>("stores", owner.storeId!))!;
            await d.db.put("stores", {
              ...s,
              name: text(row.name, 120),
              address:
                typeof row.address === "string"
                  ? row.address.slice(0, 300)
                  : s.address,
            });
          }
          return { imported: b.cafes.length };
        }
        case "build": {
          const store = await d.db.get<Store>("stores", text(b.storeId));
          assert(store, "Cafe not found.", 404);
          return await d.db.put("builds", {
            id: randomUUID(),
            storeId: store.id,
            name: store.name,
            createdAt: Date.now(),
          });
        }
        default:
          throw new AppError("Unknown management action.");
      }
    });
    res.json(result);
  });
  app.get("/api/admin/build/:id", auth, async (req, res) => {
    d.require(res.locals.user, ["admin"]);
    const build = await d.db.get<any>("builds", String(req.params.id));
    assert(build, "App configuration not found.", 404);
    res.json({
      name: build.name,
      slug: `cafe-${build.id.slice(0, 8)}`,
      extra: { storeId: build.storeId, apiUrl: origin },
      instructions:
        "Set unique bundle identifiers and an Expo project ID, then run EAS Build. This configuration does not contain signing credentials.",
    });
  });
  app.use("/fonts", express.static(resolve("public/fonts"), { maxAge: "7d" }));
  app.use(
    "/design",
    express.static(resolve("public/design"), { maxAge: "7d" }),
  );
  app.use(express.static(resolve("dist")));
  app.get("/{*path}", (req, res) => {
    if (req.path.startsWith("/api"))
      return res.status(404).json({ error: "Not found." });
    res.sendFile(resolve("dist/index.html"));
  });
  app.use(async (err: any, _req: any, res: any, _next: any) => {
    if (!(err instanceof AppError))
      try {
        await d.log(`Request failed: ${err?.type ?? err?.name ?? "Error"}`);
      } catch {
        /* Database errors must still receive a JSON response. */
      }
    res
      .status(
        err instanceof AppError
          ? err.status
          : err?.type === "entity.too.large"
            ? 413
            : 500,
      )
      .json({
        error:
          err instanceof AppError
            ? err.message
            : "Something went wrong. Please try again.",
      });
  });
  if (prefix) {
    const root = express();
    root.disable("x-powered-by");
    root.use(prefix, app);
    return root;
  }
  return app;
}
