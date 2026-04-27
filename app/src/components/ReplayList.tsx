import type { ReplaySummary } from "@shared/types";

interface Props {
  replays: ReplaySummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${String(s).padStart(2, "0")}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}m${String(r).padStart(2, "0")}s`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, { month: "short", day: "2-digit" }).toUpperCase();
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date} · ${time}`;
}

function shortId(id: string): string {
  return id.slice(-6).toLowerCase();
}

export function ReplayList({ replays, onOpen, onDelete }: Props) {
  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-2 px-1">
        <div className="text-2xs uppercase tracking-[0.25em] text-dust">
          ledger · {String(replays.length).padStart(3, "0")}
        </div>
        <div className="text-2xs uppercase tracking-[0.25em] text-dust">
          dur · stamp
        </div>
      </div>
      {replays.length === 0 ? (
        <div className="border border-dashed border-rule py-8 text-center">
          <div className="text-xs text-ash">no replays yet</div>
          <div className="text-2xs uppercase tracking-widest text-dust mt-1">
            press record to capture
          </div>
        </div>
      ) : (
        <div className="border-t border-rule">
          {replays.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="ledger-row w-full text-left group"
            >
              <span className="font-mono text-2xs text-dust w-12 group-hover:text-ash">
                {shortId(r.id)}
              </span>
              <span className="flex-1 text-xs text-bone truncate group-hover:text-bone">
                {r.title || "(untitled)"}
              </span>
              <span className="font-mono text-2xs text-ash tabular-nums">
                {fmtDuration(r.durationMs)}
              </span>
              <span className="font-mono text-2xs text-dust tabular-nums">
                {fmtTime(r.createdAt)}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(r.id);
                }}
                className="text-dust hover:text-ember text-xs px-1"
                title="Delete"
              >
                ×
              </button>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
