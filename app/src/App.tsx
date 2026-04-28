import { useCallback, useEffect, useRef, useState } from "react";
import { Header } from "./components/Header";
import { RecordButton } from "./components/RecordButton";
import { Sidebar } from "./components/Sidebar";
import { PreviewPane } from "./components/PreviewPane";
import { SettingsPane } from "./components/Settings";
import { InstallModal } from "./components/InstallModal";
import { ipc } from "./lib/ipc";
import {
  onCaptureStateChanged,
  onCaptureStoppedFromTray,
  onRenderComplete,
  onRenderError,
  onSidecarStatus,
  onTrayRecordToggle,
} from "./lib/events";
import type { CaptureState, PermissionsReport, ReplaySummary, SidecarEvent } from "@shared/types";

type View = "main" | "preview" | "settings";

function PermissionsBanner({
  report,
  onOpenSettings,
}: {
  report: PermissionsReport;
  onOpenSettings: () => void;
}) {
  const missing = [
    report.screenRecording !== "ok" ? "screen recording" : null,
    report.accessibility !== "ok" ? "accessibility" : null,
  ].filter(Boolean) as string[];
  return (
    <button
      onClick={onOpenSettings}
      className="px-3 py-1.5 border border-emberlow/40 bg-ember/5 hover:border-ember hover:bg-ember/10 transition-colors text-2xs uppercase tracking-widest text-ember max-w-md text-center"
    >
      ▲ permissions needed: {missing.join(", ")} — open settings
    </button>
  );
}

