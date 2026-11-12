import { Database } from "./db";
import { Domain } from "./domain";
import { createApp } from "./app";
import { processJobs, reconcilePayments } from "./integrations";
const production = process.env.NODE_ENV === "production";
if (production && process.env.DEV_DEMO === "1")
  throw new Error("DEV_DEMO must be disabled in production.");
if (
  production &&
  (!process.env.APP_ORIGIN?.startsWith("https://") ||
    !process.env.RESEND_API_KEY ||
    !process.env.EMAIL_FROM)
)
  throw new Error(
    "Production requires HTTPS APP_ORIGIN, RESEND_API_KEY, and EMAIL_FROM.",
  );
const db = new Database(process.env.DATABASE_PATH ?? "data/cafe.sqlite");
const domain = new Domain(db, process.env.DEV_DEMO === "1");
domain.seed();
domain.cleanup();
const server = createApp(domain, {
  production,
  origin: process.env.APP_ORIGIN ?? "http://localhost:8080",
}).listen(
  Number(process.env.PORT ?? 4000),
  process.env.HOST ?? "127.0.0.1",
  () =>
    console.log(
      `Cafe API listening on port ${process.env.PORT ?? 4000}${domain.demo ? " (explicit development demo)" : ""}`,
    ),
);
const worker = setInterval(() => void processJobs(domain), 5000);
const payments = setInterval(() => void reconcilePayments(domain), 60000);
const cleaner = setInterval(() => domain.cleanup(), 3600000);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => {
    clearInterval(worker);
    clearInterval(cleaner);
    clearInterval(payments);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
