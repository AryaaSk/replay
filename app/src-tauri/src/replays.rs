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

#[derive(Debug, Serialize, Deserialize)]
pub struct ReplayDetail {
    pub id: String,
    pub title: String,
    pub start_ts: String,
    pub end_ts: String,
    pub duration_ms: i64,
    pub created_at: String,
    pub model: String,
    pub provider: String,
    pub estimated_cost_usd: f64,
    pub frame_files: Vec<String>,
    pub bundle_path: String,
    pub report_present: bool,
}

pub fn read_detail(id: &str) -> Result<ReplayDetail> {
    let dir = paths::replays_dir()?.join(id);
    let metadata_path = dir.join("metadata.json");
    let bytes = std::fs::read(&metadata_path)?;
    let parsed: serde_json::Value = serde_json::from_slice(&bytes)?;

    // List frames/ contents
    let frames_dir = dir.join("frames");
    let mut frame_files: Vec<String> = Vec::new();
    if frames_dir.exists() {
        for entry in std::fs::read_dir(&frames_dir)? {
            let entry = entry?;
            if let Some(name) = entry.file_name().to_str() {
                frame_files.push(name.to_string());
            }
        }
        frame_files.sort();
    }

    let api = parsed.get("api");
    let model = api
        .and_then(|v| v.get("model"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let estimated_cost_usd = api
        .and_then(|v| v.get("estimatedCostUSD"))
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);

    let provider = if model.starts_with("claude-") {
        "anthropic"
    } else if model.starts_with("gpt-") {
        "openai"
    } else {
        ""
    }
    .to_string();

    Ok(ReplayDetail {
        id: id.to_string(),
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
        duration_ms: parsed.get("durationMs").and_then(|v| v.as_i64()).unwrap_or(0),
        created_at: parsed
            .get("createdAt")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        model,
        provider,
        estimated_cost_usd,
        frame_files,
        bundle_path: dir.display().to_string(),
        report_present: dir.join("report.md").exists(),
    })
}

/// Read a single frame as bytes (frontend turns this into a blob URL).
pub fn read_frame(id: &str, filename: &str) -> Result<Vec<u8>> {
    // Reject any name with separators to keep this read scoped to the replay folder.
    if filename.contains('/') || filename.contains("..") {
        return Err(crate::errors::ReplayError::Internal(format!(
            "invalid frame filename: {filename}"
        )));
    }
    let path = paths::replays_dir()?.join(id).join("frames").join(filename);
    Ok(std::fs::read(path)?)
}
