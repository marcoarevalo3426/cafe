import Stripe from "stripe";
import type { Domain, Job, Checkout } from "./domain";
import { AppError, assert } from "./domain";
import type { User } from "../src/types";
import { sendEmail } from "./email";
export const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;
export async function getCards(user: User) {
  if (!stripe || !user.stripeCustomer) return [];
  const cards = await stripe.paymentMethods.list({
    customer: user.stripeCustomer,
    type: "card",
  });
  return cards.data.map((x) => ({
    id: x.id,
    brand: x.card!.brand,
    last4: x.card!.last4,
    exp_month: x.card!.exp_month,
    exp_year: x.card!.exp_year,
  }));
}
export async function customer(domain: Domain, user: User) {
  assert(stripe, "Card payments have not been configured.", 503);
  if (user.stripeCustomer) return user.stripeCustomer;
  const created = await stripe.customers.create(
    { email: user.email, name: user.name || undefined },
    { idempotencyKey: `customer-${user.id}` },
  );
  await domain.db.put("users", {
    ...(await domain.db.get<User>("users", user.id))!,
    stripeCustomer: created.id,
  });
  return created.id;
}
export async function checkout(
  domain: Domain,
  c: Checkout,
  user: User,
  origin: string,
) {
  assert(stripe, "Card payments have not been configured.", 503);
  if (c.stripeId) {
    const existing = await stripe.checkout.sessions.retrieve(c.stripeId);
    return existing.url;
  }
  const customerId = await customer(domain, user);
  const expires = Math.min(
    Math.floor(Date.now() / 1000) + 24 * 3600,
    Math.floor(
      Math.min(
        c.type === "vouchers" ? c.payload.expiresAt : Infinity,
        c.payload.voucherExpiresAt ?? Infinity,
      ) / 1000,
    ),
  );
  assert(
    expires >= Math.floor(Date.now() / 1000) + 1800,
    "A voucher expires in less than 30 minutes. Use another payment method or choose a later validity.",
  );
  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      customer: customerId,
      client_reference_id: c.id,
      metadata: { checkoutId: c.id },
      expires_at: expires,
      success_url: `${origin}/?checkout=${c.id}`,
      cancel_url: `${origin}/?cancelled=${c.id}`,
      saved_payment_method_options: {
        payment_method_save: "enabled",
        payment_method_remove: "enabled",
      },
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: c.currency,
            unit_amount: c.amount,
            product_data: {
              name: c.type === "order" ? "Café order" : "Café vouchers",
            },
          },
        },
      ],
    },
    { idempotencyKey: c.id },
  );
  await domain.db.put("checkouts", { ...c, stripeId: session.id });
  return session.url;
}
let working = false;
export async function processJobs(domain: Domain) {
  if (working) return;
  working = true;
  try {
    for (const job of (await domain.db.list<Job>("jobs"))
      .filter(
        (j) =>
          !j.sentAt && j.attempts < 8 && (j.nextAttempt ?? 0) <= Date.now(),
      )
      .slice(0, 30)) {
      try {
        if (job.type === "email") {
          if (domain.demo) {
            await domain.db.put("jobs", { ...job, sentAt: Date.now() });
            continue;
          }
          await sendEmail(job);
        } else {
          const user = await domain.db.get<User>("users", job.to);
          const announcement = job.data?.kind === "announcement";
          if (
            !user ||
            (announcement ? !user.announcements : !user.orderNotifications)
          ) {
            await domain.db.put("jobs", { ...job, sentAt: Date.now() });
            continue;
          }
          const devices = (await domain.db.list<any>("devices")).filter(
            (d) => d.userId === job.to,
          );
          for (const device of devices) {
            const r = await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(process.env.EXPO_ACCESS_TOKEN
                  ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
                  : {}),
              },
              body: JSON.stringify({
                to: device.token,
                title: job.subject,
                body: job.message,
                data: job.data,
                sound: "default",
                channelId: "orders",
              }),
              signal: AbortSignal.timeout(15000),
            });
            assert(r.ok, "Push provider rejected delivery.", 502);
            const ticket: any = await r.json();
            assert(ticket.data?.status === "ok", "Push ticket rejected.", 502);
            await domain.db.put("pushReceipts", {
              id: ticket.data.id,
              deviceId: device.id,
              createdAt: Date.now(),
            });
          }
        }
        await domain.db.put("jobs", {
          ...job,
          sentAt: Date.now(),
          error: undefined,
        });
      } catch (e) {
        const error =
          e instanceof AppError ? e.message : "Delivery service unavailable.";
        await domain.db.put("jobs", {
          ...job,
          attempts: job.attempts + 1,
          nextAttempt:
            Date.now() + Math.min(3600000, 30000 * 2 ** job.attempts),
          error,
        });
        await domain.log(
          `${job.type} delivery failed for job ${job.id}: ${error}`,
        );
      }
    }
    await checkReceipts(domain);
  } finally {
    working = false;
  }
}
async function checkReceipts(domain: Domain) {
  const jobs = (await domain.db.list<any>("pushReceipts"))
    .filter((x) => Date.now() - x.createdAt > 15 * 60 * 1000)
    .slice(0, 100);
  if (!jobs.length) return;
  try {
    const response = await fetch(
      "https://exp.host/--/api/v2/push/getReceipts",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(process.env.EXPO_ACCESS_TOKEN
            ? { Authorization: `Bearer ${process.env.EXPO_ACCESS_TOKEN}` }
            : {}),
        },
        body: JSON.stringify({ ids: jobs.map((x) => x.id) }),
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) return;
    const { data } = (await response.json()) as any;
    for (const j of jobs) {
      const receipt = data?.[j.id];
      if (receipt?.details?.error === "DeviceNotRegistered")
        await domain.db.delete("devices", j.deviceId);
      if (receipt || Date.now() - j.createdAt > 86400000)
        await domain.db.delete("pushReceipts", j.id);
    }
  } catch {
    await domain.log("Could not check push delivery receipts.");
  }
}

let reconciling = false;
export async function reconcilePayments(domain: Domain) {
  if (!stripe || reconciling) return;
  reconciling = true;
  try {
    for (const c of (await domain.db.list<Checkout>("checkouts"))
      .filter((c) => c.status === "pending" && c.stripeId)
      .slice(0, 100)) {
      try {
        const s = await stripe.checkout.sessions.retrieve(c.stripeId!);
        if (s.payment_status === "paid") {
          assert(
            s.amount_total === c.amount && s.currency === c.currency,
            "Payment amount mismatch.",
          );
          await domain.db.atomic(async () => await domain.fulfill(c.id));
        } else if (s.status === "expired")
          await domain.db.atomic(async () => await domain.cancelCheckout(c.id));
      } catch {
        await domain.log(
          `Payment reconciliation requires attention for checkout ${c.id}.`,
        );
      }
    }
  } finally {
    reconciling = false;
  }
}
