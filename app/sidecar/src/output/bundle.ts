import { promises as fs } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";

import type { CoalescedEvent } from "../coalescer/index.js";
import type { CompressedFrame } from "../frames/compress.js";
import type { PickedFrame } from "../frames/pick.js";

export interface ReplayMetadataInput {
  id: string;
  startTs: string;
  endTs: string;
  mode: "fresh" | "always-warm";
  lookbackSeconds: number;
  monitor: string | "all";
  redactions: { textMatches: number; imageBlurs: number; rulesApplied: string[] };
  api: { model: string; inputTokens: number; outputTokens: number; estimatedCostUSD: number };
  events: ReadonlyArray<CoalescedEvent>;
  picked: ReadonlyArray<PickedFrame>;
  title: string;
}

export async function writeBundle(
  outDir: string,
  markdown: string,
  framesCompressed: ReadonlyArray<CompressedFrame>,
  picked: ReadonlyArray<PickedFrame>,
  meta: ReplayMetadataInput,
): Promise<{ reportPath: string }> {
  await fs.mkdir(join(outDir, "frames"), { recursive: true });

  // Frames
  for (let i = 0; i < framesCompressed.length; i++) {
    const frame = framesCompressed[i];
    const picked_i = picked[i];
    if (!frame || !picked_i) continue;
    await fs.writeFile(join(outDir, "frames", picked_i.filename), frame.pngBytes);
  }

  // Report
  const reportPath = join(outDir, "report.md");
  await fs.writeFile(reportPath, markdown.trim() + "\n", "utf8");

  // Metadata
  const metadata = {
    id: meta.id,
    title: meta.title,
    startTs: meta.startTs,
    endTs: meta.endTs,
    durationMs: Math.max(0, Date.parse(meta.endTs) - Date.parse(meta.startTs)),
    createdAt: new Date().toISOString(),
    device: {
      machineName: hostname(),
      macosVersion: "unknown",
    },
    capture: {
      mode: meta.mode,
      lookbackSeconds: meta.lookbackSeconds,
      monitor: meta.monitor,
    },
    redactions: meta.redactions,
    api: meta.api,
    frames: meta.picked.map((p) => ({ filename: p.filename, relativeMs: p.relativeMs })),
    rawEvents: meta.events.map((e) => ({
      ts: e.timestamp,
      kind: e.kind,
      app: e.app_name,
      window: e.window_name,
      url: e.browser_url,
      content: e.content,
    })),
  };
  await fs.writeFile(join(outDir, "metadata.json"), JSON.stringify(metadata, null, 2));
  return { reportPath };
}

export function inferTitle(markdown: string): string {
  // Pull the first H1 if present.
  const m = markdown.match(/^# +(.+)$/m);
  if (m && m[1]) return m[1].replace(/^Replay\s*[—-]\s*/i, "").trim();
  return "Replay";
}
