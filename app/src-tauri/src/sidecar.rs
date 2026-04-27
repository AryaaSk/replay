use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;

use crate::errors::{ReplayError, Result};
use crate::keychain;
use crate::paths;
use crate::state::{AppState, Settings};

#[derive(Serialize, Clone)]
pub struct SidecarLine {
    pub line: String,
}

/// Spawn the bundled `replay-cli` sidecar and stream its stdout (one JSON object
/// per line) back to the frontend via the `sidecar-status` event.
///
/// Returns the path to the produced report.md once the sidecar exits successfully.
pub async fn run_render(
    app: &AppHandle,
    start_ts: &str,
    end_ts: &str,
    replay_id: &str,
) -> Result<std::path::PathBuf> {
    // Snapshot settings once: cloning out of the guard frees the borrow
    // before the enclosing block ends.
    let settings_snapshot: Settings = {
        let state = app.state::<AppState>();
        let cloned = state.settings.lock().await.clone();
        cloned
    };
    let provider = settings_snapshot.provider;
    let settings_json = serde_json::to_string(&settings_snapshot).unwrap_or_else(|_| "{}".into());

    let api_key = keychain::get_key(provider)?
        .ok_or(ReplayError::ApiKeyMissing)?;
    let env_var_name = match provider {
        crate::state::Provider::Anthropic => "ANTHROPIC_API_KEY",
        crate::state::Provider::Openai => "OPENAI_API_KEY",
    };

    let data_dir = paths::screenpipe_data_dir()?;
    let out_dir = paths::replays_dir()?.join(replay_id);
    tokio::fs::create_dir_all(&out_dir).await?;

    let sidecar = app
        .shell()
        .sidecar("replay-cli")
        .map_err(|e| ReplayError::Sidecar(format!("locate sidecar: {e}")))?
        .args([
            "--from",
            start_ts,
            "--to",
            end_ts,
            "--data-dir",
            &data_dir.display().to_string(),
            "--out",
            &out_dir.display().to_string(),
            "--replay-id",
            replay_id,
            "--settings",
            &settings_json,
        ])
        .env(env_var_name, api_key);

    let (mut rx, _child) = sidecar
        .spawn()
        .map_err(|e| ReplayError::Sidecar(format!("spawn: {e}")))?;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes).to_string();
                for one in line.split('\n').filter(|s| !s.trim().is_empty()) {
                    if let Err(e) = app.emit("sidecar-status", SidecarLine { line: one.into() }) {
                        log::warn!("emit sidecar-status: {e}");
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).to_string();
                log::warn!("sidecar stderr: {}", line.trim());
            }
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    return Err(ReplayError::Sidecar(format!(
                        "exit code {:?}",
                        payload.code
                    )));
                }
                break;
            }
            _ => {}
        }
    }

    Ok(out_dir.join("report.md"))
}
