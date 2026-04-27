use chrono::Utc;
use tauri::{AppHandle, Emitter};
use tokio::process::{Child, Command};

use crate::errors::{ReplayError, Result};
use crate::paths;
use crate::state::{AppState, CaptureMode};

/// Build the screenpipe spawn command with Replay-tuned flags (per PLAN.md §4.4).
fn build_command(
    binary: &std::path::Path,
    data_dir: &std::path::Path,
    settings: &crate::state::Settings,
) -> Command {
    let mut cmd = Command::new(binary);
    cmd.arg("record")
        .arg("--data-dir")
        .arg(data_dir)
        .arg("--audio-chunk-duration")
        .arg("5")
        .arg("--transcription-mode")
        .arg("realtime")
        .arg("--video-quality")
        .arg("high")
        .arg("--retention-days")
        .arg("1")
        .arg("--ignored-windows")
        .arg("Replay")
        .arg("--port")
        .arg("0")
        .arg("--disable-telemetry");

    if settings.use_pii_removal {
        cmd.arg("--use-pii-removal");
    }
    if settings.filter_music {
        cmd.arg("--filter-music");
    }
    if settings.disable_audio {
        cmd.arg("--disable-audio");
    }
    if let Some(monitor_id) = settings.monitor_id {
        cmd.arg("--monitor-id").arg(monitor_id.to_string());
    }

    // Inherit stderr/stdout for log forwarding (tauri sidecar pattern doesn't apply
    // here — screenpipe is a 3rd-party binary, not Replay's own sidecar).
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());
    cmd
}

pub async fn spawn_screenpipe(state: &AppState) -> Result<Child> {
    let bin = paths::screenpipe_binary_path()?;
    if !bin.exists() {
        return Err(ReplayError::BinaryMissing(bin.display().to_string()));
    }
    paths::ensure_dirs()?;
    let data_dir = paths::screenpipe_data_dir()?;
    let settings = state.settings.lock().await.clone();
    let mut cmd = build_command(&bin, &data_dir, &settings);
    let child = cmd
        .spawn()
        .map_err(|e| ReplayError::SpawnFailed(e.to_string()))?;
    log::info!(
        "screenpipe spawned pid={:?} dataDir={}",
        child.id(),
        data_dir.display()
    );
    Ok(child)
}

pub async fn start_prewarm(app: AppHandle, state: AppState) -> Result<()> {
    let mut guard = state.screenpipe_child.lock().await;
    if guard.is_some() {
        return Ok(());
    }
    *guard = Some(spawn_screenpipe(&state).await?);
    drop(guard);
    *state.mode.lock().await = CaptureMode::AlwaysWarm;
    crate::events::broadcast(&app, &state).await;
    Ok(())
}

pub async fn stop_prewarm(app: AppHandle, state: AppState) -> Result<()> {
    let mut guard = state.screenpipe_child.lock().await;
    if let Some(child) = guard.take() {
        kill_child(child).await?;
    }
    drop(guard);
    *state.mode.lock().await = CaptureMode::Fresh;
    crate::events::broadcast(&app, &state).await;
    Ok(())
}

/// Returns ISO start timestamp.
pub async fn start_recording(app: AppHandle, state: AppState) -> Result<String> {
    let mode = *state.mode.lock().await;

    // Pre-flight: ensure no recording is already in progress before we do any work.
    {
        let current = state.recording_start.lock().await;
        if current.is_some() {
            return Err(ReplayError::AlreadyRecording);
        }
    }

    if matches!(mode, CaptureMode::Fresh) {
        // Cold-spawn: start screenpipe AND wait for it to be live before
        // bookmarking the recording start. screenpipe takes ~1-2s to begin
        // capturing after process spawn — if we set recording_start at spawn
        // time, the first ~2s of the "recording" actually captures nothing.
        let mut guard = state.screenpipe_child.lock().await;
        if guard.is_none() {
            *guard = Some(spawn_screenpipe(&state).await?);
            drop(guard);
            crate::events::broadcast(&app, &state).await;
            // Brief warmup. Could be smarter (poll the DB until first row
            // appears) but a fixed delay is honest enough for v0.
            tokio::time::sleep(std::time::Duration::from_millis(1500)).await;
        }
    }
    // In always-warm mode, the child already exists and capture is already
    // live, so no warmup needed.

    let now = Utc::now().to_rfc3339();
    *state.recording_start.lock().await = Some(now.clone());

    crate::events::broadcast(&app, &state).await;
    if let Err(e) = app.emit("recording-started", &now) {
        log::warn!("emit recording-started failed: {e}");
    }
    Ok(now)
}

/// Returns (startTs, endTs).
pub async fn stop_recording(app: AppHandle, state: AppState) -> Result<(String, String)> {
    let start = {
        let mut current = state.recording_start.lock().await;
        current.take().ok_or(ReplayError::NotRecording)?
    };
    let end = Utc::now().to_rfc3339();

    let mode = *state.mode.lock().await;
    if matches!(mode, CaptureMode::Fresh) {
        // Cold-spawn: kill the child after a short flush window so trailing audio
        // chunks land in the DB. With --audio-chunk-duration 5 and
        // --transcription-mode realtime, ~3s is comfortable.
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        let mut guard = state.screenpipe_child.lock().await;
        if let Some(child) = guard.take() {
            kill_child(child).await?;
        }
    }

    crate::events::broadcast(&app, &state).await;
    if let Err(e) = app.emit("recording-stopped", &(start.clone(), end.clone())) {
        log::warn!("emit recording-stopped failed: {e}");
    }
    Ok((start, end))
}

pub async fn kill_child(mut child: Child) -> Result<()> {
    let pid = child.id();
    log::info!("sending SIGINT to screenpipe pid={pid:?}");
    if let Some(pid) = pid {
        let _ = nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            nix::sys::signal::Signal::SIGINT,
        );
    }
    // Wait up to 5s for graceful exit.
    let exit = tokio::time::timeout(std::time::Duration::from_secs(5), child.wait()).await;
    match exit {
        Ok(Ok(status)) => {
            log::info!("screenpipe exited cleanly: {status:?}");
        }
        Ok(Err(e)) => {
            log::warn!("screenpipe wait error: {e}");
        }
        Err(_) => {
            log::warn!("screenpipe did not exit on SIGINT in 5s; SIGKILL");
            let _ = child.kill().await;
            let _ = child.wait().await;
        }
    }
    Ok(())
}
