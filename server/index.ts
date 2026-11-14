import { Database } from "./db";
import { Domain } from "./domain";
import { createApp } from "./app";
import { processJobs, reconcilePayments } from "./integrations";
import { emailConfiguration } from "./email";

async function main() {
  const production = process.env.NODE_ENV === "production";
  if (production && process.env.DEV_DEMO === "1")
    throw new Error("DEV_DEMO must be disabled in production.");
  if (
    production &&
    (!process.env.APP_ORIGIN?.startsWith("https://") || !emailConfiguration())
  )
    throw new Error(
      "Production requires HTTPS APP_ORIGIN and a configured SMTP or email transport.",
    );
  const db = new Database();
  await db.initialize();
  const domain = new Domain(db, process.env.DEV_DEMO === "1");
  await domain.seed();
  await domain.cleanup();
  const server = createApp(domain, {
    production,
    origin: process.env.APP_ORIGIN ?? "http://localhost:8080",
  }).listen(
    Number(process.env.PORT ?? 4000),
    process.env.HOST ?? "127.0.0.1",
    () =>
      console.log(
        `Cafe API listening on port ${process.env.PORT ?? 4000} using MySQL${domain.demo ? " (explicit development demo)" : ""}`,
      ),
  );
  const background = (work: () => Promise<unknown>) =>
    void work().catch(() => {
      console.error(
        "Background task failed; check database and service connectivity.",
      );
    });
  const worker = setInterval(() => background(() => processJobs(domain)), 5000);
  const payments = setInterval(
    () => background(() => reconcilePayments(domain)),
    60000,
  );
  const cleaner = setInterval(
    () => background(() => domain.cleanup()),
    3600000,
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      clearInterval(worker);
      clearInterval(payments);
      clearInterval(cleaner);
      server.close(() => {
        void db.close().finally(() => process.exit(0));
      });
    });
}
void main().catch((error: unknown) => {
  const safe =
    error instanceof Error &&
    /^(MYSQL_|Invalid |Production|DEV_DEMO|EMAIL_TRANSPORT|SMTP_PORT)/.test(
      error.message,
    )
      ? error.message
      : "Could not start Cafe. Check MySQL access and server configuration.";
  console.error(safe);
  process.exitCode = 1;
});
