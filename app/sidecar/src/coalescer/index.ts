// Replay-flavoured coalescer. Adapted from Zoral's screenpipe coalescer with
// these differences: keeps clicks + keystrokes (every action matters in a demo),
// lighter dwell-collapse (emits frame on each app/url transition), and emits
// a richer `kind` set for downstream prompt assembly.
import type { RawRow } from "../reader/db.js";

export type EventKind = "frame" | "text" | "clipboard" | "app_switch" | "audio" | "key_shortcut" | "click";

export interface CoalescedEvent {
  timestamp: string;
  kind: EventKind;
  content: string;
  app_name?: string;
  window_name?: string;
  browser_url?: string;
  duration_ms?: number;
  frame_id?: number;
  snapshot_path?: string;
  ocr_text?: string;
  key_code?: number;
  modifiers?: number;
}

export interface CoalescerConfig {
  coalesceWindowMs: number;
  // Replay default: only drop pure noise types
  dropEventTypes: ReadonlySet<string>;
  // If true, surface clicks as their own events. Replay default: true.
  keepClicks: boolean;
}

export const DEFAULT_REPLAY_CONFIG: CoalescerConfig = {
  coalesceWindowMs: 2000,
  dropEventTypes: new Set(["move", "scroll"]),
  keepClicks: true,
};

const KEY_NAMES: Record<number, string> = {
  0: "A", 1: "S", 2: "D", 3: "F", 4: "H", 5: "G", 6: "Z", 7: "X", 8: "C",
  9: "V", 11: "B", 12: "Q", 13: "W", 14: "E", 15: "R", 16: "Y", 17: "T",
  31: "O", 32: "U", 34: "I", 35: "P", 37: "L", 38: "J", 40: "K", 45: "N",
  46: "M",
  36: "Return", 48: "Tab", 49: "Space", 51: "Delete", 53: "Escape",
  123: "Left", 124: "Right", 125: "Down", 126: "Up",
};

interface TextBurst {
  app: string | null;
  window: string | null;
  browser_url: string | null;
  content: string;
  startTs: string;
  lastTs: string;
}

interface Dwell {
  app: string | null;
  window: string | null;
  browser_url: string | null;
  ocr_text: string | null;
  snapshot_path: string | null;
  frame_id: number | null;
  startTs: string;
  lastTs: string;
}

export class Coalescer {
  private textBurst: TextBurst | null = null;
  private currentDwell: Dwell | null = null;
  private recentFrameKeys = new Map<string, number>();
  private cfg: CoalescerConfig;

  constructor(cfg: CoalescerConfig = DEFAULT_REPLAY_CONFIG) {
    this.cfg = cfg;
  }

  process(rows: RawRow[]): CoalescedEvent[] {
    const out: CoalescedEvent[] = [];
    for (const row of rows) this.processRow(row, out);
    return out;
  }

  flush(): CoalescedEvent[] {
    const out: CoalescedEvent[] = [];
    if (this.textBurst) {
      out.push(this.emitTextBurst(this.textBurst));
      this.textBurst = null;
    }
    if (this.currentDwell) {
      out.push(this.emitFrame(this.currentDwell));
      this.currentDwell = null;
    }
    return out;
  }

  private processRow(row: RawRow, out: CoalescedEvent[]): void {
    if (row.kind === "ui") {
      const et = row.event_type ?? "";
      if (this.cfg.dropEventTypes.has(et)) return;

      if (et === "text") {
        this.handleTextRow(row, out);
        return;
      }
      if (et === "clipboard") {
        this.flushTextBurstInto(out);
        out.push({
          timestamp: row.timestamp,
          kind: "clipboard",
          content: row.text ?? "",
          app_name: row.app_name ?? undefined,
          window_name: row.window ?? undefined,
          browser_url: row.browser_url ?? undefined,
        });
        return;
      }
      if (et === "app_switch") {
        this.flushTextBurstInto(out);
        this.flushDwellInto(out);
        out.push({
          timestamp: row.timestamp,
          kind: "app_switch",
          content: row.app_name ?? "(unknown app)",
          app_name: row.app_name ?? undefined,
          window_name: row.window ?? undefined,
          browser_url: row.browser_url ?? undefined,
        });
        return;
      }
      if (et === "key") {
        if ((row.modifiers ?? 0) === 0) return;
        this.flushTextBurstInto(out);
        out.push({
          timestamp: row.timestamp,
          kind: "key_shortcut",
          content: this.describeKey(row),
          app_name: row.app_name ?? undefined,
          window_name: row.window ?? undefined,
          browser_url: row.browser_url ?? undefined,
          key_code: row.key_code ?? undefined,
          modifiers: row.modifiers ?? undefined,
        });
        return;
      }
      if (et === "click") {
        if (!this.cfg.keepClicks) return;
        // We don't have the click target's label from screenpipe alone — best
        // we can offer is "click in <window>". The OCR for the nearest frame
        // (joined by frame_id) gives the model context to interpret what was
        // clicked.
        out.push({
          timestamp: row.timestamp,
          kind: "click",
          content: `click in ${row.window ?? row.app_name ?? "?"}`,
          app_name: row.app_name ?? undefined,
          window_name: row.window ?? undefined,
          browser_url: row.browser_url ?? undefined,
          frame_id: row.frame_id ?? undefined,
        });
        return;
      }
      return;
    }

    if (row.kind === "frame") {
      this.handleFrameRow(row, out);
      return;
    }

    if (row.kind === "audio") {
      const text = row.text ?? "";
      if (text.trim().length === 0) return;
      out.push({
        timestamp: row.timestamp,
        kind: "audio",
        content: text,
      });
    }
  }

