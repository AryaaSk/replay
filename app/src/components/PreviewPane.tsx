import { useEffect, useMemo, useState } from "react";
import { ipc } from "../lib/ipc";
import type { ReplayDetail } from "@shared/types";

interface Props {
  replayId: string;
  onClose: () => void;
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

export function PreviewPane({ replayId, onClose }: Props) {
  const [markdown, setMarkdown] = useState<string>("");
  const [detail, setDetail] = useState<ReplayDetail | null>(null);
  const [frameUrls, setFrameUrls] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([ipc.readReplay(replayId), ipc.readReplayDetail(replayId)]).then(
      ([md, d]) => {
        if (cancelled) return;
        setMarkdown(md);
        setDetail(d);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [replayId]);

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
