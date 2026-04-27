import { ipc } from "../lib/ipc";
import type { ReplaySummary } from "@shared/types";

interface Props {
  open: boolean;
  replays: ReplaySummary[];
  onClose: () => void;
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

export function Sidebar({ open, replays, onClose, onOpen, onDelete }: Props) {
  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden
        className={[
          "absolute inset-0 bg-ink/60 backdrop-blur-[2px] transition-opacity duration-200 z-20",
          open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        ].join(" ")}
      />

      {/* Drawer */}
      <aside
        className={[
          "absolute top-0 left-0 bottom-0 w-[360px] bg-carbon border-r border-rule z-30",
          "flex flex-col transition-transform duration-250 ease-out",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div className="h-12 flex items-center justify-between px-4 border-b border-rule shrink-0">
          <button
            onClick={onClose}
            aria-label="Close ledger"
            className="text-ash hover:text-bone text-xl leading-none"
          >
            ‹
          </button>
          <div className="flex items-baseline gap-3">
            <span className="text-2xs uppercase tracking-[0.3em] text-dust">ledger</span>
            <span className="font-mono text-xs text-ash">
              {String(replays.length).padStart(3, "0")} entries
            </span>
          </div>
          <button
            onClick={() => void ipc.openAppFolder("replays")}
            aria-label="Open replays folder in Finder"
            title="Open replays folder"
            className="text-ash hover:text-bone text-base leading-none"
          >
            ↗
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {replays.length === 0 ? (
            <div className="p-6 text-center">
              <div className="text-2xs uppercase tracking-[0.3em] text-dust">empty</div>
              <div className="text-xs text-ash mt-2">no replays captured yet</div>
            </div>
          ) : (
            <div>
              {replays.map((r) => (
                <div key={r.id} className="ledger-row group flex items-baseline gap-3 px-4">
                  <button
                    onClick={() => onOpen(r.id)}
                    className="flex-1 text-left flex items-baseline gap-3 min-w-0"
                  >
                    <span className="font-mono text-2xs text-dust group-hover:text-ash shrink-0">
                      {shortId(r.id)}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-bone truncate">
                        {r.title || "(untitled)"}
                      </div>
                      <div className="flex items-baseline gap-2 mt-0.5">
                        <span className="font-mono text-2xs text-ash tabular-nums">
                          {fmtDuration(r.durationMs)}
                        </span>
                        <span className="text-2xs text-dust">·</span>
                        <span className="font-mono text-2xs text-dust tabular-nums">
                          {fmtTime(r.createdAt)}
                        </span>
                      </div>
                    </div>
                  </button>
                  <button
                    onClick={() => onDelete(r.id)}
                    className="text-dust hover:text-ember text-sm leading-none px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Delete replay"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
