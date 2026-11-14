import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    ...readdirSync("test")
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => `test/${f}`),
  ],
  { stdio: "inherit", env: { ...process.env, MYSQL_INTEGRATION: "1" } },
);
process.exit(result.status ?? 1);
