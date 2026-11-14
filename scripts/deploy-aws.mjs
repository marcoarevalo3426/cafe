import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

const account = "375033595717";
const region = process.env.AWS_REGION ?? "ap-southeast-2";
const stack = "cafe-test";
const parameter = "/cafe-test/config";
const run = (args, options = {}) =>
  execFileSync("aws", [...args, "--region", region, "--output", "json"], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
const json = (args) => JSON.parse(run(args));
const deploy = (name, file, params = []) =>
  run(
    [
      "cloudformation",
      "deploy",
      "--stack-name",
      name,
      "--template-file",
      file,
      "--capabilities",
      "CAPABILITY_IAM",
      "--no-fail-on-empty-changeset",
      "--tags",
      "Project=cafe-test",
      ...(params.length ? ["--parameter-overrides", ...params] : []),
    ],
    { stdio: "inherit" },
  );
const outputs = (name) =>
  Object.fromEntries(
    json([
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      name,
    ]).Stacks[0].Outputs.map((x) => [x.OutputKey, x.OutputValue]),
  );

if (json(["sts", "get-caller-identity"]).Account !== account)
  throw new Error(`Refusing deployment outside NEP account ${account}.`);
const env = {};
for (const line of (await readFile(".env.hosting", "utf8")).split(/\r?\n/)) {
  const match = line.match(/^([A-Z_0-9]+)=(.*)$/);
  if (match) env[match[1]] = match[2];
}
const config = Object.fromEntries(
  [
    "SMTP_HOST",
    "SMTP_PORT",
    "SMTP_USER",
    "SMTP_PASSWORD",
    "SMTP_FORCE_IPV4",
    "EMAIL_TRANSPORT",
    "EMAIL_FROM",
  ].map((key) => [key, env[key]]),
);
if (!config.SMTP_PASSWORD || !config.SMTP_USER)
  throw new Error(
    "SMTP configuration is required in the ignored .env.hosting file.",
  );
// A private, ignored temporary file keeps credentials out of process arguments and logs.
await mkdir("build", { recursive: true });
const secretFile = "build/.aws-secret-input.json";
try {
  await writeFile(
    secretFile,
    JSON.stringify({
      Name: parameter,
      Type: "SecureString",
      Value: JSON.stringify(config),
      Overwrite: true,
      Tier: "Standard",
      Description: "Cafe test SMTP configuration",
    }),
    { mode: 0o600 },
  );
  run(["ssm", "put-parameter", "--cli-input-json", `file://${secretFile}`]);
} finally {
  await rm(secretFile, { force: true });
}
console.log(
  "Secure SMTP configuration saved; deploying private artifact storage.",
);
deploy(`${stack}-artifacts`, "infra/artifacts.json");
const bucket = outputs(`${stack}-artifacts`).Bucket;
const code = await readFile("build/lambda.zip");
const key = `lambda/${createHash("sha256").update(code).digest("hex")}.zip`;
run([
  "s3api",
  "put-object",
  "--bucket",
  bucket,
  "--key",
  key,
  "--body",
  "build/lambda.zip",
  "--server-side-encryption",
  "AES256",
]);
console.log(
  "Deploying Amplify website, Lambda API and DynamoDB test database.",
);
deploy(stack, "infra/aws-test.json", [
  `ArtifactBucket=${bucket}`,
  `ArtifactKey=${key}`,
  `ConfigurationParameter=${parameter}`,
  `TestEmailSignIn=${process.env.TEST_EMAIL_SIGN_IN ?? env.TEST_EMAIL_SIGN_IN ?? "disabled"}`,
]);
const result = {
  account,
  region,
  stack,
  artifactStack: `${stack}-artifacts`,
  bucket,
  parameter,
  ...outputs(stack),
};
await writeFile(".aws-deployment.json", JSON.stringify(result, null, 2) + "\n");
execFileSync("npm", ["run", "build"], {
  stdio: "inherit",
  env: { ...process.env, APP_BASE_PATH: "" },
});
await mkdir("build", { recursive: true });
await rm("build/website.zip", { force: true });
execFileSync("zip", ["-q", "-r", "../build/website.zip", "."], { cwd: "dist" });
const { publishWebsite } = await import("./publish-aws.mjs");
await publishWebsite(result);
