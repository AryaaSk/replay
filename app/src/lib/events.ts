import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CaptureState, InstallProgress, SidecarEvent } from "@shared/types";

export async function onCaptureStateChanged(
  cb: (s: CaptureState) => void,
): Promise<UnlistenFn> {
  return listen<{
    capturing: boolean;
    mode: "Fresh" | "AlwaysWarm" | "fresh" | "always-warm";
    recording_start: string | null;
    prewarm_active: boolean;
  }>("capture-state-changed", (e) => {
    const m = String(e.payload.mode).toLowerCase();
    cb({
      capturing: e.payload.capturing,
      mode: m.includes("warm") ? "always-warm" : "fresh",
      recordingStart: e.payload.recording_start,
      prewarmActive: e.payload.prewarm_active,
    });
  });
}

export async function onInstallProgress(
  cb: (p: InstallProgress) => void,
): Promise<UnlistenFn> {
  return listen<Record<string, unknown>>("install-progress", (e) => {
    const p = e.payload as Record<string, unknown>;
    const phase = String(p["phase"] ?? "");
    const message = String(p["message"] ?? "");
    cb({
      phase: phase as InstallProgress["phase"],
      bytesReceived: typeof p["bytes_received"] === "number" ? p["bytes_received"] : undefined,
      totalBytes: typeof p["total_bytes"] === "number" ? p["total_bytes"] : undefined,
      message,
    });
  });
}

export async function onSidecarStatus(
  cb: (e: SidecarEvent) => void,
): Promise<UnlistenFn> {
  return listen<{ line: string }>("sidecar-status", (e) => {
    try {
      const parsed = JSON.parse(e.payload.line);
      cb(parsed as SidecarEvent);
    } catch {
      // ignore non-JSON lines
    }
  });
}

export async function onCaptureStoppedFromTray(
  cb: () => void,
): Promise<UnlistenFn> {
  return listen("capture-stopped-from-tray", () => cb());
}

export async function onTrayRecordToggle(
  cb: () => void,
): Promise<UnlistenFn> {
  return listen("tray-record-toggle", () => cb());
}

export async function onRenderComplete(
  cb: (payload: { initialId: string; finalId: string; reportPath: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ initialId: string; finalId: string; reportPath: string }>(
    "render-complete",
    (e) => cb(e.payload),
  );
}

export async function onRenderError(
  cb: (payload: { initialId: string; error: string }) => void,
): Promise<UnlistenFn> {
  return listen<{ initialId: string; error: string }>(
    "render-error",
    (e) => cb(e.payload),
  );
}
