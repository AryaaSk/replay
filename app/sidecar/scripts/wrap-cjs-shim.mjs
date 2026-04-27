// esbuild produces an ESM bundle, but native modules (better-sqlite3, sharp)
// rely on `require` for binding loading. We wrap the bundle with a tiny shim
// that exposes `require` via createRequire before the bundle runs.
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, "..", "dist");
const inputFile = join(distDir, "index.mjs");
const outputFile = join(distDir, "index.js");

const shim = `import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = require("node:path").dirname(__filename);
globalThis.require = require;
globalThis.__filename = __filename;
globalThis.__dirname = __dirname;
`;

let body = await fs.readFile(inputFile, "utf8");
// Strip a leading shebang (esbuild preserves the one from src/index.ts).
// Once the shim is prepended the shebang lands mid-file and breaks ESM parsing
// with "Invalid or unexpected token". Node ignores shebangs only on the very
// first line of a file, and our wrapper bash script invokes node explicitly,
// so we don't need it.
if (body.startsWith("#!")) {
  const nl = body.indexOf("\n");
  body = nl === -1 ? "" : body.slice(nl + 1);
}
await fs.writeFile(outputFile, shim + body);
await fs.chmod(outputFile, 0o755);
await fs.unlink(inputFile);
console.log("wrapped sidecar bundle:", outputFile);
