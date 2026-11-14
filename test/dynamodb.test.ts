import { test } from "node:test";
import assert from "node:assert/strict";
import { DynamoTestDatabase } from "./support/dynamodb-database";
test(
  "DynamoDB commits large collections across chunks and rolls back failed batches",
  { skip: process.env.DYNAMODB_INTEGRATION !== "1" },
  async () => {
    const db = new DynamoTestDatabase();
    await db.atomic(async () => {
      for (let i = 0; i < 1000; i++)
        await db.put("bulk", { id: String(i), value: "☕".repeat(250) });
    });
    const rows = await db.list<any>("bulk");
    assert.equal(rows.length, 1000);
    assert.equal(rows[999].value, "☕".repeat(250));
    await assert.rejects(
      db.atomic(async () => {
        await db.delete("bulk", "0");
        await db.put("bulk", { id: "new" });
        throw new Error("rollback");
      }),
    );
    assert.ok(await db.get("bulk", "0"));
    assert.equal(await db.get("bulk", "new"), undefined);
  },
);
