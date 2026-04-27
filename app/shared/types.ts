// Shared types — referenced by frontend (TS) and sidecar (TS).
// Rust types are mirrored manually in src-tauri/src/state.rs.

export type CaptureMode = "fresh" | "always-warm";

export type LookbackSeconds = 30 | 60 | 120 | 300;

export type ModelChoice = "claude-sonnet-4-6" | "claude-haiku-4-5" | "claude-opus-4-7";

export interface CaptureState {
  capturing: boolean;
  mode: CaptureMode;
  recordingStart: string | null; // ISO 8601, null when not recording
  prewarmActive: boolean;
}

export interface SetupStatus {
  binaryInstalled: boolean;
  binaryVersion: string | null;
  permissions: {
    screenRecording: boolean;
    microphone: boolean;
    accessibility: boolean;
  };
}

export interface InstallProgress {
  phase: "fetch_release" | "download" | "verify" | "install" | "smoke" | "done";
  bytesReceived?: number;
  totalBytes?: number;
  message: string;
}

export interface Settings {
  alwaysWarm: boolean;
  lookbackSeconds: LookbackSeconds;
  model: ModelChoice;
  monitorId: number | null; // null = all monitors
  filterMusic: boolean;
  usePiiRemoval: boolean;
  redactSecrets: boolean;
  confirmBeforeSend: boolean;
  wipeOnQuit: boolean;
  autoCopyToClipboard: boolean;
  saveBundleToDocuments: boolean;
  autoCheckScreenpipeUpdates: boolean;
  pinnedScreenpipeVersion: string | null;
  disableAudio: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  alwaysWarm: false,
  lookbackSeconds: 60,
  model: "claude-sonnet-4-6",
  monitorId: null,
  filterMusic: true,
  usePiiRemoval: true,
  redactSecrets: true,
  confirmBeforeSend: true,
  wipeOnQuit: true,
  autoCopyToClipboard: true,
  saveBundleToDocuments: false,
  autoCheckScreenpipeUpdates: true,
  pinnedScreenpipeVersion: null,
  disableAudio: false,
};

export interface ReplayMetadata {
  id: string;
  title: string;
  startTs: string;
  endTs: string;
  durationMs: number;
  createdAt: string;
  device: {
    machineName: string;
    macosVersion: string;
  };
  capture: {
    mode: CaptureMode;
    lookbackSeconds: number;
    monitor: string | "all";
  };
  redactions: {
    textMatches: number;
    imageBlurs: number;
    rulesApplied: string[];
  };
  api: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    estimatedCostUSD: number;
  };
  frames: Array<{ filename: string; relativeMs: number }>;
}

export interface ReplaySummary {
  id: string;
  title: string;
  startTs: string;
  endTs: string;
  durationMs: number;
  createdAt: string;
}

// Sidecar status events streamed over stdout, one JSON object per line.
export type SidecarEvent =
  | { event: "reading_db"; rows: number }
  | { event: "coalesced"; events: number }
  | { event: "frames_picked"; count: number }
  | { event: "redactions"; text: number; image: number }
  | { event: "calling_anthropic"; model: string }
  | { event: "complete"; replayId: string; reportPath: string; durationMs: number }
  | { event: "error"; message: string };
