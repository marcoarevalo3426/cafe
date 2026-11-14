import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await rm("build/aws", { recursive: true, force: true });
await mkdir("build/aws", { recursive: true });
await build({
  entryPoints: ["server/lambda.ts"],
  outfile: "build/aws/index.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  minify: true,
  sourcemap: false,
  logLevel: "info",
});
execFileSync("zip", ["-q", "../lambda.zip", "index.cjs"], { cwd: "build/aws" });
