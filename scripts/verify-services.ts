import { Database } from "../server/db";
import { verifyEmailTransport } from "../server/email";
async function main() {
  const db = new Database();
  try {
    await db.list("settings");
    console.log("MySQL connection and application schema verified.");
  } finally {
    await db.close();
  }
  await verifyEmailTransport();
  console.log("SMTP authenticated over TLS. No email sent.");
}
void main().catch(() => {
  console.error(
    "Service verification failed. Check database access and SMTP configuration.",
  );
  process.exitCode = 1;
});
