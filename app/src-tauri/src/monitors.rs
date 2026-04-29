use serde::{Deserialize, Serialize};
use tokio::process::Command;

use crate::errors::{ReplayError, Result};
use crate::paths;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MonitorInfo {
    pub id: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub is_default: bool,
}

#[derive(Debug, Deserialize)]
struct ListResponse {
    success: bool,
    data: Vec<MonitorInfo>,
}

/// Runs `screenpipe vision list -o json` and parses the result.
/// Doesn't touch the recording subprocess — safe to call any time after install.
pub async fn list() -> Result<Vec<MonitorInfo>> {
    let bin = paths::screenpipe_binary_path()?;
    if !bin.exists() {
        return Err(ReplayError::BinaryMissing(bin.display().to_string()));
    }
    let output = Command::new(&bin)
        .args(["vision", "list", "-o", "json"])
        .output()
        .await
        .map_err(|e| ReplayError::Internal(format!("screenpipe vision list spawn: {e}")))?;
    if !output.status.success() {
        return Err(ReplayError::Internal(format!(
            "screenpipe vision list exited {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }
    let parsed: ListResponse = serde_json::from_slice(&output.stdout).map_err(|e| {
        ReplayError::Internal(format!(
            "screenpipe vision list: parse json failed: {e}; raw={}",
            String::from_utf8_lossy(&output.stdout).trim()
        ))
    })?;
    if !parsed.success {
        return Err(ReplayError::Internal(
            "screenpipe vision list returned success=false".into(),
        ));
    }
    Ok(parsed.data)
}
