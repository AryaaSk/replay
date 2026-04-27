import { invoke } from "@tauri-apps/api/core";
import type {
  AgentStatus,
  CaptureState,
  PermissionKind,
  PermissionsReport,
  PermissionStatus,
  Provider,
  ReplayDetail,
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

  readReplayDetail: (id: string) =>
    invoke<{
      id: string;
      title: string;
      start_ts: string;
      end_ts: string;
      duration_ms: number;
      created_at: string;
      model: string;
      provider: string;
      estimated_cost_usd: number;
      frame_files: string[];
      bundle_path: string;
      report_present: boolean;
    }>("read_replay_detail", { id }).then((r): ReplayDetail => ({
      id: r.id,
      title: r.title,
      startTs: r.start_ts,
      endTs: r.end_ts,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
      model: r.model,
      provider: r.provider,
      estimatedCostUSD: r.estimated_cost_usd,
      frameFiles: r.frame_files,
      bundlePath: r.bundle_path,
      reportPresent: r.report_present,
    })),

  readReplayFrame: (id: string, filename: string) =>
    invoke<number[]>("read_replay_frame", { id, filename }).then((bytes) => {
      const u8 = new Uint8Array(bytes);
      const blob = new Blob([u8], { type: "image/png" });
      return URL.createObjectURL(blob);
    }),

  deleteReplay: (id: string) => invoke<void>("delete_replay", { id }),

  deleteAllReplays: () => invoke<number>("delete_all_replays"),

  wipeAllState: () => invoke<void>("wipe_all_state"),

  getSettings: () =>
    invoke<{
      always_warm: boolean;
      lookback_seconds: number;
      provider: string;
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
      provider: (
        s.provider === "openai" || s.provider === "local-claude" || s.provider === "local-codex"
          ? s.provider
          : "anthropic"
      ) as Provider,
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
        provider: s.provider,
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

  hasApiKey: (provider: Provider) => invoke<boolean>("has_api_key", { provider }),
  setApiKey: (provider: Provider, key: string) =>
    invoke<void>("set_api_key", { provider, key }),

  agentStatus: () => invoke<AgentStatus>("agent_status"),

  checkPermissions: () =>
    invoke<{
      screen_recording: PermissionStatus;
      microphone: PermissionStatus;
      accessibility: PermissionStatus;
      fresh: boolean;
    }>("check_permissions").then((r): PermissionsReport => ({
      screenRecording: r.screen_recording,
      microphone: r.microphone,
      accessibility: r.accessibility,
      fresh: r.fresh,
    })),

  openPermissionSettings: (kind: PermissionKind) =>
    invoke<void>("open_permission_settings", { kind }),

  quitCapturing: () => invoke<void>("quit_capturing"),

  openReplayDir: (id: string) => invoke<void>("open_replay_dir", { id }),

  openAppFolder: (kind: "root" | "replays" | "screenpipe" | "logs") =>
    invoke<void>("open_app_folder", { kind }),
};
