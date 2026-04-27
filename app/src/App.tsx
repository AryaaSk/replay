import { useCallback, useEffect, useState } from "react";
import { Header } from "./components/Header";
import { RecordButton } from "./components/RecordButton";
import { ReplayList } from "./components/ReplayList";
import { PreviewPane } from "./components/PreviewPane";
import { SettingsPane } from "./components/Settings";
import { InstallModal } from "./components/InstallModal";
import { ipc } from "./lib/ipc";
import {
  onCaptureStateChanged,
  onCaptureStoppedFromTray,
  onSidecarStatus,
} from "./lib/events";
import type { CaptureState, ReplaySummary, SidecarEvent } from "@shared/types";

type View = "main" | "preview" | "settings";

export default function App() {
  const [view, setView] = useState<View>("main");
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [captureState, setCaptureState] = useState<CaptureState | null>(null);
  const [replays, setReplays] = useState<ReplaySummary[]>([]);
  const [needsInstall, setNeedsInstall] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, setSidecarTail] = useState<SidecarEvent | null>(null);

  const refreshReplays = useCallback(async () => {
    const list = await ipc.listReplays();
    setReplays(list);
  }, []);

  // Initial setup check + state subscriptions
  useEffect(() => {
    let unsubCapture: (() => void) | undefined;
    let unsubSidecar: (() => void) | undefined;
    let unsubTray: (() => void) | undefined;

    (async () => {
      try {
        const status = await ipc.setupCheck();
        setNeedsInstall(!status.binaryInstalled);
        const state = await ipc.getCaptureState();
        setCaptureState(state);
        await refreshReplays();
      } catch (e) {
        setError(String(e));
      }
      unsubCapture = await onCaptureStateChanged((s) => setCaptureState(s));
      unsubSidecar = await onSidecarStatus((e) => setSidecarTail(e));
      unsubTray = await onCaptureStoppedFromTray(() => {
        void ipc.getCaptureState().then(setCaptureState);
      });
    })();
    return () => {
      unsubCapture?.();
      unsubSidecar?.();
      unsubTray?.();
    };
  }, [refreshReplays]);

  const handleStart = async () => {
    setError(null);
    try {
      const settings = await ipc.getSettings();
      const hasKey = await ipc.hasApiKey(settings.provider);
      if (!hasKey) {
        const providerLabel = settings.provider === "openai" ? "OpenAI" : "Anthropic";
        setError(`No ${providerLabel} API key — go to settings`);
        return;
      }
      await ipc.startRecording();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleStop = async () => {
    setError(null);
    setBusy("Processing recording…");
    try {
      const result = await ipc.stopRecording();
      setBusy(null);
      setPreviewId(result.replay_id);
      setView("preview");
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
    <div className="h-full flex flex-col relative">
      <Header
        captureState={captureState}
        onOpenSettings={() => setView("settings")}
      />
      <div className="flex-1 flex flex-col items-center justify-start p-6 gap-6 overflow-auto">
        <RecordButton
          captureState={captureState}
          onStart={() => void handleStart()}
          onStop={() => void handleStop()}
          disabled={needsInstall}
          busy={!!busy}
        />
        {captureState?.mode === "always-warm" && !captureState.recordingStart ? (
          <div className="text-xs text-neutral-500">
            Buffers last 60s — clip after the fact.
          </div>
        ) : null}
        {error ? (
          <div className="text-sm text-red-400 max-w-md text-center">{error}</div>
        ) : null}
        {busy ? (
          <div className="text-sm text-neutral-500">{busy}</div>
        ) : null}
        <div className="w-full max-w-md">
          <ReplayList
            replays={replays}
            onOpen={handleOpenPreview}
            onDelete={(id) => void handleDelete(id)}
          />
        </div>
      </div>
      {needsInstall ? (
        <InstallModal onDone={() => setNeedsInstall(false)} />
      ) : null}
      {view === "preview" && previewId ? (
        <PreviewPane replayId={previewId} onClose={() => setView("main")} />
      ) : null}
      {view === "settings" ? (
        <SettingsPane onClose={() => setView("main")} />
      ) : null}
    </div>
  );
}
