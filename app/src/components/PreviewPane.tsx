import { useEffect, useMemo, useState } from "react";
import { ipc } from "../lib/ipc";
import {
  onRenderComplete,
  onRenderError,
  onSidecarStatus,
} from "../lib/events";
import type { ReplayDetail, SidecarEvent } from "@shared/types";

interface Props {
  replayId: string;
  onClose: () => void;
  onIdChange?: (newId: string) => void;
}

function fmtBytes(n: number): string {
  if (n === 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtClock(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).toUpperCase();
}

function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function PreviewPane({ replayId, onClose, onIdChange }: Props) {
  const [markdown, setMarkdown] = useState<string>("");
  const [detail, setDetail] = useState<ReplayDetail | null>(null);
  const [frameUrls, setFrameUrls] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [statusFeed, setStatusFeed] = useState<SidecarEvent[]>([]);
  const [renderError, setRenderError] = useState<string | null>(null);

  // Reload detail + report on mount, on replayId change, and after render-complete.
  const reload = (id: string) => {
    void ipc.readReplayDetail(id).then(setDetail);
    void ipc
      .readReplay(id)
      .then(setMarkdown)
      .catch(() => setMarkdown("")); // report.md may not exist yet during processing
  };

  useEffect(() => {
    setMarkdown("");
    setDetail(null);
    setStatusFeed([]);
    setRenderError(null);
    reload(replayId);
  }, [replayId]);

  // Subscribe to sidecar status + render-complete / render-error so we can
  // (a) show progress while we wait and (b) refresh once the render lands.
  useEffect(() => {
    let unsubStatus: (() => void) | undefined;
    let unsubComplete: (() => void) | undefined;
    let unsubError: (() => void) | undefined;
    (async () => {
      unsubStatus = await onSidecarStatus((evt) => {
        setStatusFeed((prev) => [...prev.slice(-9), evt]);
      });
      unsubComplete = await onRenderComplete(({ initialId, finalId }) => {
        if (initialId === replayId || finalId === replayId) {
          setStatusFeed([]);
          setRenderError(null);
          if (initialId !== finalId && initialId === replayId) {
            onIdChange?.(finalId);
          } else {
            reload(replayId);
          }
        }
      });
      unsubError = await onRenderError(({ initialId, error: msg }) => {
        if (initialId === replayId) {
          setRenderError(msg);
          reload(replayId);
        }
      });
    })();
    return () => {
      unsubStatus?.();
      unsubComplete?.();
      unsubError?.();
    };
  }, [replayId, onIdChange]);

  // Lazy-load frame blobs once we know which files exist.
  useEffect(() => {
    if (!detail) return;
    let cancelled = false;
    const urls: Record<string, string> = {};
    (async () => {
      for (const f of detail.frameFiles) {
        try {
          const url = await ipc.readReplayFrame(replayId, f);
          if (cancelled) {
            URL.revokeObjectURL(url);
            continue;
          }
          urls[f] = url;
          setFrameUrls({ ...urls });
        } catch {
          /* skip individual failures */
        }
      }
    })();
    return () => {
      cancelled = true;
      Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    };
  }, [detail, replayId]);

  // Replace `![alt](frames/01-x.png)` references with object URLs at render time.
  const markdownWithFrames = useMemo(() => {
    if (!markdown) return "";
    return markdown.replace(/!\[([^\]]*)\]\(frames\/([^)]+)\)/g, (full, alt: string, file: string) => {
      const u = frameUrls[file];
      return u ? `![${alt}](${u})` : full;
    });
  }, [markdown, frameUrls]);

  const onCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="absolute inset-0 bg-ink flex flex-col animate-fade-in">
      <div className="titlebar h-12 flex items-center justify-between px-4 border-b border-rule bg-carbon/40 select-none shrink-0">
        <div className="flex items-baseline gap-3 min-w-0">
          <button onClick={onClose} className="text-ash hover:text-bone text-xl leading-none px-1">
            ‹
          </button>
          <span className="text-2xs uppercase tracking-[0.3em] text-dust">replay</span>
          <span className="font-mono text-xs text-ash truncate">
            {replayId}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={async () => {
              setRenderError(null);
              setStatusFeed([]);
              await ipc.rerenderReplay(replayId);
              reload(replayId);
            }}
            disabled={detail?.processing}
            className="btn-secondary disabled:opacity-50"
            title="Re-run the LLM render over the same captured data"
          >
            ↻ re-render
          </button>
          <button onClick={() => void ipc.openReplayDir(replayId)} className="btn-secondary">
            ↗ folder
          </button>
          <button onClick={() => void onCopy()} className="btn-primary">
            {copied ? "✓ copied" : "copy md"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-8 py-6 space-y-6">
          {/* Title + meta strip */}
          <div className="space-y-3">
            <h1 className="font-mono text-lg font-semibold tracking-tight text-bone leading-tight">
              {detail?.title ?? "—"}
            </h1>
            <MetaGrid detail={detail} />
          </div>

          {/* Processing state (and re-render banner if errored) */}
          {detail?.processing || renderError ? (
            <ProcessingPanel
              detail={detail}
              statusFeed={statusFeed}
              error={renderError}
              onRerender={async () => {
                setRenderError(null);
                setStatusFeed([]);
                await ipc.rerenderReplay(replayId);
                reload(replayId);
              }}
            />
          ) : null}

          {/* Frames contact-sheet */}
          {detail && detail.frameFiles.length > 0 ? (
            <div>
              <div className="section-label">
                <span className="num">F</span>
                <span className="flex-1 border-b border-rule h-2" />
                <span className="text-bone tracking-[0.2em]">
                  frames · {String(detail.frameFiles.length).padStart(2, "0")}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {detail.frameFiles.map((f, i) => (
                  <div key={f} className="brackets relative">
                    <div className="absolute top-1 left-1 z-10 font-mono text-2xs text-bone bg-ink/70 px-1">
                      {String(i + 1).padStart(2, "0")}
                    </div>
                    {frameUrls[f] ? (
                      <img
                        src={frameUrls[f]}
                        alt={f}
                        className="w-full aspect-video object-cover border border-rule"
                      />
                    ) : (
                      <div className="w-full aspect-video bg-carbon border border-rule flex items-center justify-center">
                        <span className="text-2xs text-dust animate-tick">▮</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* Markdown report */}
          {markdown ? (
            <div>
              <div className="section-label">
                <span className="num">R</span>
                <span className="flex-1 border-b border-rule h-2" />
                <span className="text-bone tracking-[0.2em]">report</span>
              </div>
              <div
                className="prose-fieldlog mt-3"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(markdownWithFrames) }}
              />
            </div>
          ) : (
            <div className="text-2xs uppercase tracking-widest text-dust animate-tick">
              ▮ loading
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaGrid({ detail }: { detail: ReplayDetail | null }) {
  if (!detail) {
    return (
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-2xs">
        <MetaRow label="recorded" value="—" />
        <MetaRow label="duration" value="—" />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-2xs">
      <MetaRow label="start" value={fmtClock(detail.startTs)} />
      <MetaRow label="end" value={fmtClock(detail.endTs)} />
      <MetaRow label="duration" value={fmtDuration(detail.durationMs)} />
      <MetaRow label="captured" value={fmtClock(detail.createdAt)} />
      <MetaRow label="provider" value={detail.provider || "—"} />
      <MetaRow label="model" value={detail.model || "—"} />
      <MetaRow label="frames" value={String(detail.frameFiles.length).padStart(2, "0")} />
      <MetaRow
        label="cost"
        value={detail.estimatedCostUSD > 0 ? `$${detail.estimatedCostUSD.toFixed(4)}` : "—"}
      />
    </div>
  );
}

function ProcessingPanel({
  detail,
  statusFeed,
  error,
  onRerender,
}: {
  detail: ReplayDetail | null;
  statusFeed: SidecarEvent[];
  error: string | null;
  onRerender: () => void | Promise<void>;
}) {
  const phaseLabel = (e: SidecarEvent): string => {
    switch (e.event) {
      case "reading_db":
        return `reading capture db · ${e.rows} rows`;
      case "coalesced":
        return `coalesced · ${e.events} events`;
      case "frames_picked":
        return `picked ${e.count} key frames`;
      case "redactions":
        return `redacted ${e.text} text · ${e.image} image regions`;
      case "calling_anthropic":
        return `running ${e.model}`;
      case "complete":
        return `complete · ${(e.durationMs / 1000).toFixed(1)}s`;
      case "error":
        return `error · ${e.message}`;
    }
  };

  return (
    <div className="brackets p-4 bg-carbon/40">
      <div className="section-label mb-3">
        <span className="num">~</span>
        <span className="flex-1 border-b border-rule h-2" />
        <span className={error ? "text-ember tracking-[0.2em]" : "text-bone tracking-[0.2em]"}>
          {error ? "render failed" : "processing"}
        </span>
      </div>

      {error ? (
        <>
          <div className="text-2xs text-ember mb-3 leading-relaxed">▲ {error}</div>
          <button onClick={() => void onRerender()} className="btn-primary">
            ↻ re-render
          </button>
        </>
      ) : (
        <>
          <div className="text-xs text-ash mb-3 animate-tick">
            ▮ the agent is reading your capture and writing report.md
          </div>

          {/* Captured raw-data files */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-2xs mb-4">
            <FileRow
              label="events.json"
              status={detail?.eventsBytes ? fmtBytes(detail.eventsBytes) : "pending"}
            />
            <FileRow
              label="audio.txt"
              status={
                detail
                  ? detail.audioBytes > 0
                    ? fmtBytes(detail.audioBytes)
                    : "no audio"
                  : "pending"
              }
            />
            <FileRow
              label="context.md"
              status={detail?.contextBytes ? fmtBytes(detail.contextBytes) : "pending"}
            />
            <FileRow
              label="frames/"
              status={detail ? `${detail.frameFiles.length} png` : "pending"}
            />
          </div>

          {/* Live agent status feed */}
          {statusFeed.length > 0 ? (
            <div className="border-t border-rule pt-3 space-y-1">
              {statusFeed.map((e, i) => (
                <div
                  key={i}
                  className={[
                    "font-mono text-2xs tabular-nums",
                    i === statusFeed.length - 1 ? "text-bone" : "text-dust",
                  ].join(" ")}
                >
                  · {phaseLabel(e)}
                </div>
              ))}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function FileRow({ label, status }: { label: string; status: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-rule/60 pb-1">
      <span className="font-mono text-bone">{label}</span>
      <span className="text-dust uppercase tracking-widest">{status}</span>
    </div>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-3 border-b border-rule/60 pb-1.5">
      <span className="uppercase tracking-widest text-dust text-2xs w-16 shrink-0">{label}</span>
      <span className="font-mono text-xs text-bone tabular-nums truncate">{value}</span>
    </div>
  );
}

// Tiny markdown renderer (same as before — kept minimal because the report
// shape is from a known prompt template).
function renderMarkdown(md: string): string {
  const escape = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  let inPara = false;

  const closePara = () => {
    if (inPara) {
      out.push("</p>");
      inPara = false;
    }
  };
  const closeList = () => {
    if (inList) {
      out.push("</ol>");
      inList = false;
    }
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) {
      closePara();
      closeList();
      continue;
    }
    if (line.startsWith("# ")) {
      closePara();
      closeList();
      out.push(`<h1>${inline(escape(line.slice(2)))}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closePara();
      closeList();
      out.push(`<h2>${inline(escape(line.slice(3)))}</h2>`);
      continue;
    }
    const olMatch = line.match(/^(\d+)\.\s+(.*)$/);
    if (olMatch) {
      closePara();
      if (!inList) {
        out.push("<ol>");
        inList = true;
      }
      out.push(`<li>${inline(escape(olMatch[2] ?? ""))}</li>`);
      continue;
    }
    closeList();
    if (!inPara) {
      out.push("<p>");
      inPara = true;
    } else {
      out.push(" ");
    }
    out.push(inline(escape(line)));
  }
  closePara();
  closeList();
  return out.join("");
}

function inline(s: string): string {
  s = s.replace(/!\[([^\]]*)\]\((blob:[^)]+|frames\/[^)]+|[^)]+)\)/g, (_m, alt, src) => `<img alt="${alt}" src="${src}" />`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  return s;
}
