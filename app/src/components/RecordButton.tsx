import { useEffect, useState } from "react";
import type { CaptureState } from "@shared/types";

interface Props {
  captureState: CaptureState | null;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  busy?: boolean;
}

export function RecordButton({ captureState, onStart, onStop, disabled, busy }: Props) {
  const recording = captureState?.recordingStart != null;
  const [elapsed, setElapsed] = useState("00:00");

  useEffect(() => {
    if (!recording || !captureState?.recordingStart) {
      setElapsed("00:00");
      return;
    }
    const start = new Date(captureState.recordingStart).getTime();
    const tick = () => {
      const ms = Date.now() - start;
      const s = Math.max(0, Math.floor(ms / 1000));
      const mm = String(Math.floor(s / 60)).padStart(2, "0");
      const ss = String(s % 60).padStart(2, "0");
      setElapsed(`${mm}:${ss}`);
    };
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [recording, captureState?.recordingStart]);

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        disabled={disabled || busy}
        onClick={recording ? onStop : onStart}
        className={[
          "relative w-32 h-32 rounded-full transition-all flex items-center justify-center",
          "border-2",
          recording
            ? "bg-red-600/20 border-red-500 hover:bg-red-600/30"
            : "bg-neutral-800/40 border-neutral-700 hover:border-red-500 hover:bg-red-600/10",
          disabled || busy ? "opacity-50 cursor-not-allowed" : "cursor-pointer",
        ].join(" ")}
      >
        {recording ? (
          <div className="w-10 h-10 rounded-md bg-red-500" />
        ) : busy ? (
          <div className="w-10 h-10 rounded-full border-4 border-neutral-700 border-t-neutral-300 animate-spin" />
        ) : (
          <div className="w-12 h-12 rounded-full bg-red-500" />
        )}
        {recording ? (
          <div className="absolute -top-2 -right-2 w-4 h-4 rounded-full bg-red-500 animate-pulse" />
        ) : null}
      </button>
      <div className="text-sm">
        {recording ? (
          <span className="text-red-400 tabular-nums font-mono">● {elapsed}</span>
        ) : busy ? (
          <span className="text-neutral-400">processing…</span>
        ) : (
          <span className="text-neutral-400">Click to record</span>
        )}
      </div>
    </div>
  );
}
