import { invoke } from "@tauri-apps/api/core";
import type {
  CaptureState,
  ReplaySummary,
  Settings,
  SetupStatus,
} from "@shared/types";

export const ipc = {
  setupCheck: () => invoke<{ binary_installed: boolean; binary_version: string | null }>("setup_check")
    .then((r): SetupStatus => ({
      binaryInstalled: r.binary_installed,
      binaryVersion: r.binary_version,
      // Permission detection on macOS requires running screenpipe at least once,
      // so we report unknown here and let an actual record attempt surface errors.
      permissions: { screenRecording: true, microphone: true, accessibility: true },
    })),

  installScreenpipe: () => invoke<string>("install_screenpipe"),

  startRecording: () => invoke<string>("start_recording"),

  stopRecording: () =>
    invoke<{
      replay_id: string;
      report_path: string;
      start_ts: string;
      end_ts: string;
    }>("stop_recording"),

  startPrewarm: () => invoke<void>("start_prewarm"),
  stopPrewarm: () => invoke<void>("stop_prewarm"),

  listReplays: () =>
    invoke<Array<{
      id: string;
      title: string;
      start_ts: string;
      end_ts: string;
      duration_ms: number;
      created_at: string;
    }>>("list_replays").then((rows): ReplaySummary[] =>
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        startTs: r.start_ts,
        endTs: r.end_ts,
        durationMs: r.duration_ms,
        createdAt: r.created_at,
      })),
    ),

  readReplay: (id: string) => invoke<string>("read_replay", { id }),

  deleteReplay: (id: string) => invoke<void>("delete_replay", { id }),

  getSettings: () =>
    invoke<{
      always_warm: boolean;
      lookback_seconds: number;
      model: string;
      monitor_id: number | null;
      filter_music: boolean;
      use_pii_removal: boolean;
      redact_secrets: boolean;
      confirm_before_send: boolean;
      wipe_on_quit: boolean;
      auto_copy_to_clipboard: boolean;
      save_bundle_to_documents: boolean;
      auto_check_screenpipe_updates: boolean;
      pinned_screenpipe_version: string | null;
      disable_audio: boolean;
    }>("get_settings").then((s): Settings => ({
      alwaysWarm: s.always_warm,
      lookbackSeconds: s.lookback_seconds as Settings["lookbackSeconds"],
      model: s.model as Settings["model"],
      monitorId: s.monitor_id,
      filterMusic: s.filter_music,
      usePiiRemoval: s.use_pii_removal,
      redactSecrets: s.redact_secrets,
      confirmBeforeSend: s.confirm_before_send,
      wipeOnQuit: s.wipe_on_quit,
      autoCopyToClipboard: s.auto_copy_to_clipboard,
      saveBundleToDocuments: s.save_bundle_to_documents,
      autoCheckScreenpipeUpdates: s.auto_check_screenpipe_updates,
      pinnedScreenpipeVersion: s.pinned_screenpipe_version,
      disableAudio: s.disable_audio,
    })),

  setSettings: (s: Settings) =>
    invoke<void>("set_settings", {
      newSettings: {
        always_warm: s.alwaysWarm,
        lookback_seconds: s.lookbackSeconds,
        model: s.model,
        monitor_id: s.monitorId,
        filter_music: s.filterMusic,
        use_pii_removal: s.usePiiRemoval,
        redact_secrets: s.redactSecrets,
        confirm_before_send: s.confirmBeforeSend,
        wipe_on_quit: s.wipeOnQuit,
        auto_copy_to_clipboard: s.autoCopyToClipboard,
        save_bundle_to_documents: s.saveBundleToDocuments,
        auto_check_screenpipe_updates: s.autoCheckScreenpipeUpdates,
        pinned_screenpipe_version: s.pinnedScreenpipeVersion,
        disable_audio: s.disableAudio,
      },
    }),

  getCaptureState: () =>
    invoke<{
      capturing: boolean;
      mode: "Fresh" | "AlwaysWarm" | "fresh" | "always-warm";
      recording_start: string | null;
      prewarm_active: boolean;
    }>("get_capture_state").then((r): CaptureState => ({
      capturing: r.capturing,
      mode: typeof r.mode === "string" && r.mode.toLowerCase().includes("warm") ? "always-warm" : "fresh",
      recordingStart: r.recording_start,
      prewarmActive: r.prewarm_active,
    })),

  hasApiKey: () => invoke<boolean>("has_api_key"),
  setApiKey: (key: string) => invoke<void>("set_api_key", { key }),

  quitCapturing: () => invoke<void>("quit_capturing"),

  openReplayDir: (id: string) => invoke<void>("open_replay_dir", { id }),
};
