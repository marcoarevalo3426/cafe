import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { Database } from "../server/db";
import { DynamoDatabase } from "../server/dynamodb";
import {
  businessKinds,
  prepareBusinessData,
  type BusinessData,
} from "./test-business-data";

async function main() {
  const mode = process.argv[2];
  assert(
    ["--plan", "--backup", "--replace"].includes(mode),
    "Choose --plan, --backup or --replace explicitly.",
  );
  const deployment = JSON.parse(await readFile(".aws-deployment.json", "utf8"));
  assert.equal(deployment.account, "375033595717");
  assert.equal(deployment.Table, "nep-cafe-test-data");
  assert.equal(deployment.AppId, "d2kzvdmp17kwpy");
  const aws = (...args: string[]) =>
    execFileSync(
      "aws",
      [...args, "--region", deployment.region, "--output", "json"],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
    );
  const json = (...args: string[]) => JSON.parse(aws(...args));
  assert.equal(json("sts", "get-caller-identity").Account, deployment.account);
  process.env.AWS_REGION = deployment.region;
  const target = new DynamoDatabase(deployment.Table);
  const report: Record<string, any> = {
    account: deployment.account,
    table: deployment.Table,
    mode,
  };
  const count = (rows: BusinessData) =>
    Object.fromEntries(
      Object.entries(rows).map(([kind, records]) => [kind, records.length]),
    );
  let data: BusinessData = {};
  if (mode !== "--backup") {
    assert.equal(
      process.env.MYSQL_SOCKET,
      "/private/tmp/cafe-mysql-migration/mysql.sock",
      "Only the local preview database is accepted.",
    );
    assert(
      process.env.MYSQL_DATABASE?.startsWith("cafe_local_8080_"),
      "Use the localhost:8080 database configuration.",
    );
    const local = new Database();
    try {
      data = await local.atomic(async () => {
        const rows: BusinessData = {};
        for (const kind of businessKinds) rows[kind] = await local.list(kind);
        return prepareBusinessData(rows);
      });
    } finally {
      await local.close();
    }
    report.localRecords = count(data);
  }
  if (mode === "--plan") {
    report.awsRecords = await target.atomic(async () => {
      const counts: Record<string, number> = {};
      for (const kind of businessKinds)
        counts[kind] = (await target.list(kind)).length;
      return counts;
    });
    console.log(JSON.stringify(report));
    return;
  }
  await mkdir("build", { recursive: true });
  const previous: { name: string; concurrency?: number }[] = [];
  try {
    if (mode === "--replace") {
      const names = [`${deployment.stack}-api`, deployment.Worker];
      let timeout = 0;
      for (const name of names) {
        const limit = json(
          "lambda",
          "get-function-concurrency",
          "--function-name",
          name,
        ).ReservedConcurrentExecutions;
        timeout = Math.max(
          timeout,
          json("lambda", "get-function-configuration", "--function-name", name)
            .Timeout,
        );
        aws(
          "lambda",
          "put-function-concurrency",
          "--function-name",
          name,
          "--reserved-concurrent-executions",
          "0",
        );
        previous.push({ name, concurrency: limit });
      }
      console.log(
        "Test API and worker paused; waiting for in-flight requests to finish.",
      );
      await new Promise((resolve) => setTimeout(resolve, (timeout + 1) * 1000));
      assert(
        !(await target.list<any>("checkouts")).some(
          (c) => c.status === "pending" && c.stripeId,
        ),
        "Resolve online provider payments before replacing test data.",
      );
    }
    // The revision fence makes the backup consistent even in --backup mode.
    const revision = () =>
      json(
        "dynamodb",
        "get-item",
        "--table-name",
        deployment.Table,
        "--key",
        JSON.stringify({ pk: { S: "cafe" }, sk: { S: "meta" } }),
        "--consistent-read",
      ).Item?.revision?.S ?? "";
    let snapshot: any;
    for (let attempt = 0; attempt < 12; attempt++) {
      const before = revision();
      const scanned = json(
        "dynamodb",
        "scan",
        "--table-name",
        deployment.Table,
        "--consistent-read",
      );
      if (before === revision()) {
        snapshot = scanned;
        break;
      }
    }
    assert(
      snapshot,
      "Could not take a consistent backup; no business data was changed.",
    );
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFile = `build/aws-data-backup-${stamp}.json`;
    await writeFile(
      backupFile,
      JSON.stringify({
        table: deployment.Table,
        region: deployment.region,
        snapshot,
      }),
      { mode: 0o600, flag: "wx" },
    );
    const backupKey = `database-backups/${stamp}.json`;
    aws(
      "s3api",
      "put-object",
      "--bucket",
      deployment.bucket,
      "--key",
      backupKey,
      "--body",
      backupFile,
      "--server-side-encryption",
      "AES256",
    );
    report.backup = `s3://${deployment.bucket}/${backupKey}`;
    console.log("Encrypted private AWS database backup saved.");
    if (mode === "--replace") {
      const kinds = new Set<string>(
        snapshot.Items.filter(
          (item: any) =>
            item.pk?.S === "cafe" && item.sk?.S?.startsWith("data#"),
        ).map((item: any) => item.sk.S.split("#")[1]),
      );
      const original = await target.atomic(async () => {
        const rows: BusinessData = {};
        for (const kind of kinds) rows[kind] = await target.list(kind);
        return rows;
      });
      const replace = (rows: BusinessData) =>
        target.atomic(async () => {
          for (const kind of new Set([...kinds, ...Object.keys(data)]))
            for (const row of await target.list<{ id: string }>(kind))
              await target.delete(kind, row.id);
          for (const [kind, values] of Object.entries(rows))
            for (const row of values) await target.put(kind, row);
        });
      await replace(data);
      try {
        // Verify every imported value, including voucher balances and ownership.
        await target.atomic(async () => {
          for (const [kind, rows] of Object.entries(data))
            assert.deepEqual(
              await target.list(kind),
              rows,
              `${kind} did not match the local snapshot.`,
            );
          for (const kind of kinds)
            if (!(kind in data))
              assert.equal(
                (await target.list(kind)).length,
                0,
                `${kind} retained stale records.`,
              );
        });
      } catch (error) {
        await replace(original);
        console.error(
          "Verification failed; original AWS records were restored.",
        );
        throw error;
      }
      report.verified = true;
      console.log(
        "AWS test business data replaced and verified against the local snapshot.",
      );
    }
    await writeFile(
      `.aws-data-${mode === "--replace" ? "replacement" : "backup"}.json`,
      JSON.stringify(report, null, 2) + "\n",
      { mode: 0o600 },
    );
    console.log(JSON.stringify(report));
  } finally {
    const restorationFailures: string[] = [];
    for (const { name, concurrency } of previous.reverse()) {
      try {
        if (concurrency === undefined)
          aws("lambda", "delete-function-concurrency", "--function-name", name);
        else
          aws(
            "lambda",
            "put-function-concurrency",
            "--function-name",
            name,
            "--reserved-concurrent-executions",
            String(concurrency),
          );
      } catch {
        restorationFailures.push(name);
      }
    }
    await target.close();
    assert.equal(
      restorationFailures.length,
      0,
      `Restore concurrency for: ${restorationFailures.join(", ")}`,
    );
  }
}
void main().catch((error) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : "AWS test data operation failed. Check the private backup/report and service connectivity.",
  );
  process.exitCode = 1;
});
