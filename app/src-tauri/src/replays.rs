use serde::{Deserialize, Serialize};
use ulid::Ulid;

use crate::errors::Result;
use crate::paths;

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplaySummary {
    pub id: String,
    pub title: String,
    pub start_ts: String,
    pub end_ts: String,
    pub duration_ms: i64,
    pub created_at: String,
}

pub fn new_id() -> String {
    Ulid::new().to_string()
}

pub fn list() -> Result<Vec<ReplaySummary>> {
    let dir = paths::replays_dir()?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir)? {
        let entry = entry?;
        if !entry.path().is_dir() {
            continue;
        }
        let metadata_path = entry.path().join("metadata.json");
        if !metadata_path.exists() {
            continue;
        }
        let bytes = match std::fs::read(&metadata_path) {
            Ok(b) => b,
            Err(_) => continue,
        };
        let parsed: serde_json::Value = match serde_json::from_slice(&bytes) {
            Ok(v) => v,
            Err(_) => continue,
        };
        let summary = ReplaySummary {
            id: parsed
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            title: parsed
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("(untitled)")
                .to_string(),
            start_ts: parsed
                .get("startTs")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            end_ts: parsed
                .get("endTs")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            duration_ms: parsed
                .get("durationMs")
                .and_then(|v| v.as_i64())
                .unwrap_or(0),
            created_at: parsed
                .get("createdAt")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
        };
        if !summary.id.is_empty() {
            out.push(summary);
        }
    }
    // Most recent first
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

pub fn delete(id: &str) -> Result<()> {
    let path = paths::replays_dir()?.join(id);
    if path.exists() {
        std::fs::remove_dir_all(&path)?;
    }
    Ok(())
}

pub fn read_report(id: &str) -> Result<String> {
    let path = paths::replays_dir()?.join(id).join("report.md");
    Ok(std::fs::read_to_string(path)?)
}
