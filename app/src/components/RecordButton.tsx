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
  const [elapsed, setElapsed] = useState("00:00.0");

  useEffect(() => {
    if (!recording || !captureState?.recordingStart) {
      setElapsed("00:00.0");
      return;
    }
    const start = new Date(captureState.recordingStart).getTime();
    const tick = () => {
      const ms = Math.max(0, Date.now() - start);
      const cs = Math.floor(ms / 100);
      const mm = String(Math.floor(cs / 600)).padStart(2, "0");
      const ss = String(Math.floor(cs / 10) % 60).padStart(2, "0");
      const tenths = cs % 10;
      setElapsed(`${mm}:${ss}.${tenths}`);
    };
    tick();
    const id = setInterval(tick, 100);
    return () => clearInterval(id);
  }, [recording, captureState?.recordingStart]);

  return (
    <div className="flex flex-col items-center gap-5">
      {/* Outer "instrument bezel" — twelve subtle tick marks around the button */}
      <div className="relative w-36 h-36 flex items-center justify-center">
        {Array.from({ length: 12 }).map((_, i) => {
          const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
          const r = 70;
          const x = 72 + Math.cos(angle) * r;
          const y = 72 + Math.sin(angle) * r;
          const major = i % 3 === 0;
          return (
            <span
              key={i}
              className={[
                "absolute rounded-full",
                major ? "w-1 h-1" : "w-0.5 h-0.5",
                recording && i % 3 === 0 ? "bg-ember" : "bg-grit",
              ].join(" ")}
              style={{ left: `${x}px`, top: `${y}px`, transform: "translate(-50%,-50%)" }}
            />
          );
        })}

        <button
          disabled={disabled || busy}
          onClick={recording ? onStop : onStart}
          className={[
            "relative w-28 h-28 rounded-full flex items-center justify-center transition-all duration-150",
            "border bg-gradient-to-b",
            recording
              ? "border-ember from-ember/20 to-ember/5 hover:from-ember/25 hover:to-ember/10"
              : "border-rule from-carbon to-ink hover:border-bone",
            disabled || busy ? "opacity-40 cursor-not-allowed" : "active:scale-[0.98]",
          ].join(" ")}
        >
          {recording ? (
            <>
              <span className="absolute inset-2 rounded-full border border-ember/30 animate-pulse-rec" />
              <span className="w-9 h-9 bg-ember rounded-sm" />
            </>
          ) : busy ? (
            <span className="w-8 h-8 rounded-full border-2 border-rule border-t-bone animate-spin" />
          ) : (
            <span className="w-12 h-12 rounded-full bg-ember shadow-[inset_0_-2px_4px_rgba(0,0,0,0.3),0_0_24px_rgba(232,78,27,0.15)]" />
          )}
        </button>
      </div>

      <div className="text-center">
        {recording ? (
          <div className="font-mono text-3xl text-ember tabular-nums tracking-tight">
            {elapsed}
          </div>
        ) : busy ? (
          <div className="text-2xs uppercase tracking-[0.3em] text-ash animate-tick">
            ▮ processing
          </div>
        ) : (
          <div className="text-2xs uppercase tracking-[0.3em] text-ash">
            press to record
          </div>
        )}
      </div>
    </div>
  );
}
