use crate::errors::Result;
use crate::paths;
use crate::state::Settings;

pub fn load() -> Result<Settings> {
    let path = paths::settings_path()?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let bytes = std::fs::read(&path)?;
    match serde_json::from_slice::<Settings>(&bytes) {
        Ok(s) => Ok(s),
        Err(e) => {
            log::warn!("failed to parse settings.json: {e}; using defaults");
            Ok(Settings::default())
        }
    }
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
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, bytes).map_err(|e| {
        crate::errors::ReplayError::Internal(format!(
            "settings save: write({}) failed: {e}",
            tmp.display()
        ))
    })?;
    std::fs::rename(&tmp, &path).map_err(|e| {
        crate::errors::ReplayError::Internal(format!(
            "settings save: rename({} -> {}) failed: {e}",
            tmp.display(),
            path.display()
        ))
    })?;
    Ok(())
}
