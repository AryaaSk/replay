# Replay

> Click record. Show your bug. Get a perfect description for your AI agent.

Replay is a macOS desktop app that turns short screen recordings into structured, AI-ingestable bug reports. Capture is powered by [screenpipe](https://github.com/screenpipe/screenpipe) (managed locally and isolated from anything else on your system); the render pipeline coalesces events, picks key frames, redacts secrets, and produces a markdown timeline + screenshots that you paste straight into Claude Code, Cursor, or any AI coding agent.

See `../PLAN.md` for the comprehensive architecture spec.

---

## Project layout

```
app/
├── package.json            frontend deps + Tauri scripts
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/                    React + Vite frontend
│   ├── App.tsx
│   ├── components/
│   └── lib/
├── src-tauri/              Rust core
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
├── sidecar/                Node CLI: heavy-lift pipeline
│   ├── package.json
│   └── src/
└── shared/                 types shared between frontend and sidecar
    └── types.ts
```

---

## Prerequisites

- macOS 13.0+
- Node.js 22+ (for frontend dev + sidecar build)
- Rust toolchain (`rustup`) — for the Tauri shell

---

## First-time setup

```bash
cd ~/Desktop/Replay/app
npm install
cd sidecar && npm install && cd ..
```

You also need an Anthropic API key. The app stores it in macOS Keychain on first run (Settings → Anthropic API key).

---

## Run in development

```bash
# Terminal 1: build the sidecar binary (must be run before tauri:dev so the
# bundled `replay-cli` exists)
cd sidecar && npm run build && npm run pack && cd ..

# Terminal 2: start the Tauri dev shell + Vite frontend
npm run tauri:dev
```

`tauri:dev` opens the app window. Hit Record to capture, Stop to render, and the structured markdown lands in the preview.

---

## First-run flow

1. App launches, detects screenpipe is missing.
2. "Install screenpipe" modal — click to download the pinned version (~80MB) into `~/Library/Application Support/Replay/bin/screenpipe`.
3. Open Settings → paste your Anthropic API key.
4. macOS will prompt for Screen Recording / Microphone / Accessibility permissions on the first record. Quit and re-open Replay after granting.
5. Hit Record. Reproduce the bug. Hit Stop. Your structured replay opens in the preview pane. Copy markdown → paste into Claude Code.

---

## Capture modes

Settings → "Keep screenpipe always warm":

- **OFF (default)** — Fresh each recording. screenpipe spawns when you hit Record and is killed when you Stop. ~1-2s startup latency. Maximum privacy.
- **ON** — Always warm. screenpipe runs while the app is open. Instant record + look-back buffer (clip-after-the-fact, configurable 30s / 60s / 2min / 5min). The janitor prunes idle data every minute so disk doesn't grow.

The currently-active mode is shown in the header next to the Record button. macOS's native menubar dot also lights up red whenever any app is recording the screen — independent of Replay's UI.

---

## Architecture

```
Frontend (React + Vite)
   ↓ tauri invoke
Rust core (Tauri)
   ↓ spawns                ↓ spawns
screenpipe              replay-cli (Node sidecar)
   ↓ writes               ↓ reads + Anthropic vision call
~/Library/Application Support/Replay/.screenpipe/db.sqlite
```

- **Frontend** owns no business logic. Every action is a Tauri command.
- **Rust core** manages screenpipe lifecycle, Keychain, the janitor task, and dispatches the sidecar.
- **Node sidecar** does the heavy lifting in TypeScript: SQLite read, coalesce, frame pick, redact, Anthropic vision call, bundle write. Reused logic from Zoral's screenpipe coalescer.

---

## Build for distribution

```bash
cd sidecar && npm run build && npm run pack && cd ..
npm run tauri:build
```

Produces an unsigned `.app` and `.dmg` under `src-tauri/target/release/bundle/`. First launch requires right-click → Open to bypass Gatekeeper.

---

## File system layout (everything Replay touches)

```
~/Library/Application Support/Replay/
├── bin/
│   └── screenpipe              managed binary (downloaded on first run)
├── .screenpipe/                isolated screenpipe data dir
│   ├── db.sqlite
│   ├── data/<date>/*.jpg       frame snapshots
│   └── *.mp4                   audio chunks
├── replays/
│   └── <ulid>/
│       ├── report.md
│       ├── frames/*.png
│       └── metadata.json
├── settings.json
└── logs/

macOS Keychain → com.aryaa.replay/anthropic-api-key
```

Nothing under `~/Documents`, `~/Desktop`, `/Applications` (except the .app), or `/tmp` persists. The user can `rm -rf ~/Library/Application Support/Replay/` to remove every trace.

---

## Privacy posture

- **Cold-spawn default** — no capture exists outside an explicit recording.
- **Three layers of redaction** before any API call:
  - screenpipe's `--use-pii-removal` (built-in PII scrubber)
  - Replay's regex secret scan (sk-ant-*, Bearer, AWS keys, etc.)
  - Replay's image-region blur on per-frame OCR coordinates for any matches
- **BYOK** — Anthropic API key in macOS Keychain, never logged, never relayed.
- **No telemetry, no upload, no cloud sync.**
- **Wipe-on-quit** toggle (default ON) `rm -rf`'s the data dir on app quit.
- **Three layers of capture-state indication:** macOS native menubar dot, Replay's tray icon, main-window red pulsing record button.

---

## Open known issues / v0.1 backlog

- `pack.mjs` ships the sidecar as a Node-runtime wrapper rather than a self-contained binary. Works on the dev machine; for distribution we'll need to either bundle Node or use SEA properly — see PLAN.md §15.
- Permission detection is best-effort: we surface errors at record time rather than pre-checking.
- screenpipe SHA-256 verification is opportunistic — Replay verifies if a `.sha256` sidecar is published next to the release asset, otherwise relies on HTTPS + GitHub trust chain.
- Frame attachment in v1 (MCP server) is not yet implemented.

## Tray icons

`src-tauri/icons/tray-idle.png` and `tray-capturing.png` are generated by `npm run icons` (which runs `node scripts/gen-tray-icons.mjs`). The script writes a 22×22 black ring (idle, used in macOS template mode) and a 22×22 solid red dot (capturing, NOT template so the colour stays red). Both PNGs are embedded into the Rust binary at compile time via `include_bytes!`, so the swap is instant and never reads from disk at runtime.
