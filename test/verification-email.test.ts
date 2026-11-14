import { test } from "node:test";
import assert from "node:assert/strict";
import { verificationEmail } from "../server/verification-email";
import { Domain, type Job } from "../server/domain";
import { Database } from "./support/database";

test("verification email uses the requested subject, readable code and plain-text fallback", async () => {
  const email = verificationEmail("012345");
  assert.equal(email.subject, "Verify your email address");
  assert.ok(email.html.includes(">012345</p>"));
  assert.match(email.message, /012345/);
  assert.match(email.html, /3 minutes/);
  assert.match(email.message, /3 minutes/);
  assert.throws(() => verificationEmail("<script>"));
  const db = new Database();
  try {
    const d = new Domain(db, true);
    const result = await d.requestCode("verification@example.com");
    const job = (await db.list<Job>("jobs"))[0];
    assert.equal(job.subject, email.subject);
    assert.ok(job.html?.includes(result.developmentCode!));
    assert.ok(job.message.includes(result.developmentCode!));
  } finally {
    await db.close();
  }
});
