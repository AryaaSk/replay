# Replay — Comprehensive Architecture Plan

**Tagline:** Click record. Show your bug. Get a perfect description for your AI agent.

**Date:** 2026-04-27
**Author:** Aryaa SK (idea), drafted with Claude
**Status:** Spec, not yet implemented. This is the canonical reference.

---

## 1. Product overview

Replay is a standalone macOS desktop app that turns short screen recordings into structured, AI-ingestable bug reports. It uses screenpipe under the hood for capture (frames + OCR + UI events + audio transcription), bundles a render pipeline, and outputs markdown + key frames suitable for pasting directly into Claude Code, Cursor, GitHub issues, or any AI coding agent.

### What it solves

Today, explaining a bug to an AI coding agent means either:
- Pasting a screenshot (loses temporal context)
- Recording a video the agent can't ingest cleanly
- Typing a bug report and forgetting half the steps

Replay turns a 30-90 second screen capture into a precise structured timeline plus key frames. Same UX simplicity as `cmd+shift+4`, but captures a flow rather than a moment.

### What it is NOT

- Not a video tool. We don't render or play videos.
- Not a Loom replacement (Loom is for sharing with humans; Replay is for AI agents).
- Not Claude Code-integrated in v0. Recording starts in the app; integration buys nothing pre-recording.
- Not coupled to Zoral. Shares the coalescer engine via vendoring, runs an entirely isolated screenpipe instance.
- Not a SaaS in v0. Local app, BYOK, no backend.

### Design principles

