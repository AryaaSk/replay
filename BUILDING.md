# Building Replay from source

Replay isn't shipped as a pre-built `.app` (the project is a hobby/portfolio thing rather than a commercial product). To run it, clone the repo and build it yourself. Takes ~10 minutes the first time.

## Prerequisites

| What | Why | How |
|---|---|---|
| **macOS 13+** | required for the screen-capture / accessibility APIs Replay uses | already on your Mac |
| **Node.js 22+** | frontend (Vite + React) and sidecar (Anthropic SDK + sharp + better-sqlite3) | `brew install node` or [nodejs.org](https://nodejs.org) |
| **Rust toolchain** | Tauri's core is Rust | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **Claude Code OR an Anthropic / OpenAI API key** | Replay's render pipeline needs an LLM with vision | install `claude` from [docs.claude.com/claude-code](https://docs.claude.com/claude-code) (free with a Claude account), OR get a key from [console.anthropic.com](https://console.anthropic.com) / [platform.openai.com](https://platform.openai.com) |

You don't need an Apple Developer account, Xcode, or any signing setup to **run** the app from source.

## Step-by-step

### 1. Clone

```bash
git clone https://github.com/AryaaSk/replay
cd replay/app
```

### 2. Install JS deps

The frontend and the sidecar are separate npm projects:

```bash
npm install               # frontend
cd sidecar && npm install && cd ..   # sidecar
```

### 3. Generate icons

The repo doesn't ship the `.icns` / `.png` icon variants Tauri expects (they're build artifacts). Generate them once:

```bash
npm run icons             # tray icons + a 1024×1024 source.png
npm run icons:app         # generates icon.icns and the rest from source.png
```

These are placeholders (a flat ember-coloured disk). If you want a different icon, replace `src-tauri/icons/source.png` with a 1024×1024 PNG and rerun `npm run icons:app`.

### 4. Build the sidecar binary

The sidecar is the Node.js process that does the heavy lifting (read screenpipe DB → coalesce events → pick frames → redact secrets → call Claude). Tauri spawns it as a sidecar binary:

```bash
npm run sidecar:build
```

This bundles the TypeScript with esbuild and packs it for Tauri. Re-run after any change to files under `sidecar/`.

### 5. Run the app

```bash
npm run tauri:dev
```

First run: Cargo will compile ~150 dependencies (~5-10 min). Subsequent runs are ~10 seconds.

You should see:
- The Vite dev server start on `http://localhost:1420`
- Cargo finish compiling, then the Replay window opens
- A first-run modal asking to install **screenpipe** (the screen-capture engine Replay shells out to). Click Install — downloads ~45MB into `~/Library/Application Support/Replay/bin/screenpipe`.
- macOS will prompt for **Screen Recording**, **Microphone**, and **Accessibility** permissions the first time you hit Record. Grant each in System Settings → Privacy & Security, then quit and re-open Replay so it picks them up.

### 6. Configure provider

Open Settings (the ⚙ icon top-right). The default provider is **local Claude Code** — if you have the `claude` CLI installed and logged in, no further setup is needed.

Otherwise:
- Switch the Provider radio to `api · anthropic claude` or `api · openai gpt`
- Paste your key in the API keys section
- Pick a model (defaults are sensible)

### 7. Record something

Hit the big red Record button → reproduce a flow for ~30 seconds → hit Stop. The app navigates to a processing view; ~30-60s later you have a structured markdown report you can copy-paste into Claude Code, Cursor, GitHub Issues, etc.

## Building a `.app` you can drag to /Applications

The dev workflow above re-builds and re-runs from the project directory. To produce a standalone bundle:

```bash
npm run tauri:build
```

Output: `src-tauri/target/release/bundle/dmg/Replay_*.dmg` and the `.app` is also produced inside the .dmg.

### Gatekeeper warning on first launch

The `.dmg` is **signed but not notarised** by default — opening Replay.app on a Mac other than the one that built it triggers macOS's "Apple cannot verify this app is free of malware" warning. Workaround per Mac, one-time:

1. Right-click `Replay.app` → **Open**
2. Click **Open** in the warning dialog
3. macOS remembers, future launches are silent

If you want to avoid the warning entirely you'd need to notarise the .dmg with an Apple Developer cert ($99/yr). Out of scope for this project; the relevant scaffolding is in `.github/workflows/release.yml` and `app/src-tauri/tauri.conf.json` if you ever want to set it up — see comments there.

## Where Replay stores data

Everything lives under `~/Library/Application Support/Replay/`:

```
~/Library/Application Support/Replay/
├── bin/screenpipe              the managed screen-capture binary
├── .screenpipe/                screenpipe's data dir (db.sqlite, frames, audio)
├── replays/<ulid>/             one folder per saved replay
│   ├── report.md
│   ├── metadata.json
│   ├── frames/*.png
│   └── events.json
├── settings.json               app preferences
└── logs/                       sidecar post-mortem logs
```

API keys (when in BYOK mode) live in macOS Keychain under the service `app.replay`. Nothing else is stored anywhere.

To wipe everything: Settings → § 08 Storage → "wipe everything (nuclear)" button. Or manually:

```bash
rm -rf ~/Library/Application\ Support/Replay
security delete-generic-password -s app.replay -a anthropic-api-key 2>/dev/null
security delete-generic-password -s app.replay -a openai-api-key 2>/dev/null
```

## Common build issues

| Symptom | Cause | Fix |
|---|---|---|
| `cargo: command not found` | Rust toolchain not installed or not on PATH | `source $HOME/.cargo/env` after `rustup` install, or restart terminal |
| `failed to bundle project Failed to create app icon: resource path 'icons/icon.icns' doesn't exist` | Icons not generated | `npm run icons && npm run icons:app` |
| `Sidecar: exit code Some(1)` when clicking Stop | sidecar binary stale or not built | `npm run sidecar:build`, then re-run `npm run tauri:dev` |
| Record button disabled with "missing macos permissions" | first-time permission grant required | grant in System Settings → Privacy & Security, restart Replay |
| `claude cli not found` error | local Claude Code provider selected but `claude` not on PATH | install Claude Code, or switch provider to anthropic/openai with a key in Settings |
| `IO: rename(...) failed` errors | rare race condition during settings save | already fixed in current code; pull latest |

If you hit something not listed, check `~/Library/Application Support/Replay/logs/sidecar-*.log` for the full Node.js trace.

## Want to contribute?

Open an issue or PR. The project's roughly:
- **Frontend** (`app/src/`) — React + Vite + Tailwind
- **Rust core** (`app/src-tauri/`) — Tauri 2 + tokio
- **Node sidecar** (`app/sidecar/`) — TypeScript, esbuild-bundled

The architecture spec is in [PLAN.md](./PLAN.md).
