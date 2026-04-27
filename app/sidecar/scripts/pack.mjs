// Packages the sidecar into a single executable file Tauri can spawn as
// `replay-cli`. We use Node 22's experimental SEA (Single Executable App) to
// embed the bundle into a copy of the node binary.
//
// Output: app/src-tauri/binaries/replay-cli-<arch>-apple-darwin
//
// For dev / local runs you can also just point Tauri at `node dist/index.js`.

import { promises as fs } from "node:fs";
import { execSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sidecarDir = resolve(__dirname, "..");
const distEntry = join(sidecarDir, "dist", "index.js");
const binDir = resolve(sidecarDir, "..", "src-tauri", "binaries");
await fs.mkdir(binDir, { recursive: true });

const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
const triple = `${arch}-apple-darwin`;
const targetName = `replay-cli-${triple}`;
const targetPath = join(binDir, targetName);

// Simplest approach for v0: copy the bundle and the local node_modules into a
// directory next to the app, then ship a thin shell wrapper that runs them.
// SEA + native modules is finicky; a node-runtime sidecar is more reliable.
const wrapperPath = join(binDir, "replay-cli");
const wrapperContent = `#!/usr/bin/env bash
DIR="$( cd "$( dirname "\${BASH_SOURCE[0]}" )" && pwd )"
exec /usr/bin/env node "$DIR/replay-cli-runtime/index.js" "$@"
`;
await fs.writeFile(wrapperPath, wrapperContent);
await fs.chmod(wrapperPath, 0o755);

const runtimeDir = join(binDir, "replay-cli-runtime");
await fs.rm(runtimeDir, { recursive: true, force: true });
await fs.mkdir(runtimeDir, { recursive: true });
await fs.copyFile(distEntry, join(runtimeDir, "index.js"));

// Copy native deps' node_modules (better-sqlite3, sharp) — they bundle .node
// files that can't be bundled by esbuild.
const sourceModules = join(sidecarDir, "node_modules");
const targetModules = join(runtimeDir, "node_modules");
try {
  execSync(`cp -R "${sourceModules}" "${targetModules}"`, { stdio: "inherit" });
} catch (e) {
  console.warn("warn: failed to copy node_modules; sidecar may not work in production:", String(e));
}

// Tauri's externalBin expects per-arch suffixed names too.
await fs.copyFile(wrapperPath, targetPath);
await fs.chmod(targetPath, 0o755);

console.log("packed sidecar:");
console.log(" wrapper:    ", wrapperPath);
console.log(" arch alias: ", targetPath);
console.log(" runtime:    ", runtimeDir);
