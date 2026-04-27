#!/usr/bin/env node
import { z } from "zod";

import { Coalescer, DEFAULT_REPLAY_CONFIG } from "./coalescer/index.js";
import { compressFrame } from "./frames/compress.js";
import { pickFrames } from "./frames/pick.js";
import { describe } from "./describe/model.js";
import { openReadOnly, readRange } from "./reader/db.js";
import { redactSecrets } from "./redact/secrets.js";
import { findRegionsToBlur, parseOcrBoxes } from "./redact/ocr.js";
import { writeBundle, inferTitle } from "./output/bundle.js";
import { emit, logErr } from "./lib/log.js";
import Database from "better-sqlite3";
import { join } from "node:path";

const ArgsSchema = z.object({
  from: z.string(),
  to: z.string(),
  dataDir: z.string(),
  out: z.string(),
  replayId: z.string(),
  settings: z.string().optional(),
});

interface CliArgs {
  from: string;
  to: string;
  dataDir: string;
  out: string;
  replayId: string;
  settings?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const map: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (typeof a === "string" && a.startsWith("--")) {
      const next = argv[i + 1];
      if (typeof next === "string") {
        map[a.slice(2)] = next;
        i++;
      }
    }
  }
  const parsed = ArgsSchema.parse({
    from: map["from"],
    to: map["to"],
    dataDir: map["data-dir"] ?? map["dataDir"],
    out: map["out"],
    replayId: map["replay-id"] ?? map["replayId"],
    settings: map["settings"],
  });
  return parsed;
}

async function main(): Promise<void> {
  const t0 = Date.now();
  const args = parseArgs(process.argv.slice(2));

  let model = "claude-sonnet-4-6";
  let mode: "fresh" | "always-warm" = "fresh";
  let lookbackSeconds = 0;
  let redactSecretsFlag = true;

  if (args.settings) {
    try {
      const s = JSON.parse(args.settings) as Record<string, unknown>;
      if (typeof s["model"] === "string") model = s["model"] as string;
      mode = s["always_warm"] === true ? "always-warm" : "fresh";
      if (typeof s["lookback_seconds"] === "number") lookbackSeconds = s["lookback_seconds"] as number;
      if (typeof s["redact_secrets"] === "boolean") redactSecretsFlag = s["redact_secrets"] as boolean;
    } catch (e) {
      logErr("settings parse failed:", String(e));
    }
  }

  const dbPath = join(args.dataDir, "db.sqlite");

  // 1. Read raw rows
  let db: Database.Database;
  try {
    db = openReadOnly(dbPath);
  } catch (e) {
    emit({ event: "error", message: `cannot open db: ${(e as Error).message}` });
    throw e;
  }
  const rows = readRange(db, args.from, args.to);
  emit({ event: "reading_db", rows: rows.length });

  // 2. Coalesce
  const coalescer = new Coalescer(DEFAULT_REPLAY_CONFIG);
  const events = coalescer.process(rows);
  events.push(...coalescer.flush());
  emit({ event: "coalesced", events: events.length });

  // 3. Pick frames
  const picked = pickFrames(events, args.from);
  emit({ event: "frames_picked", count: picked.length });

  // 4. Audio transcript
  const audioTranscript = events
    .filter((e) => e.kind === "audio")
    .map((e) => e.content.trim())
    .join(" ")
    .trim();

  // 5. Redactions
  let textRedactions = 0;
  if (redactSecretsFlag) {
    for (const e of events) {
      const r = redactSecrets(e.content);
      if (r.matches.length > 0) {
        textRedactions += r.matches.length;
        e.content = r.redacted;
      }
    }
  }
  // Image redaction: query OCR boxes for each picked frame and identify regions.
  const stmt = db.prepare<{ frame_id: number }, { text_json: string | null }>(
    "SELECT text_json FROM ocr_text WHERE frame_id = @frame_id LIMIT 1",
  );
  const blurMap = new Map<number, Array<{ x: number; y: number; width: number; height: number }>>();
  let imageBlurs = 0;
  if (redactSecretsFlag) {
    for (const p of picked) {
      const fid = p.source.frame_id;
      if (typeof fid !== "number") continue;
      const row = stmt.get({ frame_id: fid });
      if (!row) continue;
      const boxes = parseOcrBoxes(row.text_json);
      const regions = findRegionsToBlur(boxes);
      if (regions.length > 0) {
        blurMap.set(p.index, regions.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })));
        imageBlurs += regions.length;
      }
    }
  }
  emit({ event: "redactions", text: textRedactions, image: imageBlurs });

  // 6. Compress frames
  const framesCompressed = [];
  for (const p of picked) {
    const snap = p.source.snapshot_path;
    if (!snap) continue;
    try {
      const frame = await compressFrame(snap, p.filename, blurMap.get(p.index) ?? []);
      framesCompressed.push(frame);
    } catch (e) {
      logErr("compress failed for", snap, String(e));
    }
  }

  db.close();

  // 7. Anthropic call
  emit({ event: "calling_anthropic", model });
  const description = await describe({
    model,
    events,
    picked,
    framesCompressed,
    audioTranscript,
    startTs: args.from,
    endTs: args.to,
  });

  // 8. Bundle
  const title = inferTitle(description.markdown);
  await writeBundle(args.out, description.markdown, framesCompressed, picked, {
    id: args.replayId,
    startTs: args.from,
    endTs: args.to,
    mode,
    lookbackSeconds,
    monitor: "all",
    redactions: { textMatches: textRedactions, imageBlurs, rulesApplied: [] },
    api: {
      model,
      inputTokens: description.inputTokens,
      outputTokens: description.outputTokens,
      estimatedCostUSD: description.estimatedCostUSD,
    },
    events,
    picked,
    title,
  });

  emit({
    event: "complete",
    replayId: args.replayId,
    reportPath: join(args.out, "report.md"),
    durationMs: Date.now() - t0,
  });
}

main().catch((e) => {
  emit({ event: "error", message: (e as Error).message ?? String(e) });
  logErr(String(e));
  process.exit(1);
});
