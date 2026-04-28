// Generates the two menubar tray icons for Replay using sharp (already
// installed in the sidecar's node_modules — we re-resolve it from there to
// avoid duplicating the dep at the app root).
//
// Produces:
//   src-tauri/icons/tray-idle.png       — 22x22 hollow ring (template-mode safe)
//   src-tauri/icons/tray-capturing.png  — 22x22 solid red dot
//
// Run once after npm install:  node scripts/gen-tray-icons.mjs

import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(__dirname, "..");
const sidecarRequire = createRequire(join(appRoot, "sidecar", "package.json"));
const sharp = sidecarRequire("sharp");

const SIZE = 22;
const STROKE = 2;        // ring thickness in px
const RADIUS = SIZE / 2 - 1;

function makeRing(strokeRgb) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const cx = SIZE / 2 - 0.5;
  const cy = SIZE / 2 - 0.5;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const i = (y * SIZE + x) * 4;
      const onRing = d <= RADIUS && d >= RADIUS - STROKE;
      // Anti-alias the edge by 1px softness
      const edgeAlpha = onRing ? 1 - Math.max(0, Math.max(d - RADIUS, RADIUS - STROKE - d)) : 0;
      const a = Math.max(0, Math.min(1, edgeAlpha));
      buf[i + 0] = strokeRgb[0];
      buf[i + 1] = strokeRgb[1];
      buf[i + 2] = strokeRgb[2];
      buf[i + 3] = Math.round(a * 255);
    }
  }
  return buf;
}

function makeFilledCircle(fillRgb) {
  const buf = Buffer.alloc(SIZE * SIZE * 4);
  const cx = SIZE / 2 - 0.5;
  const cy = SIZE / 2 - 0.5;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      const i = (y * SIZE + x) * 4;
      const inside = d <= RADIUS;
      const edge = d > RADIUS && d < RADIUS + 1; // 1px AA softness
      const a = inside ? 1 : edge ? 1 - (d - RADIUS) : 0;
      buf[i + 0] = fillRgb[0];
      buf[i + 1] = fillRgb[1];
      buf[i + 2] = fillRgb[2];
      buf[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
    }
  }
  return buf;
}

const iconsDir = join(appRoot, "src-tauri", "icons");
await fs.mkdir(iconsDir, { recursive: true });

// Idle: black ring. macOS template-mode will recolor for dark/light menu bars.
const idleBytes = makeRing([0, 0, 0]);
await sharp(idleBytes, { raw: { width: SIZE, height: SIZE, channels: 4 } })
  .png()
  .toFile(join(iconsDir, "tray-idle.png"));

// Capturing: solid red filled dot. NOT template (we want the colour to stay red).
const capturingBytes = makeFilledCircle([220, 38, 38]);
await sharp(capturingBytes, { raw: { width: SIZE, height: SIZE, channels: 4 } })
  .png()
  .toFile(join(iconsDir, "tray-capturing.png"));

// App icons: produce a 1024×1024 source.png with the ember-disk placeholder.
// `npm run icons:app` then runs `tauri icon` against it to generate every
// variant macOS needs (32x32.png, 128x128.png, 128x128@2x.png, AND the
// .icns container) — that's the file `tauri build` requires.
const SRC_SIZE = 1024;
const srcBuf = Buffer.alloc(SRC_SIZE * SRC_SIZE * 4);
const cx2 = SRC_SIZE / 2 - 0.5;
const cy2 = SRC_SIZE / 2 - 0.5;
const r2 = SRC_SIZE / 2 - 32;   // leave a small margin so icon doesn't clip
for (let y = 0; y < SRC_SIZE; y++) {
  for (let x = 0; x < SRC_SIZE; x++) {
    const dx = x - cx2;
    const dy = y - cy2;
    const d = Math.sqrt(dx * dx + dy * dy);
    const i = (y * SRC_SIZE + x) * 4;
    const inside = d <= r2;
    const edge = d > r2 && d < r2 + 1.5;
    const a = inside ? 1 : edge ? 1 - (d - r2) / 1.5 : 0;
    // Flat ember disk (#E84E1B) on transparent background — matches the
    // record button's solid colour. Production icon should replace.
    srcBuf[i + 0] = 232;
    srcBuf[i + 1] = 78;
    srcBuf[i + 2] = 27;
    srcBuf[i + 3] = Math.round(Math.max(0, Math.min(1, a)) * 255);
  }
}
await sharp(srcBuf, { raw: { width: SRC_SIZE, height: SRC_SIZE, channels: 4 } })
  .png()
  .toFile(join(iconsDir, "source.png"));

console.log("wrote tray icons + source.png to", iconsDir);
console.log("now run: npm run icons:app   (generates the .icns from source.png)");
