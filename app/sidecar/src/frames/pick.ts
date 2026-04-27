import type { CoalescedEvent } from "../coalescer/index.js";

const MAX_FRAMES = 12;

export interface PickedFrame {
  index: number;        // 1-based, used in markdown filename
  filename: string;     // e.g. "01-app-product-page.png"
  relativeMs: number;   // ms since recording start
  source: CoalescedEvent;
}

/**
 * Pick frames worth embedding in the report.
 * Heuristic: every frame transition (which already implies app/url/window
 * change after dwell-collapse), every frame nearest a click, plus first/last.
 */
export function pickFrames(
  events: CoalescedEvent[],
  startTs: string,
): PickedFrame[] {
  const startMs = Date.parse(startTs);
  const frameEvents = events.filter((e) => e.kind === "frame" && e.snapshot_path);
  if (frameEvents.length === 0) return [];

  // Frames nearest each click
  const clicks = events.filter((e) => e.kind === "click");
  const nearestForClick = new Set<number>();
  for (const c of clicks) {
    const cMs = Date.parse(c.timestamp);
    let best: { idx: number; delta: number } | null = null;
    for (let i = 0; i < frameEvents.length; i++) {
      const fr = frameEvents[i];
      if (!fr) continue;
      const fMs = Date.parse(fr.timestamp);
      const d = Math.abs(fMs - cMs);
      if (best === null || d < best.delta) best = { idx: i, delta: d };
    }
    if (best) nearestForClick.add(best.idx);
  }

  const candidates = new Set<number>();
  candidates.add(0);
  candidates.add(frameEvents.length - 1);
  for (const idx of nearestForClick) candidates.add(idx);

  // Spread fill: if we still have few candidates relative to MAX_FRAMES, add
  // evenly-spaced extras.
  if (candidates.size < MAX_FRAMES) {
    const need = Math.min(MAX_FRAMES, frameEvents.length) - candidates.size;
    const step = Math.max(1, Math.floor(frameEvents.length / (need + 1)));
    for (let i = step; i < frameEvents.length && candidates.size < MAX_FRAMES; i += step) {
      candidates.add(i);
    }
  }

  // Cap.
  const ordered = Array.from(candidates).sort((a, b) => a - b).slice(0, MAX_FRAMES);

  const picked: PickedFrame[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const idx = ordered[i];
    if (idx === undefined) continue;
    const event = frameEvents[idx];
    if (!event) continue;
    const ms = Date.parse(event.timestamp) - startMs;
    const slug = slugify(event.app_name, event.window_name) || "frame";
    const padded = String(i + 1).padStart(2, "0");
    picked.push({
      index: i + 1,
      filename: `${padded}-${slug}.png`,
      relativeMs: Math.max(0, ms),
      source: event,
    });
  }
  return picked;
}

function slugify(...parts: Array<string | undefined | null>): string {
  return parts
    .filter((p): p is string => typeof p === "string" && p.length > 0)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}
