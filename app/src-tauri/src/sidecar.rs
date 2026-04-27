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

    // Tee everything (stdout + stderr) to a per-replay log file so post-mortems
    // are possible when the user-facing error is necessarily truncated. The
    // log file lives at <logs_dir>/sidecar-<replay_id>.log and is plain text.
    let log_path = paths::logs_dir()?.join(format!("sidecar-{replay_id}.log"));
    if let Some(parent) = log_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }
    let mut log_file = match tokio::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
        .await
    {
        Ok(f) => Some(f),
        Err(e) => {
            log::warn!("could not open sidecar log {}: {e}", log_path.display());
            None
        }
    };
    if let Some(ref mut f) = log_file {
        let header = format!(
            "=== sidecar run {replay_id} from={start_ts} to={end_ts} ===\n"
        );
        let _ = tokio::io::AsyncWriteExt::write_all(f, header.as_bytes()).await;
    }

    let mut stderr_buf = String::new();
    let mut last_error_event: Option<String> = None;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(bytes) => {
                if let Some(ref mut f) = log_file {
                    let _ = tokio::io::AsyncWriteExt::write_all(f, b"[stdout] ").await;
                    let _ = tokio::io::AsyncWriteExt::write_all(f, &bytes).await;
                }
                let line = String::from_utf8_lossy(&bytes).to_string();
                for one in line.split('\n').filter(|s| !s.trim().is_empty()) {
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
                if let Some(ref mut f) = log_file {
                    let _ = tokio::io::AsyncWriteExt::write_all(f, b"[stderr] ").await;
                    let _ = tokio::io::AsyncWriteExt::write_all(f, &bytes).await;
                }
                let line = String::from_utf8_lossy(&bytes).to_string();
                log::warn!("sidecar stderr: {}", line.trim());
                stderr_buf.push_str(&line);
                if stderr_buf.len() > 16_000 {
                    stderr_buf.drain(..stderr_buf.len() - 16_000);
                }
            }
            CommandEvent::Terminated(payload) => {
                if let Some(ref mut f) = log_file {
                    let footer = format!("=== exit code {:?} ===\n", payload.code);
                    let _ = tokio::io::AsyncWriteExt::write_all(f, footer.as_bytes()).await;
                }
                if payload.code != Some(0) {
                    let detail = if let Some(m) = last_error_event {
                        m
                    } else if !stderr_buf.trim().is_empty() {
                        // Take the FIRST useful lines (Node error class + message
                        // live at the top of stderr, not the bottom) and append
                        // a hint to the log file for the full stack.
                        let first_lines: Vec<&str> = stderr_buf
                            .trim()
                            .lines()
                            .filter(|l| !l.trim().is_empty())
                            .take(3)
                            .collect();
                        format!(
                            "{} (full log at {})",
                            first_lines.join(" | "),
                            log_path.display()
                        )
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
