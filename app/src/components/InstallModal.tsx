import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import { onInstallProgress } from "../lib/events";
import type { InstallProgress } from "@shared/types";

interface Props {
  onDone: () => void;
}

export function InstallModal({ onDone }: Props) {
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    (async () => {
      unlisten = await onInstallProgress((p) => setProgress(p));
    })();
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const onInstall = async () => {
    setInstalling(true);
    setError(null);
    try {
      await ipc.installScreenpipe();
      onDone();
    } catch (e) {
      setError(String(e));
      setInstalling(false);
    }
  };

  const pct =
    progress?.totalBytes && progress.bytesReceived
      ? Math.round((progress.bytesReceived / progress.totalBytes) * 100)
      : null;

  return (
    <div className="absolute inset-0 bg-ink/90 backdrop-blur-sm flex items-center justify-center z-10 animate-fade-in">
      <div className="brackets max-w-md w-full mx-4 bg-carbon border border-rule">
        <div className="px-5 py-4 border-b border-rule flex items-baseline justify-between">
          <span className="text-2xs uppercase tracking-[0.3em] text-dust">setup · 01</span>
          <span className="text-2xs uppercase tracking-widest text-ash">install screenpipe</span>
        </div>
        <div className="px-5 py-5 space-y-4">
          <div className="text-sm leading-relaxed text-ash">
            replay uses{" "}
            <a
              className="text-bone underline decoration-rule hover:decoration-bone underline-offset-2"
              href="https://github.com/screenpipe/screenpipe"
              target="_blank"
              rel="noreferrer"
            >
              screenpipe
            </a>{" "}
            (open source) to capture screen + audio events. installed locally to replay's app folder, isolated from anything else on your system.
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-2xs uppercase tracking-widest text-dust">size</span>
            <span className="font-mono text-xs text-ash">≈ 45 mb</span>
          </div>

          {progress ? (
            <div className="space-y-1.5 pt-2 border-t border-rule">
              <div className="flex items-baseline justify-between">
                <span className="text-2xs uppercase tracking-widest text-ash">{progress.phase.replace(/_/g, " ")}</span>
                {pct !== null ? (
                  <span className="font-mono text-2xs text-ash tabular-nums">{String(pct).padStart(2, "0")}%</span>
                ) : null}
              </div>
              <div className="text-2xs text-dust">{progress.message}</div>
              {pct !== null ? (
                <div className="h-px bg-rule mt-2 relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-bone transition-all duration-200"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="text-2xs uppercase tracking-widest text-ember pt-2 border-t border-emberlow/30">
              ▲ install failed · {error}
            </div>
          ) : null}
        </div>
        <div className="px-5 py-3 border-t border-rule flex justify-end">
          <button
            onClick={() => void onInstall()}
            disabled={installing}
            className="btn-primary disabled:opacity-50"
          >
            {installing ? "▮ installing" : "install screenpipe"}
          </button>
        </div>
      </div>
    </div>
  );
}
