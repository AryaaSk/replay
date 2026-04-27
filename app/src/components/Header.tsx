import type { CaptureState } from "@shared/types";

interface Props {
  captureState: CaptureState | null;
  onOpenSettings: () => void;
}

export function Header({ captureState, onOpenSettings }: Props) {
  const mode = captureState?.mode ?? "fresh";
  const capturing = captureState?.capturing ?? false;

  return (
    <div className="titlebar h-12 flex items-stretch justify-between border-b border-rule bg-carbon/40 select-none">
      {/* Left: brand mark + REC indicator */}
      <div className="flex items-center gap-3 pl-4 pr-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-sm font-semibold tracking-tight text-bone">
            replay
          </span>
          <span className="font-mono text-2xs text-dust">v0.1</span>
        </div>
        {capturing ? (
          <div className="chip chip-live animate-pulse-rec">
            <span className="w-1.5 h-1.5 rounded-full bg-ember" />
            REC
          </div>
        ) : null}
      </div>

      {/* Right: single button — mode chip + settings icon merged */}
      <button
        onClick={onOpenSettings}
        aria-label="Open settings"
        title="Open settings"
        className="flex items-center gap-3 px-4 border-l border-rule text-ash hover:text-bone hover:bg-char transition-colors group"
      >
        <span className="text-2xs uppercase tracking-widest text-dust group-hover:text-ash">
          mode
        </span>
        <span className="text-xs text-bone">
          {mode === "always-warm" ? "warm" : "fresh"}
        </span>
        <span className="text-grit group-hover:text-rule transition-colors">·</span>
        <SettingsIcon />
      </button>
    </div>
  );
}

function SettingsIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1v3M12 20v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M1 12h3M20 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" />
    </svg>
  );
}