1. **Privacy posture must be verbal AND visual at all times.** The user must never doubt whether screenpipe is currently capturing.
2. **The user owns the trade-off.** Cold-spawn (safer) vs always-warm (instant + look-back) is a settings toggle with explicit copy explaining each, not a hidden default.
3. **Total isolation.** Replay manages its own screenpipe binary, its own data dir, its own everything. No use of system-installed screenpipe (e.g. brew, global npm, Zoral's instance).
4. **BYOK end to end.** No backend infrastructure, no API key relay. User's video, user's key, our app.
5. **Thin shell over screenpipe.** We don't reimplement frame extraction, OCR, click capture, audio transcription. screenpipe does all of it. Replay is the directing layer.

---

## 2. End-user flow (happy path)

Eleven steps from clone to first replay:

1. User clones the repo and runs `npm run tauri:dev` (see BUILDING.md).
2. App window opens.
3. **First-run modal:** "Replay uses screenpipe (open source) to capture screen + audio events. We install it locally to Replay's app folder, isolated from anything else on your system. ~80MB download." — `[ Install screenpipe ]` `[ Quit ]`
4. User clicks Install. Progress bar. ~30-60s.
5. Permissions onboarding: macOS prompts (sequenced) for Screen Recording, Microphone, Accessibility. App explains each.
6. App lands on the main window. Capture mode defaults to **"Fresh each recording"** (cold-spawn, safer).
7. User encounters a bug. Hits the **Record** button.
8. ~1-2s startup latency (cold-spawn). Live indicator turns red. User reproduces the bug.
9. User hits **Stop**. screenpipe process killed. ~3-5s processing spinner.
10. Preview window opens with markdown timeline + key frames inline. User clicks **Copy markdown**.
11. User pastes into Claude Code prompt. Done. Asks "why does this break?"

Subsequent recordings: skip steps 1-6. Three actions total: Record → Stop → Copy.

Power-user variant (always-warm + look-back): user toggles "Keep screenpipe always warm" in Settings. Now Record is instant and they can clip-after-the-fact via the look-back buffer.

---

## 3. Architecture diagram

```
┌──────────────────────── Replay.app ───────────────────────────┐
│                                                                │
│  ┌─────────────────── Frontend (Vite + React) ──────────────┐ │
│  │  Record button  │  Capture mode toggle  │  Replay list   │ │
│  │  Settings panel │  Preview pane         │  Menubar icon  │ │
│  └─────────────────────────┬─────────────────────────────────┘ │
│                            │ Tauri invoke()                    │
│  ┌─────────────────── Rust core (~150-300 LOC) ────────────┐  │
│  │  - screenpipe lifecycle (spawn, kill, monitor)           │  │
│  │  - Janitor task (tokio::spawn, 60s tick)                 │  │
│  │  - Keychain access (security-framework crate)            │  │
│  │  - Sidecar dispatch (spawn replay-cli, stream output)    │  │
│  │  - Menubar icon + popover (tauri-plugin-positioner etc.) │  │
│  │  - First-run installer for screenpipe binary             │  │
│  └─────────────────────────┬─────────────────────────────────┘  │
│           Spawns                  │          Spawns               │
│           ↓                       ↓                                │
│  ┌──────────────┐           ┌──────────────────────────────┐    │
│  │ screenpipe   │           │ replay-cli (Node sidecar)    │    │
│  │ (managed     │           │  - SQLite read               │    │
│  │  binary)     │           │  - Coalescer (vendored Zoral)│    │
│  │              │           │  - Frame pick + compress     │    │
│  │  writes →    │           │  - Redaction                 │    │
│  │              │           │  - Anthropic vision call     │    │
│  └──────┬───────┘           └──────────────┬───────────────┘    │
│         │ writes                            │ reads/writes        │
│         ↓                                   ↓                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ~/Library/Application Support/Replay/                   │    │
│  │  ├── bin/screenpipe          (managed binary)            │    │
│  │  ├── .screenpipe/            (capture data, isolated)    │    │
│  │  │   ├── db.sqlite                                       │    │
│  │  │   ├── data/<date>/*.jpg   (frame snapshots)           │    │
│  │  │   ├── *.mp4               (audio chunks)              │    │
│  │  │   └── logs/                                            │    │
│  │  ├── replays/                                             │    │
│  │  │   └── <ulid>/                                          │    │
│  │  │       ├── report.md                                    │    │
│  │  │       ├── frames/*.png                                 │    │
│  │  │       └── metadata.json                                │    │
│  │  └── settings.json           (NOT api key — that's in    │    │
│  │                               Keychain)                  │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
                       ↑
                       │ HTTPS, BYOK
                       ↓
              ┌──────────────────┐
              │  Anthropic API   │
              │  (vision call)   │
              └──────────────────┘
```

---

## 4. Components

### 4.1 Tauri shell (Rust core)

**Role:** thin OS-glue layer. Owns all native concerns: window, menubar, screenpipe child process, Keychain, file system.

**Lines of code:** ~150-300.

**Tauri commands exposed to frontend:**

| Command | Args | Returns | Purpose |
|---|---|---|---|
| `setup_check` | — | `{ binaryInstalled: bool, permissionsGranted: bool }` | First-run gate |
| `install_screenpipe` | — | progress events via `tauri::Window::emit` | Download + place binary |
| `start_prewarm` | — | `Result<(), Error>` | Spawn always-warm screenpipe |
| `stop_prewarm` | — | `Result<(), Error>` | Kill always-warm screenpipe |
| `start_recording` | — | `{ startTs: ISO, prewarm: bool }` | Bookmark start (or spawn if cold) |
| `stop_recording` | `startTs` | `{ replayId: string, status: stream }` | Spawn sidecar, stream events |
| `save_replay` | `replayId, title?` | `Replay` | Persist to replays/ |
| `discard_replay` | `replayId` | `()` | Delete preview + prune janitor range |
| `list_replays` | — | `Replay[]` | For the recent-replays list |
| `get_setting` / `set_setting` | `key, value?` | varies | Settings.json read/write |
| `set_api_key` / `get_api_key_status` | `key` | bool | Keychain (key never returned to frontend) |
| `quit_capturing` | — | `()` | Emergency stop from menubar popover |
| `get_capture_state` | — | `{ capturing, mode, recordingStart? }` | Polled by frontend for indicator |

**Background tasks (tokio::spawn):**

- **Janitor** — every 60s while always-warm is on. See §6.
- **Capture-state broadcaster** — emits `capture-state-changed` Tauri event on every transition so the menubar icon and main UI update without polling.
- **screenpipe child watchdog** — subscribes to `tokio::process::Child`'s exit event; if the child dies unexpectedly, surfaces an error to the frontend and sets capture-state to idle.

**Files in `src-tauri/src/`:**

```
main.rs            entry point, Tauri builder, command registration
recording.rs       screenpipe lifecycle (start_prewarm, start_recording, etc.)
janitor.rs         the prune loop
sidecar.rs         spawn replay-cli, stream output back to frontend
keychain.rs        wrap security-framework crate
installer.rs       download + verify screenpipe binary on first run
menubar.rs         menubar icon + popover
state.rs           AppState struct (Mutex over screenpipe child handle, mode, etc.)
errors.rs          unified Error enum, serializable to frontend
```

### 4.2 Frontend (Vite + React)

**Role:** the visible app. Pure UI, no business logic — every action goes through Tauri commands.

**Stack:** Vite + React + TailwindCSS. Vanilla TypeScript, no state-management library (React's built-in state is plenty for this app's surface).

**Window structure:**

```
src/
├── main.tsx
├── App.tsx                     router (main / preview)
├── components/
│   ├── Header.tsx              capture mode toggle + capturing indicator
│   ├── RecordButton.tsx        big round button, pulsing when active
│   ├── ReplayList.tsx          recent replays
│   ├── PreviewPane.tsx         markdown rendering + frame thumbnails
│   ├── Settings.tsx            Settings panel
│   └── MenubarPopover.tsx      menubar dropdown content (separate window)
└── lib/
    ├── ipc.ts                  thin wrappers around Tauri invoke()
    ├── events.ts               subscribe to capture-state-changed
    └── markdown.tsx            simple md renderer with image inlining
```

**Capture-state subscription pattern:**

```ts
import { listen } from "@tauri-apps/api/event";
const unlisten = await listen<CaptureState>("capture-state-changed", ({ payload }) => {
  setCaptureState(payload);  // updates header + record button styling
});
```

This means the UI updates the moment Rust transitions state, not on a poll.

### 4.3 Node sidecar (replay-cli)

**Role:** the heavy lifting. Reads screenpipe DB, coalesces, picks frames, redacts, calls Anthropic.

**Why Node, not Rust:** because we already wrote the coalescer in TypeScript for Zoral. Vendoring it (or publishing as `@zoral/screenpipe-coalescer` and depending on it) means zero re-implementation. The sidecar is a CLI program that takes a timestamp range + paths and produces a replay bundle.

**Bundling:** built with `esbuild --bundle --platform=node --target=node22` plus `pkg` (or `node --experimental-sea-config`) into a single executable binary `replay-cli`. Shipped inside the .app via Tauri's `externalBin` config.

**Invocation from Rust:**

```rust
use tauri::api::process::{Command, CommandEvent};
let (mut rx, _child) = Command::new_sidecar("replay-cli")?
    .args(["--from", &start_ts, "--to", &end_ts, "--data-dir", &data_dir, "--out", &out_dir, "--api-key-env", "ANTHROPIC_API_KEY"])
    .spawn()?;
while let Some(event) = rx.recv().await {
  match event {
    CommandEvent::Stdout(line) => window.emit("sidecar-status", line)?,
    CommandEvent::Stderr(line) => log::warn!("{}", line),
    CommandEvent::Terminated(_) => break,
    _ => {}
  }
}
```

**API key handling:** Rust reads the key from Keychain, sets it as `ANTHROPIC_API_KEY` in the sidecar's env, never logs it. Sidecar reads from env.

**Sidecar output:** streams JSON status events to stdout, one per line:

```json
{"event": "reading_db",        "rows": 0}
{"event": "coalesced",         "events": 23}
{"event": "frames_picked",     "count": 11}
{"event": "redactions",        "text": 2, "image": 1}
{"event": "calling_anthropic", "model": "claude-sonnet-4-6"}
{"event": "complete",          "report_path": "...", "duration_ms": 4123}
```

This lets the frontend show a precise progress bar instead of a generic spinner.

**Files in `sidecar/src/`:**

```
index.ts              CLI entry, arg parsing, status emit
reader/
  db.ts               better-sqlite3 read-only WAL
  query.ts            range query
coalescer/            vendored from Zoral (with Replay-flavoured config)
  index.ts
  types.ts
frames/
  pick.ts             key-frame heuristic
  compress.ts         sharp pipeline (resize + redact + base64)
  perceptualHash.ts   pHash for dedup
redact/
  secrets.ts          regex layer
  ocr.ts              image-region blur
  rules.ts            user-defined rules
describe/
  prompt.ts           system prompt
  model.ts            Anthropic SDK call
output/
  bundle.ts           write report.md + metadata.json + frames/
lib/
  log.ts
  time.ts
```

### 4.4 screenpipe (managed binary)

**Role:** the actual capture engine. Black box from Replay's perspective — we spawn it with flags, it writes to its data dir, we read from its DB.

**Isolation:** see §5. Replay manages its own copy at `~/Library/Application Support/Replay/bin/screenpipe`. Never uses any system-installed screenpipe.

**Spawn flags** (verified against `screenpipe record --help` for v0.3.298):

| Flag | Value | Purpose |
|---|---|---|
| `--data-dir` | `~/Library/Application Support/Replay/.screenpipe` | Isolation |
| `--audio-chunk-duration` | `5` | Faster audio flush after Stop (default 30s) |
| `--transcription-mode` | `realtime` | Transcribe as captured (default `batch`) |
| `--video-quality` | `high` | Better screenshots for vision call (default `balanced`) |
| `--use-pii-removal` | (flag) | screenpipe's built-in PII scrubber, free privacy layer |
| `--filter-music` | (flag) | Skip music transcription |
| `--retention-days` | `1` | screenpipe's own cleanup as a backstop; janitor handles fine-grained pruning |
| `--ignored-windows` | `"Replay"` | Don't capture our own UI |
| `--monitor-id` | (from Settings) | Single-monitor focus if user picks |
| `--disable-telemetry` | (flag) | Privacy |
| `--port` | `0` | Disable screenpipe's HTTP API; we don't use it |

**Verification:** every Replay release re-runs `screenpipe record --help` against the pinned version and asserts these flags still exist. If a flag is renamed, fail the build.

---

## 5. screenpipe install + auto-update

Replay maintains its own isolated copy of the screenpipe binary. Never uses any system-installed version.

### First-run install

On app launch, `setup_check` runs:

```rust
let bin = app_dir.join("bin/screenpipe");
let installed = bin.exists() && is_executable(&bin);
let permissions_ok = check_macos_permissions();  // optional best-effort
```

If `installed == false`, frontend shows the first-run modal. User clicks Install.

`install_screenpipe` command does:

1. Look up the latest screenpipe macOS release URL from GitHub releases. Cache the answer for 24h.
2. Download the binary to a temp file. Stream progress to frontend (`install-progress` event with bytes/percent).
3. Verify SHA-256 checksum against the value published in the release notes (or against a hash we hardcode for the pinned version).
4. Move the binary to `~/Library/Application Support/Replay/bin/screenpipe`.
5. `chmod +x`.
6. Run `bin/screenpipe --version` as a smoke test.
7. Frontend dismisses modal.

If download fails, retry with backoff. If checksum fails, refuse to install and surface a clear error.

### Auto-update

Background task on app launch (and once a week if app stays open):

1. Query GitHub releases for the latest version.
2. If newer than installed, surface a non-modal banner: "screenpipe v0.3.300 available. [Update] [Skip]"
3. User clicks Update → same install flow as first-run, atomic replacement of the binary. If a recording is in progress, defer until idle.

User can disable auto-update checks in Settings ("Don't check for screenpipe updates").

### Pinning option

Power users can pin to a specific version via Settings → "Use specific screenpipe version: v0.3.298". Useful when a screenpipe release breaks our flag set; we defend by pinning until we ship a Replay update that adapts.

### Why not bundle the binary

| Option | Bundle size | Versioning | Notarisation | Verdict |
|---|---|---|---|---|
| Bundle in .app | ~150-200MB | Frozen at our ship time | Must sign every screenpipe release as ours | Bad. Bloats download, decouples versioning. |
| Install on first run (this plan) | ~15MB | Independent of Replay releases | Only sign Replay's own code | **Good.** |
| Use system-installed screenpipe | ~15MB | Whatever user has | Detection + version check needed | Rejected — user wants total isolation. |

---

## 6. Capture modes & janitor

### 6.1 Capture mode toggle ("Keep screenpipe always warm while app is open")

Defaults to **OFF (fresh each recording)** — the safer default for new users.

**OFF — Fresh each recording:**
- screenpipe child does not exist while idle.
- Record spawns a new screenpipe with the §4.4 flags. ~1-2s startup latency.
- Stop SIGINTs the child, waits for clean exit.
- Data dir wiped after the user saves or discards the replay.
- No look-back buffer (capture only exists during explicit recordings).

**ON — Always warm:**
- screenpipe child spawned on app open, killed on app quit.
- Record bookmarks `startTs = now()`. Stop bookmarks `endTs = now()`.
- Janitor §6.2 runs every 60s to prune idle data.
- Look-back buffer §6.3 lets the user clip retroactively.

The toggle copy is verbatim in §4 of the v4 plan. Settings labels are plain English ("Keep screenpipe always warm" / "Fresh each recording"), not jargon.

### 6.2 Janitor (always-warm only)

Background tokio task, 60s tick.

```rust
// Pseudocode:
loop {
  sleep(60s).await;
  if mode != AlwaysWarm { continue; }
  let keep = compute_keep_ranges();  // active rec + saved replays + look-back
  let pruned = prune_screenpipe_db_outside(&keep);
  delete_orphan_files(&keep);
  if cycle % 10 == 0 { vacuum_sqlite(); }
  log::debug!("pruned {pruned:?}");
}
```

**Keep ranges:**

```
keep = []
if recording_in_progress: keep.push((rec_start, ∞))
for replay in saved_replays: keep.push((replay.start, replay.end))
keep.push((now() - lookback_buffer, now()))
```

**Prune operations:**

- `DELETE FROM frames WHERE timestamp NOT IN any keep range AND timestamp < (now - 5s safety margin)`
- Same for `ui_events`, `ocr_text`, `audio_transcriptions`, `audio_chunks`
- For each deleted `frames.snapshot_path`, `unlink()` the file
- For each deleted `audio_chunks.file_path`, `unlink()` the mp4
- Every 10th tick: `VACUUM` the SQLite DB to reclaim space

**5-second safety margin:** never prune the very-recent past, in case the user clicks Record right at the moment the janitor fires.

### 6.3 Look-back buffer

Configurable in Settings: `30s / 60s (default) / 2min / 5min`.

When the user hits Record in always-warm mode, the recording's effective start is `now() - lookback`. So if they reproduced the bug 45 seconds ago and then hit Record, the 60s buffer captures it.

This is **clip-after-the-fact** and it's the killer feature of always-warm mode. Document it prominently — it's the user-visible reason to opt into always-warm.

UI affordance: when always-warm is on, the Record button has a subtle subtitle "buffers last 60s" so users know the feature exists without reading docs.

---

## 7. Capture-state indicators

The user must NEVER be in doubt about whether screenpipe is currently capturing.

### Three layers, all redundant

**Layer 1 — macOS native menubar dot.** Built-in OS signal. Red dot when any app is recording the screen. Triggered automatically by screenpipe. Document in README as authoritative source of truth.

**Layer 2 — Replay's own menubar icon.** Always present (even when the main window is minimised or behind other apps).
- **Idle:** outlined Replay logo, monochrome.
- **Capturing:** filled red circle pulsing at ~1Hz.

Click it for a small popover:

```
┌─────────────────────────────────┐
│ ● Capturing                     │
│ Mode: Always warm                │
│ Last janitor prune: 23s ago     │
│                                 │
│ [ Stop capturing now ]          │
│ [ Open Replay window ]          │
└─────────────────────────────────┘
```

**The "Stop capturing now" button is the universal escape hatch:** kills screenpipe from any context, switches mode to Fresh-each-recording. One click from any app.

**Layer 3 — main window indicators.** When capturing:
- Record button glows red, pulses
- Header shows "● capturing"
- During an active recording, a duration timer (`00:23` → `00:24` → …)

When idle: button matte, no pulse, no badge, no timer.

**Why three layers:** indicators are cheap; missed-capture is expensive. The OS layer protects against bugs in our app. Our menubar protects against the user having the main window hidden. The main window protects against the user not knowing which app's the menubar dot.

---

## 8. Privacy & redaction

Three layers, applied before any data leaves the user's machine.

### Layer A — screenpipe's built-in PII removal

Pass `--use-pii-removal` to screenpipe. It scrubs detected PII from OCR text and accessibility data at capture time. Free, no work for us.

### Layer B — Replay's regex secret scan

Before any sidecar API call, scan all `text_content`, `clipboard`, and joined `ocr_text` fields for:

- `sk-ant-[a-z0-9-_]{20,}` (Anthropic)
- `sk-proj-[a-z0-9-_]{20,}` (OpenAI)
- `Bearer [A-Za-z0-9._-]{20,}` (auth headers)
- `AKIA[A-Z0-9]{16}` (AWS access keys)
- `[A-Za-z0-9]{32,}` near `password`, `token`, `secret`, `api[-_]?key`
- Generic high-entropy strings >40 chars not in URL paths
- Optional: credit card patterns (Luhn-validated)

Replace matches with `[REDACTED:<kind>]` in the timeline. The original is never sent to the model.

### Layer C — Image-region blur

For each chosen frame:

1. Re-OCR the frame (or read screenpipe's stored OCR with its bounding boxes via `ocr_text.text_json`).
2. For each Layer B match, blur the bounding box with `sharp` before encoding to base64.
3. For accessibility-tree elements with `element_role == "password"`, blur the element bounds.

### User confirmation modal (optional, default ON)

Before the sidecar fires the Anthropic call, show:

```
About to send to Anthropic:
- 11 frames (1024px wide each)
- 23 timeline events
- 2 OCR redactions applied
- 1 password field blurred (frame 03)

[ Send ]   [ Review redactions ]   [ Cancel ]
```

"Review redactions" opens a frame-by-frame view with redacted regions highlighted. Power users can disable the modal in Settings.

### User-defined rules

`~/Library/Application Support/Replay/redact-rules.json`:

```json
{
  "patterns": [
    "ACME-INTERNAL-\\w+",
    "github_pat_\\w+"
  ],
  "windows_to_skip_entirely": ["1Password", "Keychain Access"]
}
```

Loaded at sidecar start. Lets the user encode their employer's secret formats.

---

## 9. Settings & BYOK

```
┌────────────────── Settings ──────────────────┐
│ ── API ──                                     │
│ Anthropic API key                             │
│ [ sk-ant-api03-•••••••• ] [ Test ]           │
│ Stored in macOS Keychain.                     │
│                                                │
│ Model                                          │
│ ◉ claude-sonnet-4-6 (recommended)              │
│ ○ claude-haiku-4-5  (cheaper)                 │
│ ○ claude-opus-4-7   (best quality)            │
│                                                │
│ ── Capture ──                                 │
│ ☐ Keep screenpipe always warm                 │
│   ⓘ Trade-off: instant record + clip-back     │
│      vs. continuous capture while app is open │
│                                                │
│ Look-back buffer (always-warm only)           │
│ ◯ 30s  ◉ 60s  ◯ 2min  ◯ 5min                 │
│                                                │
│ Monitor: [ All monitors ▼ ]                   │
│ ☑ Filter music from audio                     │
│ ☑ Use screenpipe's built-in PII removal       │
│                                                │
│ ── Privacy ──                                 │
│ ☑ Redact API keys / Bearer tokens             │
│ ☑ Confirm before sending to Anthropic         │
│ ☑ Wipe data dir when app quits                │
│                                                │
│ ── Output ──                                  │
│ ☑ Auto-copy markdown to clipboard             │
│ ☐ Save bundle to ~/Documents/Replay/          │
│                                                │
│ ── screenpipe ──                              │
│ Version: v0.3.298 (managed by Replay)         │
│ ☑ Auto-check for updates                      │
│ [ Check for updates now ]                     │
│ [ Reset / reinstall screenpipe ]              │
│                                                │
└──────────────────────────────────────────────┘
```

**API key storage:** macOS Keychain via Rust `security-framework` crate. Never written to disk in plaintext. Never returned to the frontend (the frontend can ask "is a key stored?" via `get_api_key_status` but cannot read it).

**Settings persistence:** all non-secret settings in `~/Library/Application Support/Replay/settings.json`. JSON, hand-editable as an escape hatch.

---

## 10. File system layout

Everything Replay touches:

```
~/Library/Application Support/Replay/
├── bin/
│   └── screenpipe                  managed binary
├── .screenpipe/                    isolated capture data dir
│   ├── db.sqlite                   ← screenpipe writes
│   ├── db.sqlite-wal
│   ├── db.sqlite-shm
│   ├── data/<YYYY-MM-DD>/*.jpg     frame snapshots
│   ├── *.mp4                       audio chunks
│   └── logs/
├── replays/
│   └── <ulid>/
│       ├── report.md
│       ├── metadata.json
│       └── frames/
│           ├── 01-product-page.png
│           └── ...
├── settings.json                   non-secret app settings
├── redact-rules.json               user-defined redaction patterns
└── logs/
    └── replay-cli.log              sidecar logs

macOS Keychain
└── com.aryaa.replay
    └── anthropic-api-key            secret only

GitHub releases (downloaded on demand)
└── screenpipe-macos-arm64           pinned version, downloaded by installer
```

Nothing under `~/Documents`, `~/Desktop`, `/Applications` (other than the .app itself), or `/tmp` persists. All Replay data is under one parent directory the user can `rm -rf` to remove every trace.

---

## 11. Data model

### Replay metadata (`metadata.json`)

```ts
type Replay = {
  id: string;                       // ULID
  title: string;                    // user-edited or LLM-suggested
  startTs: string;                  // ISO 8601
  endTs: string;
  durationMs: number;
  createdAt: string;
  device: {
    machineName: string;
    macosVersion: string;
  };
  capture: {
    mode: "fresh" | "always-warm";
    lookbackSeconds: number;        // 0 if cold-spawn
    monitor: string | "all";
  };
  redactions: {
    textMatches: number;
    imageBlurs: number;
    rulesApplied: string[];
  };
  api: {
    model: string;                  // claude-sonnet-4-6 etc
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
  };
  frames: { filename: string; relativeMs: number }[];
};
```

### Saved replays index (in-memory, derived from filesystem on app launch)

Just `fs.readdir(replays/)` and parse each `metadata.json`. No separate index file — the filesystem is the source of truth, immune to corruption.

### Settings.json

```ts
type Settings = {
  alwaysWarm: boolean;
  lookbackSeconds: 30 | 60 | 120 | 300;
  model: "claude-sonnet-4-6" | "claude-haiku-4-5" | "claude-opus-4-7";
  monitor: string | "all";
  filterMusic: boolean;
  usePiiRemoval: boolean;
  redactSecrets: boolean;
  confirmBeforeSend: boolean;
  wipeOnQuit: boolean;
  autoCopyToClipboard: boolean;
  saveBundleToDocuments: boolean;
  autoCheckScreenpipeUpdates: boolean;
  pinnedScreenpipeVersion: string | null;
};
```

---

## 12. Permission flows

screenpipe needs three macOS permissions:

1. **Screen Recording** — for frame capture
2. **Microphone** — for audio capture
3. **Accessibility** — for UI events (clicks, keystrokes, app_switch)

### First-run sequencing

After screenpipe install completes, before the user can hit Record:

```
┌── Almost ready ──────────────────────────┐
│ Replay needs three macOS permissions to  │
│ capture screen events. Click each to     │
│ open System Settings.                    │
│                                           │
│ ☐ Screen Recording   [ Grant ]           │
│ ☐ Microphone         [ Grant ]           │
│ ☐ Accessibility      [ Grant ]           │
│                                           │
│ [ I'll do it later ]   [ Continue ]      │
└──────────────────────────────────────────┘
```

Each Grant button opens the relevant System Settings pane via `x-apple.systempreferences:` URL scheme.

After granting, the user must restart Replay (macOS only re-reads permissions on app launch). Show a friendly "Quit and re-open Replay" prompt.

### Re-checking on each Record

If a permission is missing when the user hits Record:

```
┌── Missing permission ────────────────────┐
│ Replay can't record without Microphone.  │
│ [ Open System Settings ]   [ Skip mic ]  │
└──────────────────────────────────────────┘
```

"Skip mic" passes `--disable-audio` to screenpipe and proceeds.

---

## 13. Error handling

### Failure modes, all handled explicitly

| Failure | Detection | User-facing message | Recovery |
|---|---|---|---|
| screenpipe binary not installed | `setup_check` | First-run modal | Install flow |
| screenpipe download fails | HTTP error | "Couldn't reach GitHub. Retry?" | Retry button |
| screenpipe checksum mismatch | SHA verify | "Download corrupted. Re-download." | Refuse to install, retry |
| screenpipe spawn fails (permission denied) | `tokio::process::Command` error | "Replay needs Screen Recording permission." | Permission flow |
| screenpipe child crashes mid-recording | Watchdog detects exit | "Recording was interrupted. Try again?" | Discard partial replay |
| SQLite locked / corrupt | `better-sqlite3` error in sidecar | "Couldn't read capture data. Try again." | Surface, allow retry |
| Anthropic API error | HTTP 4xx/5xx | "Anthropic API error: <message>. Check your API key." | Surface, link to Settings |
| Anthropic rate-limit | HTTP 429 | "Rate-limited. Try again in a moment." | Auto-retry once with backoff |
| API key invalid | HTTP 401 | "API key rejected. Update in Settings." | Open Settings |
| Disk full | sqlite or fs error | "Disk full. Free space and retry." | Suggest cleanup |
| User has no internet | fetch error in sidecar | "Replay needs internet to call Anthropic." | Offline error |

All errors logged to `~/Library/Application Support/Replay/logs/replay-cli.log` (sidecar) and Tauri's log dir (Rust core). Settings has a "Show logs" button that opens the log dir in Finder.

### Graceful shutdown

On `cmd+Q` or app close:

1. If recording in progress: abort, discard partial.
2. If always-warm on: SIGINT screenpipe child, wait 5s, SIGKILL fallback.
3. Run final janitor pass.
4. If `wipeOnQuit` setting is on: `rm -rf` the data dir.
5. Exit.

If app force-quits or crashes: next launch detects orphaned screenpipe processes (`pgrep -f "screenpipe.*Replay"`) and kills them before continuing.

---

## 14. Distribution

Source-only. Users clone the repo and run `npm run tauri:dev` (or `npm run tauri:build` for an unsigned `.dmg`). See BUILDING.md. No signing, no notarisation, no auto-update — Replay is a hobby project, not a shipped product.

---

## 15. Build order (1-week sprint)

| Day | Deliverable |
|---|---|
| 1 | Tauri scaffold. Frontend skeleton (Header + RecordButton + Settings stub). Rust commands stubbed but no implementation. App builds and runs. |
| 2 | screenpipe installer (`installer.rs`). First-run modal with download progress. Get `bin/screenpipe --version` working from the managed location. |
| 3 | `recording.rs`: spawn screenpipe with §4.4 flags in cold-spawn mode. Start/Stop wired. State broadcast to frontend so the indicator works. |
| 4 | Sidecar (`replay-cli`): vendor Zoral coalescer, implement reader, frames pick, output report.md (no AI yet). Wire Tauri to spawn it. End-to-end "record → coalesce → display structured timeline" works. |
| 5 | Anthropic SDK call in sidecar. Iterate prompt against 5 real recordings. Preview pane renders the markdown + frames. Copy-to-clipboard. |
| 6 | Settings panel: Keychain wiring, capture mode toggle, model picker. Always-warm mode + janitor. Look-back buffer. |
| 7 | Redaction (regex + image blur). Confirm-before-send modal. Menubar icon + popover with global Stop-capturing-now. Permission onboarding. Notarise the .dmg. Demo video. |

Realistic but tight. If Tauri IPC pattern is rough on day 1-2, fall back to Electron — same architecture, ship in ~5 days extra.

### Post-v0 backlog

- MCP server for direct Claude Code / Cursor integration
- Optional hosted: team replay libraries, shareable links
- Linux/Windows ports (need a different capture engine — screenpipe has Windows but not great Linux support)

---

## 16. Dependencies & versioning

### Runtime

| Dep | Where | Version | Pinned? |
|---|---|---|---|
| Tauri | Rust core | v2 | yes |
| @tauri-apps/api | Frontend | v2 | yes |
| @tauri-apps/plugin-shell | Rust | latest stable | yes |
| security-framework | Rust | latest | yes |
| tokio | Rust | latest | yes |
| reqwest | Rust (installer) | latest | yes |
| React | Frontend | 19 | yes |
| Vite | Frontend | latest | yes |
| TailwindCSS | Frontend | 4 | yes |
| @anthropic-ai/sdk | Sidecar | latest | yes |
| better-sqlite3 | Sidecar | latest | yes |
| sharp | Sidecar | latest | yes |
| zod | Sidecar | latest | yes |
| pino | Sidecar | latest | yes |

### screenpipe pin

Replay pins to a known-good screenpipe version (initially v0.3.298). Auto-update prompts the user but never forces. Pinning means if a screenpipe release breaks our spawn flags, we don't break — we adapt in the next Replay release and bump the pin.

---

## 17. Open questions

1. **Tauri vs Electron decision.** Pick at start of Day 1. If Rust friction is real (the team has zero Rust experience), Electron is the safe fallback. The architecture is identical; only the bundle size and the IPC syntax change. Default to Tauri for the smaller .dmg and more native feel.

2. **screenpipe binary host & checksum.** Where does `installer.rs` download from? GitHub releases is the obvious answer, but the screenpipe team must publish per-release SHA-256 checksums, otherwise we self-publish a fork. Verify on day 2.

3. **Notarisation pipeline.** First Apple Developer account setup is ~30 min the first time. Don't leave for Day 7 — stub on Day 1 to avoid scrambling at launch.

4. **Multi-monitor default.** Capture all (current default) or capture focused only? "All" wastes storage; "focused" loses context if the bug spans monitors. Default to all in v0; let user pick in Settings.

5. **Whisper model in screenpipe.** Default is `parakeet`. Quality is sometimes shaky on accents. Settings could expose `whisper-large-v3-turbo` as a "higher quality" option (slower transcription, but for 60s clips it's fine).

6. **Frame attachment strategy when integrating with Claude Code (v1).** Markdown with `![](file://...)` works for now. The MCP server in v1 will need a cleaner contract — but that's v1, not v0.

7. **Per-team / per-org redact rules sharing.** A `redact-rules.json` could be committed to a team repo and pointed-at via a Settings path. Easy to add later.

---

## 18. Marketing & launch

**The demo IS the marketing.** Plan:

1. Record yourself fixing a real bug end-to-end with Replay.
2. Drop the Replay output into Claude Code.
3. Watch Claude debug the issue correctly.
4. Tweet the screen recording with caption: "I built Replay — drag a screen recording into Claude Code and it just works. cmd+shift+5 for time. Free, local, BYOK. [link]"

The launch tweet should NOT show the app's UI screenshots — show the **before/after of the AI agent's response** with vs without the structured replay. That's the differentiator.

**Privacy story:**

- Cold-spawn default = no capture outside an explicit recording
- Always-warm + janitor + look-back = explicit, configurable opt-in
- Three layers of redaction
- BYOK = no third party between you and Anthropic
- Local-only history, wipe-on-quit
- Open-source-stack (screenpipe), inspectable code

This is genuinely stronger than Loom Desktop, ChatGPT-style cloud capture, any team bug recorder. **Lead with this in marketing**, especially in the README and product page.

---

## 19. The bottom line

Replay v0:
- Tauri desktop app with screenpipe (managed, isolated) under the hood
- Cold-spawn default, always-warm with janitor + look-back as opt-in
- BYOK Anthropic, no backend
- 1-week sprint, ~$0.05-0.10 per replay, ~3-5s render time
- Source-only distribution; first-run screenpipe install (~80MB) into the app's local folder

The full architecture is built around two non-negotiable principles: **the user is always told when capture is happening** (three redundant indicators), and **capture exists only when the user has explicitly authorised it** (toggle defaults to fresh-each-recording).

Build it after Zoral hits a checkpoint. The window for "structured beats raw video for AI ingestion" is at least 12-18 months; structured beats raw on signal density forever. Ship clean v0, iterate based on real users.
