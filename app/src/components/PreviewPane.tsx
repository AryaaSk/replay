import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";

interface Props {
  replayId: string;
  onClose: () => void;
}

export function PreviewPane({ replayId, onClose }: Props) {
  const [markdown, setMarkdown] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ipc.readReplay(replayId).then((md) => {
      if (!cancelled) setMarkdown(md);
    });
    return () => {
      cancelled = true;
    };
  }, [replayId]);

  const onCopy = async () => {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="absolute inset-0 bg-neutral-950 flex flex-col">
      <div className="titlebar h-12 flex items-center justify-between px-4 border-b border-neutral-800 bg-neutral-900/80">
        <div className="text-sm text-neutral-300">Replay preview</div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void ipc.openReplayDir(replayId)}
            className="text-xs px-2 py-1 rounded bg-neutral-800 hover:bg-neutral-700 transition-colors"
          >
            Open folder
          </button>
          <button
            onClick={() => void onCopy()}
            className="text-xs px-2 py-1 rounded bg-neutral-100 text-neutral-900 hover:bg-white transition-colors"
          >
            {copied ? "Copied!" : "Copy markdown"}
          </button>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-neutral-100 text-xl leading-none px-1"
          >
            ×
          </button>
        </div>
      </div>
      <pre className="flex-1 overflow-auto p-4 text-sm font-mono whitespace-pre-wrap text-neutral-200">
        {markdown || "(loading…)"}
      </pre>
    </div>
  );
}
