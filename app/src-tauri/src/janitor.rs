use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use rusqlite::{Connection, OpenFlags};
use tauri::AppHandle;

use crate::errors::Result;
use crate::paths;
use crate::state::{AppState, CaptureMode};

const TICK: Duration = Duration::from_secs(60);
const SAFETY_MARGIN_SECS: i64 = 5;

#[derive(Debug)]
struct Range {
    start: DateTime<Utc>,
    end: Option<DateTime<Utc>>, // None = open-ended (active recording)
}

pub fn spawn(app: AppHandle, state: AppState) {
    // Use Tauri's async runtime — `tokio::spawn` would panic here because
    // `setup` is called synchronously before any user-managed tokio runtime
    // exists. Tauri's runtime is already running by setup time.
    tauri::async_runtime::spawn(async move {
        let mut tick_count: u64 = 0;
        loop {
            tokio::time::sleep(TICK).await;
            let mode = *state.mode.lock().await;
            if !matches!(mode, CaptureMode::AlwaysWarm) {
                continue;
            }
            tick_count = tick_count.wrapping_add(1);
            if let Err(e) = run_once(&app, &state, tick_count).await {
                log::warn!("janitor tick failed: {e}");
            }
        }
    });
}

async fn run_once(_app: &AppHandle, state: &AppState, tick: u64) -> Result<()> {
    let keep = compute_keep_ranges(state).await;
    let db_path = paths::screenpipe_db_path()?;
    if !db_path.exists() {
        return Ok(());
    }

    // SQLite ops are blocking — run in a blocking task.
    let keep_clone = Arc::new(keep);
    let db_path_clone = db_path.clone();
    let result = tokio::task::spawn_blocking(move || prune_db(&db_path_clone, &keep_clone, tick))
        .await
        .map_err(|e| crate::errors::ReplayError::Internal(format!("join: {e}")))??;

    log::debug!(
        "janitor: pruned {} frames, {} ui_events, {} ocr, {} audio_chunks, {} audio_tx",
        result.frames,
        result.ui_events,
        result.ocr_text,
        result.audio_chunks,
        result.audio_transcriptions
    );
    Ok(())
}

async fn compute_keep_ranges(state: &AppState) -> Vec<Range> {
    let mut keep: Vec<Range> = Vec::new();
    let now = Utc::now();

    // Active recording (open-ended)
    if let Some(start_str) = state.recording_start.lock().await.clone() {
        if let Ok(start) = DateTime::parse_from_rfc3339(&start_str) {
            keep.push(Range {
                start: start.with_timezone(&Utc),
                end: None,
            });
        }
    }

    // Look-back buffer
    let lookback_seconds = state.settings.lock().await.lookback_seconds as i64;
    keep.push(Range {
        start: now - chrono::Duration::seconds(lookback_seconds),
        end: Some(now + chrono::Duration::seconds(SAFETY_MARGIN_SECS)),
    });

    // Saved replays — read from disk metadata.json files
    if let Ok(replays) = paths::replays_dir() {
        if replays.exists() {
            if let Ok(read) = std::fs::read_dir(&replays) {
                for entry in read.flatten() {
                    let metadata_path = entry.path().join("metadata.json");
                    if metadata_path.exists() {
                        if let Ok(content) = std::fs::read_to_string(&metadata_path) {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&content)
                            {
                                let start = parsed.get("startTs").and_then(|v| v.as_str());
                                let end = parsed.get("endTs").and_then(|v| v.as_str());
                                if let (Some(s), Some(e)) = (start, end) {
                                    if let (Ok(s), Ok(e)) = (
                                        DateTime::parse_from_rfc3339(s),
                                        DateTime::parse_from_rfc3339(e),
                                    ) {
                                        keep.push(Range {
                                            start: s.with_timezone(&Utc),
                                            end: Some(e.with_timezone(&Utc)),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    keep
}

#[derive(Debug, Default)]
struct PruneCounts {
    frames: u32,
    ui_events: u32,
    ocr_text: u32,
    audio_chunks: u32,
    audio_transcriptions: u32,
}

fn prune_db(db_path: &std::path::Path, keep: &[Range], tick: u64) -> Result<PruneCounts> {
    // Open with read-write (we need DELETE permission). screenpipe is concurrent-writing
    // so we use WAL mode (which it already enables) and short-lived transactions.
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    conn.busy_timeout(Duration::from_secs(2))?;

    // Build the keep predicate: a row should be kept if its timestamp falls in
    // ANY range. Equivalently, prune if it's in NO range.
    // We pass ranges as parameters and OR them dynamically.
    if keep.is_empty() {
        // Without any keep ranges, deletion would be unsafe — bail.
        return Ok(PruneCounts::default());
    }

    // Build the keep WHERE clause.
    let mut clauses: Vec<String> = Vec::new();
    let mut params: Vec<String> = Vec::new();
    for r in keep {
        let s = r.start.to_rfc3339();
        match r.end {
            Some(e) => {
                let es = e.to_rfc3339();
                clauses.push("(timestamp >= ? AND timestamp <= ?)".into());
                params.push(s);
                params.push(es);
            }
            None => {
                clauses.push("(timestamp >= ?)".into());
                params.push(s);
            }
        }
    }
    let keep_clause = clauses.join(" OR ");

    let mut counts = PruneCounts::default();

    // For each table, collect filenames before deletion so we can unlink them.
    let frame_paths: Vec<String> = collect_paths(
        &conn,
        &format!(
            "SELECT snapshot_path FROM frames WHERE snapshot_path IS NOT NULL AND NOT ({keep_clause})"
        ),
        &params,
    )
    .unwrap_or_default();

    let audio_paths: Vec<String> = collect_paths(
        &conn,
        &format!("SELECT file_path FROM audio_chunks WHERE NOT ({keep_clause})"),
        &params,
    )
    .unwrap_or_default();

    // Delete rows.
    counts.audio_transcriptions = exec_delete(
        &conn,
        &format!("DELETE FROM audio_transcriptions WHERE NOT ({keep_clause})"),
        &params,
    )?;
    counts.audio_chunks = exec_delete(
        &conn,
        &format!("DELETE FROM audio_chunks WHERE NOT ({keep_clause})"),
        &params,
    )?;
    counts.ui_events = exec_delete(
        &conn,
        &format!("DELETE FROM ui_events WHERE NOT ({keep_clause})"),
        &params,
    )?;
    counts.ocr_text = exec_delete(
        &conn,
        &format!(
            "DELETE FROM ocr_text WHERE frame_id IN (SELECT id FROM frames WHERE NOT ({keep_clause}))"
        ),
        &params,
    )?;
    counts.frames = exec_delete(
        &conn,
        &format!("DELETE FROM frames WHERE NOT ({keep_clause})"),
        &params,
    )?;

    // Unlink files.
    for p in frame_paths.iter().chain(audio_paths.iter()) {
        let _ = std::fs::remove_file(p);
    }

    if tick % 10 == 0 {
        let _ = conn.execute("VACUUM", []);
    }
    Ok(counts)
}

fn collect_paths(
    conn: &Connection,
    sql: &str,
    params: &[String],
) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params.iter()), |r| {
        r.get::<_, String>(0)
    })?;
    let mut out = Vec::new();
    for r in rows {
        if let Ok(s) = r {
            out.push(s);
        }
    }
    Ok(out)
}

fn exec_delete(conn: &Connection, sql: &str, params: &[String]) -> rusqlite::Result<u32> {
    let n = conn.execute(sql, rusqlite::params_from_iter(params.iter()))?;
    Ok(n as u32)
}
