import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export async function publishWebsite(result) {
  const run = (args) =>
    JSON.parse(
      execFileSync(
        "aws",
        [...args, "--region", result.region, "--output", "json"],
        { encoding: "utf8" },
      ),
    );
  if (run(["sts", "get-caller-identity"]).Account !== "375033595717")
    throw new Error("Select the NEP account before publishing.");
  const app = ["--app-id", result.AppId, "--branch-name", "test"];
  const deadline = Date.now() + 15 * 60_000;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 8000));
  console.log("Waiting for any previous Amplify publication to finish.");
  while (
    run([
      "amplify",
      "list-jobs",
      ...app,
      "--max-results",
      "10",
    ]).jobSummaries.some((job) =>
      ["PENDING", "PROVISIONING", "RUNNING", "CANCELLING"].includes(job.status),
    )
  ) {
    if (Date.now() > deadline)
      throw new Error(
        "A previous Amplify deployment is still active. Retry publication after it finishes.",
      );
    await pause();
  }
  const upload = run(["amplify", "create-deployment", ...app]);
  const response = await fetch(upload.zipUploadUrl, {
    method: "PUT",
    body: await readFile("build/website.zip"),
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok)
    throw new Error(`Amplify upload failed (${response.status}).`);
  const started = run([
    "amplify",
    "start-deployment",
    ...app,
    "--job-id",
    upload.jobId,
  ]);
  const jobId = started.jobSummary.jobId;
  await writeFile(
    ".aws-deployment.json",
    JSON.stringify({ ...result, jobId }, null, 2) + "\n",
  );
  console.log(`Publishing ${result.Website} (job ${jobId}).`);
  while (true) {
    const status = run(["amplify", "get-job", ...app, "--job-id", jobId]).job
      .summary.status;
    if (status === "SUCCEED") {
      console.log(`Amplify publication SUCCEED: ${result.Website}`);
      return;
    }
    if (["FAILED", "CANCELLED"].includes(status))
      throw new Error(`Amplify publication ${status}; inspect job ${jobId}.`);
    if (Date.now() > deadline)
      throw new Error(
        `Amplify job ${jobId} is still running. Check its status before publishing again.`,
      );
    await pause();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await publishWebsite(
    JSON.parse(await readFile(".aws-deployment.json", "utf8")),
  );
