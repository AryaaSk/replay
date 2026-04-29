// Shared types — referenced by frontend (TS) and sidecar (TS).
// Rust types are mirrored manually in src-tauri/src/state.rs.

export type CaptureMode = "fresh" | "always-warm";

export type LookbackSeconds = 30 | 60 | 120 | 300;

export type Provider = "anthropic" | "openai" | "local-claude" | "local-codex";

export type AnthropicModel = "claude-sonnet-4-6" | "claude-haiku-4-5" | "claude-opus-4-7";
export type OpenAIModel = "gpt-5" | "gpt-5-mini" | "gpt-4.1";
export type ModelChoice = AnthropicModel | OpenAIModel | "";

export const PROVIDER_LABELS: Record<Provider, string> = {
  "anthropic": "Anthropic Claude (BYOK)",
  "openai": "OpenAI GPT (BYOK)",
  "local-claude": "Local Claude Code",
  "local-codex": "Local Codex CLI",
};

export const PROVIDER_REQUIRES_KEY: Record<Provider, "anthropic" | "openai" | null> = {
  "anthropic": "anthropic",
  "openai": "openai",
  "local-claude": null,
  "local-codex": null,
};

export interface AgentInfo {
  installed: boolean;
  path: string | null;
  version: string | null;
}

export interface AgentStatus {
  claude: AgentInfo;
  codex: AgentInfo;
}

export type PermissionStatus = "ok" | "denied" | "unknown";

export interface PermissionsReport {
  screenRecording: PermissionStatus;
  microphone: PermissionStatus;
  accessibility: PermissionStatus;
  fresh: boolean;
}

export type PermissionKind = "screen-recording" | "microphone" | "accessibility";

export const ANTHROPIC_MODELS: ReadonlyArray<{ id: AnthropicModel; label: string }> = [
  { id: "claude-sonnet-4-6", label: "claude-sonnet-4-6 (recommended)" },
  { id: "claude-haiku-4-5", label: "claude-haiku-4-5 (cheaper)" },
  { id: "claude-opus-4-7", label: "claude-opus-4-7 (best quality)" },
];
export const OPENAI_MODELS: ReadonlyArray<{ id: OpenAIModel; label: string }> = [
  { id: "gpt-5", label: "gpt-5 (recommended)" },
  { id: "gpt-5-mini", label: "gpt-5-mini (cheaper)" },
  { id: "gpt-4.1", label: "gpt-4.1 (legacy)" },
];

export const DEFAULT_MODEL_FOR: Record<Provider, ModelChoice> = {
  "anthropic": "claude-sonnet-4-6",
  "openai": "gpt-5",
  "local-claude": "",
  "local-codex": "",
};

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

export interface MonitorInfo {
  id: number;
  name: string;
  width: number;
  height: number;
  isDefault: boolean;
}

export interface Settings {
  alwaysWarm: boolean;
  lookbackSeconds: LookbackSeconds;
  provider: Provider;
  model: ModelChoice;
  monitorIds: number[]; // empty = all monitors
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
  provider: "local-claude",
  model: "",
  monitorIds: [],
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

export interface ReplayDetail {
  id: string;
  title: string;
  startTs: string;
  endTs: string;
  durationMs: number;
  createdAt: string;
  model: string;
  provider: string;
  estimatedCostUSD: number;
  frameFiles: string[];
  bundlePath: string;
  reportPresent: boolean;
  processing: boolean;
  eventsBytes: number;
  audioBytes: number;
  contextBytes: number;
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
