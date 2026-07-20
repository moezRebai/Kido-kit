// Build script: bundles the CLI entry point into a single distributable file,
// and separately transpiles (unbundled) everything under src/ and test/ so
// `node --test` can run the test suite with plain module resolution.
import * as esbuild from "esbuild";
import { readdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const watch = process.argv.includes("--watch");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));

function listTsFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true })
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(dir, f));
}

rmSync("dist", { recursive: true, force: true });

const bundleOpts = {
  entryPoints: ["src/cli.ts"],
  outfile: "dist/cli.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  banner: { js: "#!/usr/bin/env node" },
  // Baked in at build time so `kido --version` never needs to locate/read
  // package.json at runtime (unreliable across global-install layouts).
  define: { __KIDO_VERSION__: JSON.stringify(pkg.version) },
};

const unbundledOpts = {
  entryPoints: [...listTsFiles("src"), ...listTsFiles("test")],
  outdir: "dist",
  outbase: ".",
  bundle: false,
  platform: "node",
  format: "esm",
  target: "node20",
  define: { __KIDO_VERSION__: JSON.stringify(pkg.version) },
};

if (watch) {
  const [bundleCtx, unbundledCtx] = await Promise.all([
    esbuild.context(bundleOpts),
    esbuild.context(unbundledOpts),
  ]);
  await Promise.all([bundleCtx.watch(), unbundledCtx.watch()]);
  console.log("Watching for changes...");
} else {
  await Promise.all([esbuild.build(bundleOpts), esbuild.build(unbundledOpts)]);
}
