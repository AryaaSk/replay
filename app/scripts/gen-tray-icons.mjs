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

// Provide larger app icons as throwaway placeholders too, so `tauri build` works
// without a manual asset step. Production icons should replace these.
const appIconBytes = makeFilledCircle([24, 24, 24]);
for (const [size, name] of [
  [32, "32x32.png"],
  [128, "128x128.png"],
  [256, "128x128@2x.png"],
]) {
  await sharp(appIconBytes, { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .resize(size, size)
    .png()
    .toFile(join(iconsDir, name));
}
// icon.icns: synthesise a minimal one from the 256px PNG via macOS `iconutil`
// would require an iconset folder. Skip — Tauri will warn but still bundle on
// dev. Real app icons land in v0.1.

console.log("wrote tray + placeholder app icons to", iconsDir);
