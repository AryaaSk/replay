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
    <div className="flex flex-col items-center gap-7">
      <div className="relative flex items-center justify-center">
        {/* Hairline pulse ring while recording — sharp, no glow.
            Suppressed during the busy/processing window so the user gets a
            clean transition the moment they click Stop. */}
        {recording && !busy ? (
          <span
            className="absolute rounded-full pointer-events-none animate-pulse-rec"
            style={{
              width: 168,
              height: 168,
              border: "1px solid rgba(232,78,27,0.55)",
            }}
          />
        ) : null}

        {/* THE BUTTON — flat solid disk, 1px hover ring, no gradients */}
        <button
          disabled={disabled || busy}
          onClick={recording ? onStop : onStart}
          aria-label={recording ? "Stop recording" : "Start recording"}
          className={[
            "group relative rounded-full transition-transform duration-150",
            "focus:outline-none focus-visible:ring-1 focus-visible:ring-bone/40 focus-visible:ring-offset-4 focus-visible:ring-offset-ink",
            disabled || busy ? "opacity-50 cursor-not-allowed" : "active:scale-[0.97]",
          ].join(" ")}
          style={{
            width: 144,
            height: 144,
            backgroundColor: "#E84E1B",
          }}
        >
          {/* Hairline ring that appears on hover — same vocabulary as .brackets */}
          <span
            className="absolute rounded-full pointer-events-none transition-opacity duration-150 opacity-0 group-hover:opacity-100"
            style={{
              inset: -8,
              border: "1px solid #E84E1B",
            }}
          />

          {/* Centered glyph. Priority: busy > recording > idle so the
              spinner appears immediately when the user clicks Stop, even
              while recording_start is still set during the flush window. */}
          <span className="absolute inset-0 flex items-center justify-center">
            {busy ? (
              <span
                className="block rounded-full border-2 border-bone/30 border-t-bone animate-spin"
                style={{ width: 26, height: 26 }}
              />
            ) : recording ? (
              <span
                className="block bg-bone"
                style={{ width: 32, height: 32 }}
              />
            ) : (
              <span
                className="block rounded-full bg-bone"
                style={{ width: 22, height: 22 }}
              />
            )}
          </span>
        </button>
      </div>

      {/* Caption — same priority order as the glyph: busy beats recording,
          so the timer freezes the instant the user clicks Stop instead of
          continuing to tick during the screenpipe flush.
          Caller passes busy=true during cold-spawn warmup too, so the
          caption reads "starting…" while screenpipe boots. */}
      <div className="text-center min-h-[2rem]">
        {busy ? (
          <div className="text-2xs uppercase tracking-[0.3em] text-ash animate-tick">
            ▮ {recording ? "processing" : "starting"}
          </div>
        ) : recording ? (
          <div className="font-mono text-3xl text-ember tabular-nums tracking-tight leading-none">
            {elapsed}
          </div>
        ) : (
          <div className="text-2xs uppercase tracking-[0.4em] text-ash">
            press to record
          </div>
        )}
      </div>
    </div>
  );
}
