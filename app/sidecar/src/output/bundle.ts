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

  // Frames are already written by the entrypoint before the describe call so
  // local agents can read them. Re-write defensively in case any are missing.
  for (let i = 0; i < framesCompressed.length; i++) {
    const frame = framesCompressed[i];
    const picked_i = picked[i];
    if (!frame || !picked_i) continue;
    const target = join(outDir, "frames", picked_i.filename);
    if (!(await fileExists(target))) {
      await fs.writeFile(target, frame.pngBytes);
    }
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

async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/** Slugify a free-form title into a path-safe id. Returns "" if the title
 * is empty / yields nothing useful — caller should fall back to ULID. */
export function slugify(title: string, maxLen = 40): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (cleaned.length < 3) return ""; // too short to be meaningful
  return cleaned.slice(0, maxLen).replace(/-+$/, "");
}

/** Find a sibling dir name that doesn't collide. Appends -2, -3, ... up to -99
 * before falling back to a random suffix. */
async function findUniqueSibling(parent: string, base: string): Promise<string> {
  const tryName = async (name: string) => {
    try {
      await fs.access(join(parent, name));
      return false;
    } catch {
      return true;
    }
  };
  if (await tryName(base)) return base;
  for (let i = 2; i <= 99; i++) {
    const c = `${base}-${i}`;
    if (await tryName(c)) return c;
  }
  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Encode an absolute path the way Claude Code does for ~/.claude/projects/.
 * Replaces / and spaces with -. Best-effort match for renaming transcripts. */
function claudeProjectName(absPath: string): string {
  return absPath.replace(/[\s/]+/g, "-");
}

/** Best-effort: rename the replay output dir from <ulid>/ to <slug>/.
 * On any error, leaves the ULID dir in place and returns the original id.
 * Also renames the matching Claude Code project-transcript dir, if any.
 *
 * Returns { id, path } — caller emits these as the final replay identifiers.
 */
export async function renameToSlug(
  outDir: string,
  title: string,
  fallbackId: string,
): Promise<{ id: string; path: string }> {
  try {
    const slug = slugify(title);
    if (!slug) return { id: fallbackId, path: outDir };

    const parent = join(outDir, "..");
    const newName = await findUniqueSibling(parent, slug);
    if (newName === fallbackId) return { id: fallbackId, path: outDir };

    const newPath = join(parent, newName);
    await fs.rename(outDir, newPath);

    // Update metadata.json's id field to match.
    try {
      const metaPath = join(newPath, "metadata.json");
      const raw = await fs.readFile(metaPath, "utf8");
      const obj = JSON.parse(raw) as Record<string, unknown>;
      obj["id"] = newName;
      // Keep the original ULID for traceability — useful for debugging.
      obj["internalId"] = fallbackId;
      await fs.writeFile(metaPath, JSON.stringify(obj, null, 2));
    } catch {
      /* metadata absent or unparseable; the rename is what matters */
    }

    // Try to rename the matching Claude Code transcript dir, if any.
    // Path: ~/.claude/projects/-Users-...-replays-<ulid>/  →  -...-replays-<slug>/
    const home = process.env["HOME"];
    if (home) {
      const projects = join(home, ".claude", "projects");
      try {
        const oldEnc = claudeProjectName(outDir).replace(/^-+/, "-");
        const newEnc = claudeProjectName(newPath).replace(/^-+/, "-");
        const oldDir = join(projects, oldEnc);
        const newDir = join(projects, newEnc);
        try {
          await fs.access(oldDir);
          await fs.rename(oldDir, newDir);
        } catch {
          /* claude transcript dir didn't exist (older Claude version, codex, etc.) */
        }
      } catch {
        /* projects dir doesn't exist — nothing to do */
      }
    }

    return { id: newName, path: newPath };
  } catch (err) {
    // Any failure: keep the ulid dir as-is. Replay still works fine.
    return { id: fallbackId, path: outDir };
  }
}

export function inferTitle(markdown: string): string {
  // Pull the first H1 if present.
  const m = markdown.match(/^# +(.+)$/m);
  if (m && m[1]) return m[1].replace(/^Replay\s*[—-]\s*/i, "").trim();
  return "Replay";
}
