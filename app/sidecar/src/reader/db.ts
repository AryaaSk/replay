import Database, { type Database as Db } from "better-sqlite3";

export interface RawRow {
  timestamp: string;
  kind: "frame" | "ui" | "audio";
  app_name: string | null;
  window: string | null;
  browser_url: string | null;
  text: string | null;
  event_type: string | null;
  modifiers: number | null;
  key_code: number | null;
  ocr_text: string | null;
  speaker_id: string | null;
  snapshot_path: string | null;
  frame_id: number | null;
}

const QUERY = `
  SELECT timestamp, 'frame' AS kind, app_name, window_name AS window,
         browser_url, NULL AS text, NULL AS event_type,
         NULL AS modifiers, NULL AS key_code,
         (SELECT text FROM ocr_text o WHERE o.frame_id = f.id LIMIT 1) AS ocr_text,
         NULL AS speaker_id,
         snapshot_path,
         id AS frame_id
  FROM frames f
  WHERE timestamp >= @from AND timestamp <= @to
  UNION ALL
  SELECT timestamp, 'ui' AS kind, app_name, window_title AS window,
         browser_url, text_content AS text, event_type,
         modifiers, key_code,
         NULL AS ocr_text, NULL AS speaker_id,
         NULL AS snapshot_path,
         frame_id
  FROM ui_events
  WHERE timestamp >= @from AND timestamp <= @to
  UNION ALL
  SELECT at.timestamp, 'audio' AS kind, NULL AS app_name, NULL AS window,
         NULL AS browser_url, at.transcription AS text, NULL AS event_type,
         NULL AS modifiers, NULL AS key_code,
         NULL AS ocr_text,
         CAST(at.speaker_id AS TEXT) AS speaker_id,
         NULL AS snapshot_path,
         NULL AS frame_id
  FROM audio_transcriptions at
  WHERE at.timestamp >= @from AND at.timestamp <= @to
  ORDER BY timestamp ASC
`;

export function openReadOnly(dbPath: string): Db {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  db.pragma("journal_mode = WAL");
  return db;
}

export function readRange(db: Db, from: string, to: string): RawRow[] {
  const stmt = db.prepare<{ from: string; to: string }, RawRow>(QUERY);
  return stmt.all({ from, to });
}