  private handleTextRow(row: RawRow, out: CoalescedEvent[]): void {
    const sameWindow =
      this.textBurst !== null &&
      this.textBurst.app === row.app_name &&
      this.textBurst.window === row.window;
    const within =
      this.textBurst !== null &&
      msBetween(this.textBurst.lastTs, row.timestamp) <= this.cfg.coalesceWindowMs;

    if (this.textBurst && (!sameWindow || !within)) {
      out.push(this.emitTextBurst(this.textBurst));
      this.textBurst = null;
    }
    if (!this.textBurst) {
      this.textBurst = {
        app: row.app_name,
        window: row.window,
        browser_url: row.browser_url,
        content: row.text ?? "",
        startTs: row.timestamp,
        lastTs: row.timestamp,
      };
      return;
    }
    this.textBurst.content += row.text ?? "";
    this.textBurst.lastTs = row.timestamp;
  }

  private handleFrameRow(row: RawRow, out: CoalescedEvent[]): void {
    if (this.isDuplicateFrame(row)) return;
    const same =
      this.currentDwell !== null &&
      this.currentDwell.app === row.app_name &&
      this.currentDwell.window === row.window &&
      this.currentDwell.browser_url === row.browser_url;
    if (same && this.currentDwell) {
      this.currentDwell.lastTs = row.timestamp;
      return;
    }
    if (this.currentDwell) out.push(this.emitFrame(this.currentDwell));
    this.currentDwell = {
      app: row.app_name,
      window: row.window,
      browser_url: row.browser_url,
      ocr_text: row.ocr_text,
      snapshot_path: row.snapshot_path,
      frame_id: row.frame_id,
      startTs: row.timestamp,
      lastTs: row.timestamp,
    };
  }

  private isDuplicateFrame(row: RawRow): boolean {
    const tsMs = Date.parse(row.timestamp);
    if (!Number.isFinite(tsMs)) return false;
    const bucket = Math.floor(tsMs / 100);
    const key = `${bucket}|${row.app_name ?? ""}|${row.window ?? ""}`;
    if (this.recentFrameKeys.has(key)) return true;
    this.recentFrameKeys.set(key, tsMs);
    if (this.recentFrameKeys.size > 1000) {
      // crude cap to avoid unbounded growth
      const cutoff = tsMs - 5000;
      for (const [k, t] of this.recentFrameKeys) {
        if (t < cutoff) this.recentFrameKeys.delete(k);
      }
    }
    return false;
  }

  private flushTextBurstInto(out: CoalescedEvent[]): void {
    if (this.textBurst) {
      out.push(this.emitTextBurst(this.textBurst));
      this.textBurst = null;
    }
  }

  private flushDwellInto(out: CoalescedEvent[]): void {
    if (this.currentDwell) {
      out.push(this.emitFrame(this.currentDwell));
      this.currentDwell = null;
    }
  }

  private emitTextBurst(b: TextBurst): CoalescedEvent {
    return {
      timestamp: b.lastTs,
      kind: "text",
      content: b.content,
      app_name: b.app ?? undefined,
      window_name: b.window ?? undefined,
      browser_url: b.browser_url ?? undefined,
      duration_ms: msBetween(b.startTs, b.lastTs),
    };
  }

  private emitFrame(d: Dwell): CoalescedEvent {
    const ctx = d.browser_url ?? [d.app, d.window].filter(Boolean).join(" · ") ?? "(unknown)";
    const ocr = d.ocr_text?.trim();
    return {
      timestamp: d.lastTs,
      kind: "frame",
      content: ocr && ocr.length > 0 ? `${ctx}\n${ocr}` : ctx,
      app_name: d.app ?? undefined,
      window_name: d.window ?? undefined,
      browser_url: d.browser_url ?? undefined,
      duration_ms: msBetween(d.startTs, d.lastTs),
      frame_id: d.frame_id ?? undefined,
      snapshot_path: d.snapshot_path ?? undefined,
      ocr_text: ocr ?? undefined,
    };
  }

  private describeKey(row: RawRow): string {
    const code = row.key_code;
    const name = code != null ? (KEY_NAMES[code] ?? `key${code}`) : "?";
    const mods = row.modifiers ?? 0;
    return `${name} (modifiers=${mods}) in ${row.app_name ?? "?"}`;
  }
}

function msBetween(a: string, b: string): number {
  const x = Date.parse(a);
  const y = Date.parse(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return 0;
  return Math.max(0, y - x);
}
