use std::path::PathBuf;

use crate::errors::{ReplayError, Result};

const APP_SUPPORT_SUBDIR: &str = "Replay";

/// Returns ~/Library/Application Support/Replay
pub fn app_support_dir() -> Result<PathBuf> {
    let home = std::env::var_os("HOME")
        .ok_or_else(|| ReplayError::Internal("HOME not set".into()))?;
    Ok(PathBuf::from(home)
        .join("Library/Application Support")
        .join(APP_SUPPORT_SUBDIR))
}

pub fn bin_dir() -> Result<PathBuf> {
    Ok(app_support_dir()?.join("bin"))
}

pub fn screenpipe_binary_path() -> Result<PathBuf> {
    Ok(bin_dir()?.join("screenpipe"))
}

pub fn screenpipe_data_dir() -> Result<PathBuf> {
    Ok(app_support_dir()?.join(".screenpipe"))
}

pub fn screenpipe_db_path() -> Result<PathBuf> {
    Ok(screenpipe_data_dir()?.join("db.sqlite"))
}

pub fn replays_dir() -> Result<PathBuf> {
    Ok(app_support_dir()?.join("replays"))
}

pub fn settings_path() -> Result<PathBuf> {
    Ok(app_support_dir()?.join("settings.json"))
}

pub fn logs_dir() -> Result<PathBuf> {
    Ok(app_support_dir()?.join("logs"))
}

/// Ensure all top-level Replay directories exist.
pub fn ensure_dirs() -> Result<()> {
    for dir in [
        app_support_dir()?,
        bin_dir()?,
        screenpipe_data_dir()?,
        replays_dir()?,
        logs_dir()?,
    ] {
        std::fs::create_dir_all(dir)?;
    }
    Ok(())
}
