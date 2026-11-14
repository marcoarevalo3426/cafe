import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  DynamoDBClient,
  ScanCommand,
  BatchWriteItemCommand,
} from "@aws-sdk/client-dynamodb";

const deployment = JSON.parse(await readFile(".aws-deployment.json", "utf8"));
const target = "nep-cafe-test-data";
const source = deployment.Table;
const run = (...args) =>
  JSON.parse(
    execFileSync(
      "aws",
      [...args, "--region", deployment.region, "--output", "json"],
      { encoding: "utf8" },
    ) || "{}",
  );
if (
  run("sts", "get-caller-identity").Account !== "375033595717" ||
  deployment.stack !== "cafe-test" ||
  !/^cafe-test-Data-/.test(source)
)
  throw new Error("Unexpected migration account or source table.");
const client = new DynamoDBClient({ region: deployment.region });
const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
async function scan(table) {
  const items = [];
  let cursor;
  do {
    const response = await client.send(
      new ScanCommand({
        TableName: table,
        ConsistentRead: true,
        ExclusiveStartKey: cursor,
      }),
    );
    items.push(...(response.Items ?? []));
    cursor = response.LastEvaluatedKey;
  } while (cursor);
  return items;
}
const normalize = (value) =>
  value instanceof Uint8Array
    ? Buffer.from(value).toString("base64")
    : Array.isArray(value)
      ? value.map(normalize)
      : value && typeof value === "object"
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, normalize(value[key])]),
          )
        : value;
const fingerprint = (items) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        items
          .map(normalize)
          .sort((a, b) =>
            JSON.stringify([a.pk, a.sk]).localeCompare(
              JSON.stringify([b.pk, b.sk]),
            ),
          ),
      ),
    )
    .digest("hex");
async function updated(name) {
  const until = Date.now() + 120000;
  while (true) {
    const status = run(
      "lambda",
      "get-function-configuration",
      "--function-name",
      name,
    ).LastUpdateStatus;
    if (status === "Successful") return;
    if (status === "Failed" || Date.now() > until)
      throw new Error("Lambda configuration update failed.");
    await pause(1000);
  }
}
const names = ["cafe-test-api", "cafe-test-worker"];
const previous = names.map((name) => ({
  name,
  configuration: run(
    "lambda",
    "get-function-configuration",
    "--function-name",
    name,
  ),
  concurrency: run(
    "lambda",
    "get-function-concurrency",
    "--function-name",
    name,
  ).ReservedConcurrentExecutions,
}));
if (
  previous.some(
    (fn) => fn.configuration.Environment.Variables.DYNAMODB_TABLE !== source,
  )
)
  throw new Error("Both functions must point to the source before migration.");
if ((await scan(target)).length)
  throw new Error("Replacement table must be empty.");
const rule = run(
  "cloudformation",
  "describe-stack-resource",
  "--stack-name",
  deployment.stack,
  "--logical-resource-id",
  "WorkerSchedule",
).StackResourceDetail.PhysicalResourceId;
const ruleState = run("events", "describe-rule", "--name", rule).State;
let switched = false;
let environmentChanged = false;
try {
  run("events", "disable-rule", "--name", rule);
  for (const fn of previous)
    run(
      "lambda",
      "put-function-concurrency",
      "--function-name",
      fn.name,
      "--reserved-concurrent-executions",
      "0",
    );
  console.log(
    "Test API paused; waiting for existing requests to finish before copying data.",
  );
  await pause(55000);
  const rows = await scan(source);
  for (let offset = 0; offset < rows.length; offset += 25) {
    let requests = rows
      .slice(offset, offset + 25)
      .map((Item) => ({ PutRequest: { Item } }));
    for (let attempt = 0; requests.length; attempt++) {
      if (attempt > 12) throw new Error("Migration writes remained throttled.");
      const result = await client.send(
        new BatchWriteItemCommand({ RequestItems: { [target]: requests } }),
      );
      requests = result.UnprocessedItems?.[target] ?? [];
      if (requests.length) await pause(Math.min(5000, 100 * 2 ** attempt));
    }
  }
  const hash = fingerprint(rows);
  if (
    hash !== fingerprint(await scan(target)) ||
    hash !== fingerprint(await scan(source))
  )
    throw new Error("Migration verification failed; source remains active.");
  console.log(
    `Verified ${rows.length} stored items byte-for-byte; switching the runtime database.`,
  );
  environmentChanged = true;
  for (const fn of previous) {
    run(
      "lambda",
      "update-function-configuration",
      "--function-name",
      fn.name,
      "--environment",
      JSON.stringify({
        Variables: {
          ...fn.configuration.Environment.Variables,
          DYNAMODB_TABLE: target,
        },
      }),
    );
    await updated(fn.name);
  }
  switched = true;
  await writeFile(
    ".aws-deployment.json",
    JSON.stringify(
      { ...deployment, Table: target, LegacyTable: source },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `Migration complete: ${target}. Original table retained for rollback.`,
  );
} finally {
  if (!switched && environmentChanged)
    for (const fn of previous) {
      run(
        "lambda",
        "update-function-configuration",
        "--function-name",
        fn.name,
        "--environment",
        JSON.stringify(fn.configuration.Environment),
      );
      await updated(fn.name);
    }
  for (const fn of previous) {
    if (fn.concurrency === undefined)
      run("lambda", "delete-function-concurrency", "--function-name", fn.name);
    else
      run(
        "lambda",
        "put-function-concurrency",
        "--function-name",
        fn.name,
        "--reserved-concurrent-executions",
        String(fn.concurrency),
      );
  }
  if (ruleState === "ENABLED") run("events", "enable-rule", "--name", rule);
  console.log("Original concurrency limits and worker schedule restored.");
}
