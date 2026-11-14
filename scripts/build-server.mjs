import { build } from "esbuild";
await build({
  entryPoints: ["server/index.ts"],
  outfile: "build/server.cjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  packages: "external",
  sourcemap: false,
  logLevel: "info",
});
