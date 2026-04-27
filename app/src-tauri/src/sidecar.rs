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

    let data_dir = paths::screenpipe_data_dir()?;
    let out_dir = paths::replays_dir()?.join(replay_id);
    tokio::fs::create_dir_all(&out_dir).await?;

    // For BYOK providers, pull the key from Keychain. For local-agent providers,
    // no Replay-managed key — the agent CLI uses its own auth (claude auth, etc).
    let mut sidecar_cmd = app
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
        ]);

    if !provider.is_local_agent() {
        let api_key = keychain::get_key(provider)?
            .ok_or(ReplayError::ApiKeyMissing)?;
        let env_var_name = match provider {
            crate::state::Provider::Anthropic => "ANTHROPIC_API_KEY",
            crate::state::Provider::Openai => "OPENAI_API_KEY",
            _ => unreachable!(),
        };
        sidecar_cmd = sidecar_cmd.env(env_var_name, api_key);
    }
    let sidecar = sidecar_cmd;

    let (mut rx, _child) = sidecar
        .spawn()
        .map_err(|e| ReplayError::Sidecar(format!("spawn: {e}")))?;

    // Accumulate stderr (tail-bounded) so we can include it in the error
    // message if the sidecar exits non-zero. Without this, all the user sees
    // is "exit code Some(1)" — useless for debugging.
    let mut stderr_buf = String::new();
    let mut last_error_event: Option<String> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                let line = String::from_utf8_lossy(&bytes).to_string();
                for one in line.split('\n').filter(|s| !s.trim().is_empty()) {
                    // Sidecar emits {event: "error", message: "..."} on its
                    // own controlled failure path — capture for surfacing.
                    if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(one) {
                        if parsed.get("event").and_then(|v| v.as_str()) == Some("error") {
                            if let Some(m) = parsed.get("message").and_then(|v| v.as_str()) {
                                last_error_event = Some(m.to_string());
                            }
                        }
                    }
                    if let Err(e) = app.emit("sidecar-status", SidecarLine { line: one.into() }) {
                        log::warn!("emit sidecar-status: {e}");
                    }
                }
            }
            CommandEvent::Stderr(bytes) => {
                let line = String::from_utf8_lossy(&bytes).to_string();
                log::warn!("sidecar stderr: {}", line.trim());
                stderr_buf.push_str(&line);
                if stderr_buf.len() > 4000 {
                    stderr_buf.drain(..stderr_buf.len() - 4000);
                }
            }
            CommandEvent::Terminated(payload) => {
                if payload.code != Some(0) {
                    let detail = if let Some(m) = last_error_event {
                        m
                    } else if !stderr_buf.trim().is_empty() {
                        stderr_buf.trim().lines().rev().take(3).collect::<Vec<_>>()
                            .into_iter().rev().collect::<Vec<_>>().join(" | ")
                    } else {
                        format!("exit code {:?}, no output", payload.code)
                    };
                    return Err(ReplayError::Sidecar(detail));
                }
                break;
            }
            _ => {}
        }
    }

    Ok(out_dir.join("report.md"))
}
