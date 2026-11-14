import { mkdir, cp, readFile, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const base = (process.env.APP_BASE_PATH ?? "/cafe").replace(/\/+$/, "");
if (!/^\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(base))
  throw new Error("Invalid APP_BASE_PATH.");
for (const script of ["build", "build:server"]) {
  const run = spawnSync("npm", ["run", script], {
    stdio: "inherit",
    env: { ...process.env, APP_BASE_PATH: base },
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
}
const output = path.resolve("hosting");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp("dist", path.join(output, "dist"), { recursive: true });
await cp("public", path.join(output, "public"), { recursive: true });
await cp("build/server.cjs", path.join(output, "server.cjs"));
await writeFile(
  path.join(output, "app.cjs"),
  `const fs=require('node:fs');process.chdir(__dirname);if(fs.existsSync('.env'))process.loadEnvFile('.env');require('./server.cjs');\n`,
);
const dependencies = Object.fromEntries(
  await Promise.all(
    [
      "express",
      "express-rate-limit",
      "helmet",
      "mysql2",
      "nodemailer",
      "stripe",
    ].map(async (name) => [
      name,
      JSON.parse(
        await readFile(
          path.resolve("node_modules", name, "package.json"),
          "utf8",
        ),
      ).version,
    ]),
  ),
);
await writeFile(
  path.join(output, "package.json"),
  JSON.stringify(
    {
      name: "cafe-hosting",
      version: "0.2.0",
      private: true,
      engines: { node: ">=22" },
      scripts: { start: "node app.cjs" },
      dependencies,
    },
    null,
    2,
  ) + "\n",
);
await cp(".env.example", path.join(output, ".env.example"));
await writeFile(
  path.join(output, ".htaccess"),
  `Options -Indexes\n<FilesMatch "^(\\.env.*|package.*\\.json|.*\\.cjs|.*\\.log)$">\nRequire all denied\n</FilesMatch>\n`,
);
await writeFile(
  path.join(output, "HOSTING.md"),
  `# Cafe Node.js hosting\n\nThis folder requires a managed Node.js 22+ runtime and MySQL. FTP upload alone cannot run the backend.\n\n1. Set this folder as the Node.js application root in the hosting panel.\n2. Set the application URL to the domain path ${base}.\n3. Choose app.cjs as startup file and run npm install --omit=dev in the hosting panel.\n4. Configure server environment variables (or a protected .env): NODE_ENV=production, DEV_DEMO=0, APP_BASE_PATH=${base}, APP_ORIGIN=https://YOUR_DOMAIN, MYSQL_HOST/PORT/DATABASE/USER/PASSWORD, EMAIL_TRANSPORT=smtp, SMTP_HOST/PORT/USER/PASSWORD, EMAIL_FROM.\n5. Restart the Node.js app. Tables are initialized without deleting existing data. Keep one app process running for the email and push worker.\n6. Verify ${base}/health and ${base}/api/bootstrap return JSON and that ${base}/.env, ${base}/server.cjs and ${base}/package.json return 403 or 404.\n\nNo credentials or user data are included in this package. Test mode remains local-only.\n`,
);
const lock = spawnSync(
  "npm",
  [
    "install",
    "--package-lock-only",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--offline",
  ],
  { cwd: output, stdio: "inherit" },
);
if (lock.status !== 0)
  throw new Error("Could not produce the hosting dependency lockfile.");
console.log(`Prepared ${output} for ${base}. No credentials included.`);
