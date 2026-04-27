import { useEffect, useState } from "react";
import type { CaptureState } from "@shared/types";

interface Props {
  captureState: CaptureState | null;
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  busy?: boolean;
}

const SIZE = 200;            // viewbox + container
const CENTER = SIZE / 2;
const RIM_R = 90;            // outer hairline rim radius
const TICK_INNER = 76;       // tick start radius
const TICK_MAJOR = 86;       // major tick end radius
const TICK_MINOR = 82;       // minor tick end radius
const BUTTON_R = 64;         // inner button radius
const ORB_R = 22;            // ember orb radius

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
      <div
        className="relative flex items-center justify-center"
        style={{ width: SIZE, height: SIZE }}
      >
        {/* Bezel: outer hairline rim + 12 instrument ticks */}
        <svg
          className="absolute inset-0 pointer-events-none"
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          fill="none"
        >
          {/* Two concentric hairline rings — outer (faint) + inner rim (slightly stronger) */}
          <circle cx={CENTER} cy={CENTER} r={RIM_R} stroke="#262320" strokeWidth="1" />
          <circle cx={CENTER} cy={CENTER} r={TICK_INNER - 4} stroke="#262320" strokeWidth="1" />

          {/* Cardinal & sub-cardinal ticks */}
          {Array.from({ length: 12 }).map((_, i) => {
            const angle = (i / 12) * Math.PI * 2 - Math.PI / 2;
            const major = i % 3 === 0;
            const innerR = TICK_INNER;
            const outerR = major ? TICK_MAJOR : TICK_MINOR;
            const x1 = CENTER + Math.cos(angle) * innerR;
            const y1 = CENTER + Math.sin(angle) * innerR;
            const x2 = CENTER + Math.cos(angle) * outerR;
            const y2 = CENTER + Math.sin(angle) * outerR;
            const stroke =
              recording && major
                ? "#E84E1B"
                : major
                ? "#9A938A"
                : "#4A453F";
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={stroke}
                strokeWidth={major ? 1.5 : 1}
                strokeLinecap="round"
              />
            );
          })}

          {/* Tiny "REC" label tucked above the 12 o'clock major tick */}
          <text
            x={CENTER}
            y={CENTER - TICK_MAJOR - 5}
            textAnchor="middle"
            fontSize="8"
            fontFamily="JetBrains Mono, monospace"
            letterSpacing="2"
            fill={recording ? "#E84E1B" : "#4A453F"}
          >
            REC
          </text>
        </svg>

        {/* Pulse ring (only when recording) — sits behind the button */}
        {recording ? (
          <span
            className="absolute rounded-full pointer-events-none animate-pulse-rec"
            style={{
              width: BUTTON_R * 2 + 12,
              height: BUTTON_R * 2 + 12,
              border: "1px solid rgba(232,78,27,0.35)",
            }}
          />
        ) : null}

        {/* Inner button — the tactile control */}
        <button
          disabled={disabled || busy}
          onClick={recording ? onStop : onStart}
          className={[
            "relative flex items-center justify-center rounded-full transition-all duration-150",
            "border focus:outline-none focus-visible:ring-2 focus-visible:ring-bone/40",
            recording ? "border-ember/60" : "border-rule hover:border-grit",
            disabled || busy ? "opacity-50 cursor-not-allowed" : "active:scale-[0.97]",
          ].join(" ")}
          style={{
            width: BUTTON_R * 2,
            height: BUTTON_R * 2,
            background: recording
              ? "radial-gradient(circle at 50% 35%, rgba(232,78,27,0.18) 0%, rgba(232,78,27,0.04) 60%, #16140F 100%)"
              : "radial-gradient(circle at 50% 30%, #2B2826 0%, #1A1714 55%, #110F0C 100%)",
            boxShadow: recording
              ? "inset 0 1px 2px rgba(0,0,0,0.4), inset 0 -1px 0 rgba(232,78,27,0.15), 0 0 32px rgba(232,78,27,0.18)"
              : "inset 0 1px 2px rgba(0,0,0,0.5), inset 0 -1px 0 rgba(255,255,255,0.04), 0 1px 0 rgba(0,0,0,0.4)",
          }}
        >
          {/* Hairline inset ring — gives the button a recessed dish feel */}
          <span
            className="absolute rounded-full pointer-events-none"
            style={{
              inset: 6,
              border: "1px solid rgba(255,255,255,0.03)",
            }}
          />

          {recording ? (
            // Stop square — refined with a subtle inner gradient
            <span
              className="block"
              style={{
                width: 24,
                height: 24,
                background:
                  "linear-gradient(180deg, #FF6B3D 0%, #E84E1B 60%, #B73914 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.2), inset 0 -1px 0 rgba(0,0,0,0.25), 0 0 16px rgba(232,78,27,0.5)",
              }}
            />
          ) : busy ? (
            <span
              className="block rounded-full border-2 border-rule border-t-bone animate-spin"
              style={{ width: 22, height: 22 }}
            />
          ) : (
            // Idle: ember orb with radial gradient + soft glow
            <span
              className="block rounded-full"
              style={{
                width: ORB_R * 2,
                height: ORB_R * 2,
                background:
                  "radial-gradient(circle at 35% 28%, #FF8B5C 0%, #E84E1B 45%, #B73914 100%)",
                boxShadow:
                  "inset 0 -2px 4px rgba(0,0,0,0.35), inset 0 1px 1px rgba(255,255,255,0.25), 0 0 24px rgba(232,78,27,0.22), 0 0 1px rgba(232,78,27,0.6)",
              }}
            />
          )}
        </button>
      </div>

      {/* Caption */}
      <div className="text-center min-h-[2rem]">
        {recording ? (
          <div className="font-mono text-3xl text-ember tabular-nums tracking-tight leading-none">
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
