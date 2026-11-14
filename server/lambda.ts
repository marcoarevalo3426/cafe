import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import type { Domain } from "./domain";

const ssm = new SSMClient({});
const lambda = new LambdaClient({});
let ready:
  Promise<{ domain: Domain; http: (...args: any[]) => any }> | undefined;
async function initialize() {
  if (process.env.CONFIG_PARAMETER) {
    const result = await ssm.send(
      new GetParameterCommand({
        Name: process.env.CONFIG_PARAMETER,
        WithDecryption: true,
      }),
    );
    const values = JSON.parse(result.Parameter?.Value ?? "{}");
    for (const key of [
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_USER",
      "SMTP_PASSWORD",
      "SMTP_FORCE_IPV4",
      "EMAIL_TRANSPORT",
      "EMAIL_FROM",
      "STRIPE_SECRET_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "EXPO_ACCESS_TOKEN",
    ])
      if (typeof values[key] === "string") process.env[key] = values[key];
  }
  if (
    process.env.DEV_DEMO === "1" ||
    !process.env.APP_ORIGIN?.startsWith("https://")
  )
    throw new Error("Invalid AWS app configuration.");
  const [
    { DynamoDatabase },
    { Domain },
    { createApp },
    { default: serverlessExpress },
  ] = await Promise.all([
    import("./dynamodb"),
    import("./domain"),
    import("./app"),
    import("@codegenie/serverless-express"),
  ]);
  const domain = new Domain(new DynamoDatabase(), false);
  await domain.db.initialize();
  const app = createApp(domain, {
    production: true,
    origin: process.env.APP_ORIGIN,
    basePath: "",
  });
  return { domain, http: serverlessExpress({ app }) };
}
export async function handler(event: any, context: any) {
  context.callbackWaitsForEmptyEventLoop = false;
  try {
    const runtime = await (ready ??= initialize().catch((error) => {
      ready = undefined;
      throw error;
    }));
    if (event.source === "cafe.verify") {
      const { verifyEmailTransport } = await import("./email");
      await verifyEmailTransport();
      return {
        ok: true,
        database: "DynamoDB",
        smtp: "authenticated; no email sent",
      };
    }
    if (event.source === "aws.events" || event.source === "cafe.outbox") {
      const { processJobs, reconcilePayments } = await import("./integrations");
      await processJobs(runtime.domain);
      await reconcilePayments(runtime.domain);
      if (new Date().getUTCMinutes() === 0) await runtime.domain.cleanup();
      return { ok: true };
    }
    const response = await runtime.http(event, context);
    if (
      process.env.WORKER_NAME &&
      event.requestContext?.http?.method === "POST" &&
      response.statusCode < 400
    ) {
      try {
        await lambda.send(
          new InvokeCommand({
            FunctionName: process.env.WORKER_NAME,
            InvocationType: "Event",
            Payload: Buffer.from(JSON.stringify({ source: "cafe.outbox" })),
          }),
        );
      } catch {
        console.error(
          "Immediate outbox dispatch unavailable; scheduled retry remains active.",
        );
      }
    }
    return response;
  } catch {
    console.error(
      "Cafe invocation failed. Check database and service configuration.",
    );
    if (["aws.events", "cafe.outbox", "cafe.verify"].includes(event.source))
      throw new Error("Cafe background service check failed.");
    return {
      statusCode: 503,
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
      },
      body: JSON.stringify({
        error: "Service temporarily unavailable. Please try again.",
      }),
    };
  }
}
