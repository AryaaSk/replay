# Replay

> Click record. Show your bug. Get a perfect description for your AI agent.

Replay is a macOS desktop app that turns short screen recordings into structured, AI-ingestable bug reports. Capture is powered by [screenpipe](https://github.com/screenpipe/screenpipe) (managed locally and isolated from anything else on your system); the render pipeline coalesces UI events, picks key frames, redacts secrets, and produces a markdown timeline + screenshots that paste straight into Claude Code, Cursor, or any AI coding agent.

```
cmd+shift+4 captures a moment.
Replay captures a flow.
```

---

## What it does

1. Hit Record. Reproduce the bug. Hit Stop.
2. Replay reads screenpipe's structured event log (frames, OCR, clicks, keystrokes, audio transcript), coalesces it, picks the key frames, runs them through Claude with vision.
3. ~3-5 seconds later you get a markdown timeline + key screenshots ready to paste into your AI coding agent.

```markdown
# Replay — checkout error on first email submit
**Recorded:** 14:32:00 → 14:32:47 (47s)

## Timeline
1. **[00:00]** Visited /products/widget-x ...
2. **[00:05]** Clicked "Add to cart". Cart count went 0 → 1.
...
9. **[00:27]** Error: Cannot read property 'address' of undefined.
```

The receiving Claude / Cursor / coding agent ingests this in ~10K tokens vs ~100K+ for a raw video, and reasons about it precisely.

---

## Why

Today, explaining a bug to an AI agent means:
- Pasting a screenshot — loses temporal context.
- Recording a video — LLMs ingest video poorly and expensively.
- Typing a bug report — you forget half the steps.

Replay turns a 30-90s screen capture into the **right format for an AI agent**: structured timeline + key frames + audio narration. Same UX simplicity as `cmd+shift+4`, but for a flow.

---

## Status

**Pre-release v0.** Built but not yet shipped. See [PLAN.md](./PLAN.md) for the full architecture spec and [app/README.md](./app/README.md) for run instructions.

If you want to try it: clone, follow [app/README.md](./app/README.md), bring your own Anthropic API key (BYOK).

---

## Privacy posture

- **Cold-spawn default** — screenpipe only runs during an explicit recording. Nothing is captured outside that.
- **Always-warm mode** is opt-in and provides a configurable look-back buffer (clip-after-the-fact) — the janitor prunes idle data every minute.
- **Three layers of redaction** before any API call: screenpipe's built-in PII removal, Replay's regex secret scan, image-region blur on per-frame OCR coordinates.
- **BYOK** — your Anthropic API key in macOS Keychain, never logged, never relayed. No backend, no cloud.
- **Three layers of capture-state indication**: macOS native screen-recording dot (purple), Replay's tray icon (red when capturing), main-window pulsing record button.
- **Wipe-on-quit** toggle (default ON) clears the data dir on app quit.

Stronger privacy posture than Loom Desktop, ChatGPT-style cloud capture, or any team bug recorder.

---

## Architecture

```
Frontend (React + Vite)
   ↓ tauri invoke
Rust core (Tauri shell)
   ↓ spawns                  ↓ spawns
screenpipe                 replay-cli (Node sidecar)
(managed binary,           (TypeScript: read DB → coalesce → pick
 isolated data dir)         frames → redact → Anthropic vision)
```

- **Tauri** for a small (~15MB) native macOS shell.
- **screenpipe** for screen + audio + UI event capture.
- **Anthropic Claude** with vision for the structured description.
- **Local-only**, BYOK, no backend.

Read [PLAN.md](./PLAN.md) for the full spec — components, file system layout, error handling, distribution pipeline, the lot.

---

## Repo layout

```
.
├── README.md         ← you are here
├── PLAN.md           comprehensive architecture spec
├── LICENSE           MIT
└── app/              the actual code
    ├── README.md     dev/run instructions
    ├── package.json
    ├── src/          Vite + React frontend
    ├── src-tauri/    Rust core
    ├── sidecar/      Node CLI: heavy-lift pipeline
    └── shared/       types shared between frontend and sidecar
```

---

## License

MIT. See [LICENSE](./LICENSE).

---

## Acknowledgements

- [screenpipe](https://github.com/screenpipe/screenpipe) for the capture engine. Replay is, fundamentally, a thin shell over screenpipe with an AI-targeted output format.
- Anthropic for Claude with vision.
