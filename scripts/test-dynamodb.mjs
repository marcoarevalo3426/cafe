import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
const region = process.env.AWS_REGION ?? "ap-southeast-2";
const table = `cafe-test-storage-${randomUUID()}`;
const aws = (...args) =>
  execFileSync("aws", [...args, "--region", region, "--output", "json"], {
    encoding: "utf8",
  });
let created = false;
try {
  aws(
    "dynamodb",
    "create-table",
    "--table-name",
    table,
    "--billing-mode",
    "PAY_PER_REQUEST",
    "--attribute-definitions",
    "AttributeName=pk,AttributeType=S",
    "AttributeName=sk,AttributeType=S",
    "--key-schema",
    "AttributeName=pk,KeyType=HASH",
    "AttributeName=sk,KeyType=RANGE",
    "--tags",
    "Key=Project,Value=cafe-storage-test",
  );
  created = true;
  aws("dynamodb", "wait", "table-exists", "--table-name", table);
  const result = spawnSync("npm", ["test"], {
    stdio: "inherit",
    env: {
      ...process.env,
      AWS_REGION: region,
      DYNAMODB_TABLE: table,
      DYNAMODB_INTEGRATION: "1",
    },
  });
  process.exitCode = result.status ?? 1;
} finally {
  if (created) {
    aws("dynamodb", "delete-table", "--table-name", table);
    console.log("Disposable DynamoDB test table deleted.");
  }
}
