import type { ReplaySummary } from "@shared/types";

interface Props {
  replays: ReplaySummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${r ? ` ${r}s` : ""}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
}

export function ReplayList({ replays, onOpen, onDelete }: Props) {
  if (replays.length === 0) {
    return (
      <div className="text-sm text-neutral-500 text-center py-6">
        No replays yet. Hit Record to capture one.
      </div>
    );
  }
  return (
    <div className="flex flex-col divide-y divide-neutral-800">
      <div className="text-xs uppercase tracking-wider text-neutral-500 px-2 py-1">
        Recent replays
      </div>
      {replays.map((r) => (
        <div
          key={r.id}
          className="flex items-center justify-between px-2 py-2 hover:bg-neutral-900 transition-colors"
        >
          <button
            onClick={() => onOpen(r.id)}
            className="flex-1 text-left flex items-center gap-3"
          >
            <div className="text-sm flex-1 truncate">{r.title || "(untitled)"}</div>
            <div className="text-xs text-neutral-500 tabular-nums">
              {fmtDuration(r.durationMs)} · {fmtTime(r.createdAt)}
            </div>
          </button>
          <button
            onClick={() => onDelete(r.id)}
            className="text-xs text-neutral-600 hover:text-red-400 ml-3"
            title="Delete"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
