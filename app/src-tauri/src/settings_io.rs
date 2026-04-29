use crate::errors::Result;
use crate::paths;
use crate::state::Settings;

pub fn load() -> Result<Settings> {
    let path = paths::settings_path()?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let bytes = std::fs::read(&path)?;
    let mut settings = match serde_json::from_slice::<Settings>(&bytes) {
        Ok(s) => s,
        Err(e) => {
            log::warn!("failed to parse settings.json: {e}; using defaults");
            return Ok(Settings::default());
        }
    };

    // Migrate legacy `monitor_id: <int|null>` (single-display, pre-multi-monitor)
    // into `monitor_ids: [<int>]`. Only apply if the new field is empty AND the
    // raw JSON still contains the old field — otherwise an empty Vec is the
    // user's actual "all monitors" selection.
    if settings.monitor_ids.is_empty() {
        if let Ok(raw) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            if let Some(legacy) = raw.get("monitor_id").and_then(|v| v.as_u64()) {
                settings.monitor_ids = vec![legacy as u32];
                log::info!("migrated legacy monitor_id={legacy} → monitor_ids");
            }
        }
    }
    Ok(settings)
}

pub fn save(settings: &Settings) -> Result<()> {
    let path = paths::settings_path()?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            crate::errors::ReplayError::Internal(format!(
                "settings save: create_dir_all({}) failed: {e}",
                parent.display()
            ))
        })?;
    }
    let bytes = serde_json::to_vec_pretty(settings)?;
    // Unique tmp suffix per call: prevents two concurrent saves from writing
    // the same file path and racing on rename. (PID + nanos is good enough —
    // collisions across calls within the same process are vanishingly rare.)
    let suffix = format!(
        "{}.{}.tmp",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0)
    );
    let tmp = path.with_extension(suffix);
    std::fs::write(&tmp, bytes).map_err(|e| {
        crate::errors::ReplayError::Internal(format!(
            "settings save: write({}) failed: {e}",
            tmp.display()
        ))
    })?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        // Clean up the orphan tmp file before returning so disk doesn't grow.
        let _ = std::fs::remove_file(&tmp);
        crate::errors::ReplayError::Internal(format!(
            "settings save: rename({} -> {}) failed: {e}",
            tmp.display(),
            path.display()
        ))
    })?;
    Ok(())
}
