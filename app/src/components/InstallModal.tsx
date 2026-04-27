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

  return (
    <div className="absolute inset-0 bg-neutral-950/95 flex items-center justify-center z-10 backdrop-blur">
      <div className="max-w-md w-full mx-4 bg-neutral-900 border border-neutral-800 rounded-lg p-6 space-y-4">
        <div className="text-lg font-semibold">Almost ready</div>
        <div className="text-sm text-neutral-400 leading-relaxed">
          Replay uses <a className="underline" href="https://github.com/screenpipe/screenpipe" target="_blank" rel="noreferrer">screenpipe</a> (open source) to capture screen + audio events. We install it locally to Replay's app folder, isolated from anything else on your system. ~80MB download.
        </div>
        {progress ? (
          <div className="space-y-2">
            <div className="text-xs text-neutral-400">{progress.message}</div>
            {progress.totalBytes && progress.bytesReceived ? (
              <div className="h-1 bg-neutral-800 rounded overflow-hidden">
                <div
                  className="h-full bg-neutral-200 transition-all"
                  style={{ width: `${Math.round((progress.bytesReceived / progress.totalBytes) * 100)}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div className="text-xs text-red-400">Install failed: {error}</div>
        ) : null}
        <div className="flex gap-2 justify-end">
          <button
            onClick={() => void onInstall()}
            disabled={installing}
            className="px-4 py-1.5 rounded bg-neutral-100 text-neutral-900 text-sm font-medium disabled:opacity-50"
          >
            {installing ? "Installing…" : "Install screenpipe"}
          </button>
        </div>
      </div>
    </div>
  );
}
