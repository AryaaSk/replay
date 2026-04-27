import type { CaptureState } from "@shared/types";

interface Props {
  captureState: CaptureState | null;
  onOpenSettings: () => void;
}

export function Header({ captureState, onOpenSettings }: Props) {
  const mode = captureState?.mode ?? "fresh";
  const capturing = captureState?.capturing ?? false;
  return (
    <div className="titlebar h-12 flex items-center justify-between px-4 border-b border-neutral-800 bg-neutral-900/60">
      <div className="flex items-center gap-3">
        <div className="font-semibold tracking-tight">Replay</div>
        <button
          onClick={onOpenSettings}
          className="text-xs text-neutral-400 hover:text-neutral-100 transition-colors"
        >
          Mode: {mode === "always-warm" ? "Always warm" : "Fresh each recording"}
        </button>
        {capturing ? (
          <div className="flex items-center gap-1.5 text-xs text-red-400">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse-slow" />
            capturing
          </div>
        ) : null}
      </div>
      <button
        onClick={onOpenSettings}
        aria-label="Open settings"
        className="text-neutral-300 hover:text-neutral-100 transition-colors text-2xl leading-none px-2 py-1"
      >
        ⚙
      </button>
    </div>
  );
}
