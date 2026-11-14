import { test } from "node:test";
import assert from "node:assert/strict";
import { readApiResponse } from "../src/api-response";

test("HTML server and proxy errors produce a readable error instead of leaking JSON parsing failures", async () => {
  for (const status of [200, 404, 502]) {
    const response = new Response(
      "<!DOCTYPE html><html><body>Cannot POST /api/vouchers/verify</body></html>",
      {
        status,
        headers: { "Content-Type": "text/html" },
      },
    );
    await assert.rejects(readApiResponse(response), {
      name: "Error",
      message:
        "The app received an unexpected response. Refresh the page and try again.",
    });
  }
});

test("API responses preserve verified voucher data and validation messages", async () => {
  const voucher = { code: "test25", balance: 2500 };
  assert.deepEqual(await readApiResponse(Response.json(voucher)), voucher);
  await assert.rejects(
    readApiResponse(
      Response.json({ error: "Invalid voucher." }, { status: 400 }),
    ),
    /Invalid voucher\./,
  );
  await assert.rejects(
    readApiResponse(new Response("{", { status: 503 })),
    /unexpected response/,
  );
});
