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
    // Empty list = use all monitors (default screenpipe behaviour).
    // Otherwise pass --monitor-id once per selected display.
    for id in &settings.monitor_ids {
        cmd.arg("--monitor-id").arg(id.to_string());
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
        // Cold-spawn: start screenpipe AND wait for it to actually begin
        // capturing before bookmarking the recording start. We poll the DB
        // for a new frame after the spawn moment — when we see one, we know
        // capture is live. Fall back to a hard 5s ceiling so a broken DB
        // doesn't hang the user forever.
        let mut guard = state.screenpipe_child.lock().await;
        if guard.is_none() {
            let spawn_marker = chrono::Utc::now().to_rfc3339();
            *guard = Some(spawn_screenpipe(&state).await?);
            drop(guard);
            crate::events::broadcast(&app, &state).await;
            wait_for_capture_live(&spawn_marker).await;
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
    // Snapshot start without consuming yet — keeping recording_start set
    // through the flush window means the dual-indicator stays in REC
    // state instead of flickering to BUF for 3s.
    let start = state
        .recording_start
        .lock()
        .await
        .clone()
        .ok_or(ReplayError::NotRecording)?;
    let end = Utc::now().to_rfc3339();

    let mode = *state.mode.lock().await;
    if matches!(mode, CaptureMode::Fresh) {
        // Cold-spawn: short flush window so trailing audio chunks land in
        // the DB before the child dies. With --audio-chunk-duration 5 and
        // --transcription-mode realtime, ~1s is comfortable; 3s was
        // overkill and made the UI feel laggy.
        tokio::time::sleep(std::time::Duration::from_millis(1000)).await;
        let mut guard = state.screenpipe_child.lock().await;
        if let Some(child) = guard.take() {
            kill_child(child).await?;
        }
    }

    // NOW clear recording_start, after the child is dead. Indicator
    // transitions cleanly: REC → STANDBY (fresh) or REC → BUF (always-warm).
    *state.recording_start.lock().await = None;

    crate::events::broadcast(&app, &state).await;
    if let Err(e) = app.emit("recording-stopped", &(start.clone(), end.clone())) {
        log::warn!("emit recording-stopped failed: {e}");
    }
    Ok((start, end))
}

/// Polls screenpipe's DB until a frame with timestamp >= `since_iso` appears,
/// or up to 5 seconds total. Returns either way — the caller bookmarks
/// recording_start regardless, but the polling means we wait the *right*
/// amount of time on each machine instead of a fixed 1.5s guess.
async fn wait_for_capture_live(since_iso: &str) {
    use std::time::{Duration, Instant};
    let deadline = Instant::now() + Duration::from_secs(5);
    let db_path = match crate::paths::screenpipe_db_path() {
        Ok(p) => p,
        Err(_) => return,
    };
    loop {
        if Instant::now() >= deadline {
            return;
        }
        if frame_appeared_since(&db_path, since_iso) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
}

fn frame_appeared_since(db_path: &std::path::Path, since_iso: &str) -> bool {
    if !db_path.exists() {
        return false;
    }
    let conn = match rusqlite::Connection::open_with_flags(
        db_path,
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
    ) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let _ = conn.busy_timeout(std::time::Duration::from_millis(200));
    let count: rusqlite::Result<i64> = conn.query_row(
        "SELECT COUNT(*) FROM frames WHERE timestamp >= ?1",
        rusqlite::params![since_iso],
        |row| row.get(0),
    );
    matches!(count, Ok(n) if n > 0)
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