export default function App() {
  const [view, setView] = useState<View>("main");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [captureState, setCaptureState] = useState<CaptureState | null>(null);
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [permissions, setPermissions] = useState<PermissionsReport | null>(null);
  const [permissionsChecking, setPermissionsChecking] = useState(false);
  const [, setSidecarTail] = useState<SidecarEvent | null>(null);

  // Mutable ref holding the latest handlers — populated by an effect at the
  // bottom of this component. Listeners registered once at mount can dispatch
  // through this without going stale.
  const handlersRef = useRef<{
    start?: () => Promise<void>;
    stop?: () => Promise<void>;
  }>({});
  const previewIdRef = useRef<string | null>(null);

  const refreshReplays = useCallback(async () => {
    const list = await ipc.listReplays();
    setReplays(list);
  }, []);

  // Initial setup check + state subscriptions + provider auto-fallback
  useEffect(() => {
    // Cancellation flag + array pattern handles React StrictMode's
    // double-mount: any listener that finishes registering after cleanup
    // is unregistered immediately so we never leak.
    let cancelled = false;
    const unsubs: Array<() => void> = [];
    const collect = (u: () => void) => {
      if (cancelled) u();
      else unsubs.push(u);
    };

    (async () => {
      try {
        const status = await ipc.setupCheck();
        setNeedsInstall(!status.binaryInstalled);
        const state = await ipc.getCaptureState();
        setCaptureState(state);

        // Provider availability + first-run defaulting. Logic:
        //  - If saved provider is currently usable, KEEP it (user's explicit choice wins).
        //  - If saved provider is NOT usable (CLI gone / key wiped), auto-fall back
        //    to the best available option, ranked: local-claude → local-codex →
        //    anthropic-with-key → openai-with-key.
        //  - The "explicit choice wins" rule depends on the saved provider being
        //    a real choice. Treat the literal default value (which is local-claude)
        //    as not-yet-chosen — so an old settings.json from a previous default
        //    of anthropic doesn't trap users with stale picks.
        const [agents, savedSettings, hasAnthropicKey, hasOpenAIKey] = await Promise.all([
          ipc.agentStatus(),
          ipc.getSettings(),
          ipc.hasApiKey("anthropic"),
          ipc.hasApiKey("openai"),
        ]);
        const currentProvider = savedSettings.provider;
        const providerUsable = (p: typeof currentProvider): boolean =>
          (p === "local-claude" && agents.claude.installed) ||
          (p === "local-codex" && agents.codex.installed) ||
          (p === "anthropic" && hasAnthropicKey) ||
          (p === "openai" && hasOpenAIKey);

        if (!providerUsable(currentProvider)) {
          const fallback = agents.claude.installed
            ? "local-claude"
            : agents.codex.installed
            ? "local-codex"
            : hasAnthropicKey
            ? "anthropic"
            : hasOpenAIKey
            ? "openai"
            : null;
          if (fallback && fallback !== currentProvider) {
            await ipc.setSettings({ ...savedSettings, provider: fallback });
          }
        }

        await refreshReplays();

        // Permissions probe: spawn screenpipe briefly to read its
        // self-reported permission status. Only runs if the binary is
        // installed (otherwise we don't know yet).
        if (status.binaryInstalled) {
          setPermissionsChecking(true);
          try {
            const report = await ipc.checkPermissions();
            setPermissions(report);
          } finally {
            setPermissionsChecking(false);
          }
        }
      } catch (e) {
        setError(String(e));
      }
      collect(await onCaptureStateChanged((s) => setCaptureState(s)));
      collect(await onSidecarStatus((e) => setSidecarTail(e)));
      collect(
        await onCaptureStoppedFromTray(() => {
          void ipc.getCaptureState().then(setCaptureState);
        }),
      );
      collect(
        await onRenderComplete(async ({ initialId, finalId }) => {
          if (previewIdRef.current === initialId && initialId !== finalId) {
            setPreviewId(finalId);
          }
          await refreshReplays();
        }),
      );
      collect(
        await onRenderError(({ error: msg }) => {
          if (!previewIdRef.current) setError(msg);
        }),
      );
      collect(await onTrayRecordToggle(async () => {
        // Use the same code paths as the in-app Record button so permission
        // checks, key checks, busy state, and preview rendering all work.
        // Dispatch through handlersRef so we always call the latest version
        // — handleStart reads permissions from state which only populates
        // after the boot probe finishes.
        const live = await ipc.getCaptureState();
        if (live.recordingStart != null) {
          await handlersRef.current.stop?.();
        } else {
          await handlersRef.current.start?.();
        }
      }));
    })();
    return () => {
      cancelled = true;
      for (const u of unsubs) u();
    };
  }, [refreshReplays]);

  const handleStart = async () => {
    setError(null);
    try {
      const settings = await ipc.getSettings();

      // Permissions check (most-likely failure first — they're scoped to
      // the screenpipe binary, which won't capture anything until macOS
      // grants Screen Recording / Mic / Accessibility).
      if (permissions) {
        const missing: string[] = [];
        if (permissions.screenRecording !== "ok") missing.push("screen recording");
        if (!settings.disableAudio && permissions.microphone !== "ok") missing.push("microphone");
        if (permissions.accessibility !== "ok") missing.push("accessibility");
        if (missing.length > 0) {
          setError(`missing macos permissions: ${missing.join(", ")} — grant in settings → permissions`);
          return;
        }
      }

      if (settings.provider === "local-claude" || settings.provider === "local-codex") {
        const agents = await ipc.agentStatus();
        const installed = settings.provider === "local-claude" ? agents.claude.installed : agents.codex.installed;
        if (!installed) {
          const cli = settings.provider === "local-claude" ? "claude" : "codex";
          setError(`${cli} cli not found — install it or pick a different provider in settings`);
          return;
        }
      } else {
        const hasKey = await ipc.hasApiKey(settings.provider);
        if (!hasKey) {
          const providerLabel = settings.provider === "openai" ? "openai" : "anthropic";
          setError(`no ${providerLabel} api key — go to settings`);
          return;
        }
      }
      await ipc.startRecording();
    } catch (e) {
      setError(String(e));
    }
  };

  // Detect the cold-spawn warmup window: fresh mode + screenpipe alive but
  // no active recording. During this ~1-3s window we're polling the DB for
  // the first frame; clicking record again would race the in-flight start.
  // (Always-warm mode is identical state-shape but is steady-state idle
  // and SHOULD be clickable, hence the mode check.)
  const warmingUp =
    captureState?.mode === "fresh" &&
    captureState.capturing &&
    captureState.recordingStart == null;

  const recordDisabled = needsInstall || permissionsChecking || warmingUp || (
    permissions ? (
      permissions.screenRecording !== "ok" ||
      permissions.accessibility !== "ok"
      // mic check happens in handleStart (depends on disable_audio setting)
    ) : false
  );

  // Keep the latest handlers reachable from listeners that were registered
  // once at mount. Updated every render via the effect below.
  useEffect(() => {
    handlersRef.current = { start: handleStart, stop: handleStop };
    previewIdRef.current = previewId;
  });

  const handleStop = async () => {
    setError(null);
    // Set busy IMMEDIATELY so the RecordButton timer freezes the instant the
    // user clicks Stop — the Rust stop_recording call waits ~1s for the
    // screenpipe audio flush, and during that wait recording_start is still
    // set, so without this the timer would keep ticking.
    setBusy("stopping…");
    try {
      // Backend spawns the render in the background and returns the initial
      // replay id immediately. Navigate to the preview at once; PreviewPane
      // shows the processing UI and listens for render-complete.
      const result = await ipc.stopRecording();
      setPreviewId(result.replay_id);
      setView("preview");
      setBusy(null);
      await refreshReplays();
    } catch (e) {
      setError(String(e));
      setBusy(null);
    }
  };

  const handleOpenPreview = (id: string) => {
    setPreviewId(id);
    setView("preview");
  };

  const handleDelete = async (id: string) => {
    await ipc.deleteReplay(id);
    await refreshReplays();
    if (previewId === id) {
      setPreviewId(null);
      setView("main");
    }
  };

  return (
    <div className="h-full flex flex-col relative bg-ink overflow-hidden">
      <Header
        captureState={captureState}
        onOpenSettings={() => setView("settings")}
      />

      {/* Main canvas — record button dominates */}
      <div className="flex-1 relative flex flex-col items-center justify-center gap-6">
        <RecordButton
          captureState={captureState}
          onStart={() => void handleStart()}
          onStop={() => void handleStop()}
          disabled={recordDisabled}
          busy={!!busy || warmingUp}
        />
        {captureState?.mode === "always-warm" && !captureState.recordingStart ? (
          <div className="text-2xs uppercase tracking-[0.3em] text-dust">
            ◐ buffers last 60s · clip after the fact
          </div>
        ) : null}
        {permissionsChecking ? (
          <div className="text-2xs uppercase tracking-[0.3em] text-dust animate-tick">
            ▮ checking macos permissions
          </div>
        ) : permissions && (permissions.screenRecording !== "ok" || permissions.accessibility !== "ok") ? (
          <PermissionsBanner
            report={permissions}
            onOpenSettings={() => setView("settings")}
          />
        ) : null}
        {error ? (
          <div className="px-3 py-1.5 border border-emberlow/40 bg-ember/5 text-2xs uppercase tracking-widest text-ember max-w-md text-center">
            ▲ {error}
          </div>
        ) : null}

        {/* Vertical "ledger" tab on the LEFT edge — opens the sidebar drawer */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="absolute top-1/2 left-0 -translate-y-1/2 z-10 group"
          title="Open ledger"
          aria-label="Open replay ledger"
        >
          <div className="flex flex-col items-center gap-2 px-2.5 py-4 border-y border-r border-rule bg-carbon/40 hover:bg-carbon transition-colors">
            <span className="text-2xs uppercase tracking-[0.3em] text-dust group-hover:text-bone [writing-mode:vertical-rl]">
              ledger
            </span>
            <span className="font-mono text-2xs text-ash tabular-nums">
              {String(replays.length).padStart(3, "0")}
            </span>
          </div>
        </button>
      </div>

      <Sidebar
        open={sidebarOpen}
        replays={replays}
        onClose={() => setSidebarOpen(false)}
        onOpen={(id) => {
          setSidebarOpen(false);
          handleOpenPreview(id);
        }}
        onDelete={(id) => void handleDelete(id)}
      />

      {needsInstall ? (
        <InstallModal onDone={() => setNeedsInstall(false)} />
      ) : null}
      {view === "preview" && previewId ? (
        <PreviewPane
          replayId={previewId}
          onClose={() => setView("main")}
          onIdChange={(newId) => setPreviewId(newId)}
        />
      ) : null}
      {view === "settings" ? (
        <SettingsPane onClose={() => setView("main")} />
      ) : null}
    </div>
  );
}
