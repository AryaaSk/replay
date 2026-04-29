use std::sync::Arc;

use serde::Serialize;
use tauri::Emitter;

mod agent;
mod errors;
mod events;
mod installer;
mod janitor;
mod keychain;
mod menubar;
mod monitors;
mod paths;
mod permissions;
mod recording;
mod replays;
mod settings_io;
mod sidecar;
mod state;

use errors::{ReplayError, Result};
use state::{AppState, AppStateInner, CaptureMode, Provider, Settings};

/// Catches Rust panics anywhere in the Tauri process and appends them to
/// ~/Library/Application Support/Replay/logs/panic.log. macOS's native crash
/// reporter still fires too, but our log gives us a clean Rust-side trace
/// without the user having to dig through Console.app or symbolicate.
fn install_panic_hook() {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let msg = format!(
            "[{}] panic: {}\nlocation: {:?}\nbacktrace:\n{}\n",
            chrono::Utc::now().to_rfc3339(),
            info.payload()
                .downcast_ref::<&str>()
                .map(|s| s.to_string())
                .or_else(|| info.payload().downcast_ref::<String>().cloned())
                .unwrap_or_else(|| "<non-string panic payload>".into()),
            info.location().map(|l| l.to_string()),
            std::backtrace::Backtrace::force_capture(),
        );
        eprintln!("{msg}");
        if let Ok(dir) = paths::logs_dir() {
            let path = dir.join("panic.log");
            if let Ok(mut f) = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
            {
                use std::io::Write;
                let _ = writeln!(f, "{msg}");
            }
        }
        prev(info);
    }));
}

#[derive(Serialize)]
struct SetupStatus {
    binary_installed: bool,
    binary_version: Option<String>,
}

#[tauri::command]
async fn setup_check() -> Result<SetupStatus> {
    let installed = installer::is_installed()?;
    let version = if installed {
        installer::installed_version().await.ok().flatten()
    } else {
        None
    };
    Ok(SetupStatus {
        binary_installed: installed,
        binary_version: version,
    })
}

#[tauri::command]
async fn install_screenpipe(app: tauri::AppHandle) -> Result<String> {
    paths::ensure_dirs()?;
    installer::install(&app, installer::PINNED_VERSION).await
}

#[tauri::command]
async fn start_prewarm(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<()> {
    recording::start_prewarm(app, state.inner().clone()).await
}

#[tauri::command]
async fn stop_prewarm(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<()> {
    recording::stop_prewarm(app, state.inner().clone()).await
}

#[tauri::command]
async fn start_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<String> {
    recording::start_recording(app, state.inner().clone()).await
}

#[derive(Serialize)]
struct StopResult {
    replay_id: String,
    report_path: String,
    start_ts: String,
    end_ts: String,
}

#[tauri::command]
async fn stop_recording(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<StopResult> {
    let (start_ts, end_ts) =
        recording::stop_recording(app.clone(), state.inner().clone()).await?;
    let initial_id = replays::new_id();

    // Pre-create the replay dir + stub metadata so the frontend can navigate
    // immediately and list_replays sees the new entry with a "processing" flag.
    let dir = paths::replays_dir()?.join(&initial_id);
    tokio::fs::create_dir_all(&dir).await?;
    let duration_ms = (chrono::DateTime::parse_from_rfc3339(&end_ts)
        .map(|d| d.timestamp_millis())
        .unwrap_or(0))
        - (chrono::DateTime::parse_from_rfc3339(&start_ts)
            .map(|d| d.timestamp_millis())
            .unwrap_or(0));
    let stub = serde_json::json!({
        "id": initial_id,
        "title": "(processing…)",
        "startTs": start_ts,
        "endTs": end_ts,
        "durationMs": duration_ms,
        "createdAt": chrono::Utc::now().to_rfc3339(),
        "processing": true,
    });
    tokio::fs::write(dir.join("metadata.json"), serde_json::to_vec_pretty(&stub)?).await?;

    // Render asynchronously: spawn it, return the initial id NOW. Frontend
    // navigates to the preview view with this id, listens for render-complete
    // / render-error to know when it's done. The id may change due to slug
    // rename so render-complete carries both.
    spawn_render_task(app, start_ts.clone(), end_ts.clone(), initial_id.clone());

    Ok(StopResult {
        replay_id: initial_id,
        report_path: String::new(),
        start_ts,
        end_ts,
    })
}

/// Re-run the sidecar against an existing replay's recording window. Useful
/// after a render crash / when the user wants to switch providers and try again
/// over the same captured data.
#[tauri::command]
async fn rerender_replay(app: tauri::AppHandle, id: String) -> Result<()> {
    let detail = replays::read_detail(&id)?;
    // Mark the existing metadata as processing so the UI shows the loader.
    let metadata_path = paths::replays_dir()?.join(&id).join("metadata.json");
    if let Ok(raw) = tokio::fs::read(&metadata_path).await {
        if let Ok(mut obj) = serde_json::from_slice::<serde_json::Value>(&raw) {
            obj["processing"] = serde_json::Value::Bool(true);
            let _ = tokio::fs::write(&metadata_path, serde_json::to_vec_pretty(&obj)?).await;
        }
    }
    spawn_render_task(app, detail.start_ts, detail.end_ts, id);
    Ok(())
}

fn spawn_render_task(app: tauri::AppHandle, start_ts: String, end_ts: String, id: String) {
    tauri::async_runtime::spawn(async move {
        match sidecar::run_render(&app, &start_ts, &end_ts, &id).await {
            Ok(render) => {
                let _ = app.emit(
                    "render-complete",
                    serde_json::json!({
                        "initialId": id,
                        "finalId": render.replay_id,
                        "reportPath": render.report_path.display().to_string(),
                    }),
                );
            }
            Err(e) => {
                let _ = app.emit(
                    "render-error",
                    serde_json::json!({
                        "initialId": id,
                        "error": e.to_string(),
                    }),
                );
            }
        }
    });
}

#[tauri::command]
async fn list_replays() -> Result<Vec<replays::ReplaySummary>> {
    replays::list()
}

#[tauri::command]
async fn read_replay(id: String) -> Result<String> {
    replays::read_report(&id)
}

#[tauri::command]
async fn read_replay_detail(id: String) -> Result<replays::ReplayDetail> {
    replays::read_detail(&id)
}

#[tauri::command]
async fn read_replay_frame(id: String, filename: String) -> Result<Vec<u8>> {
    replays::read_frame(&id, &filename)
}

#[tauri::command]
async fn delete_replay(id: String) -> Result<()> {
    replays::delete(&id)
}

#[tauri::command]
async fn delete_all_replays() -> Result<u32> {
    replays::delete_all()
}

/// Nuclear reset: stops capture if running, wipes the entire Replay-managed
/// disk state including replays, screenpipe data, sidecar logs, and Claude
/// Code session transcripts that match Replay paths. Keychain entries and
/// settings are preserved.
#[tauri::command]
async fn wipe_all_state(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<()> {
    // Kill any running screenpipe child first
    if let Some(child) = state.screenpipe_child.lock().await.take() {
        let _ = recording::kill_child(child).await;
    }
    *state.recording_start.lock().await = None;
    *state.mode.lock().await = CaptureMode::Fresh;

    replays::delete_all()?;

    // Wipe screenpipe data dir (everything except the dir itself)
    let sp_dir = paths::screenpipe_data_dir()?;
    if sp_dir.exists() {
        for entry in std::fs::read_dir(&sp_dir).map_err(|e| {
            ReplayError::Internal(format!("read_dir({}): {e}", sp_dir.display()))
        })? {
            let entry = entry.map_err(|e| ReplayError::Internal(format!("read_dir entry: {e}")))?;
            let p = entry.path();
            if p.is_dir() {
                let _ = std::fs::remove_dir_all(&p);
            } else {
                let _ = std::fs::remove_file(&p);
            }
        }
    }

    // Wipe sidecar logs
    let logs_dir = paths::logs_dir()?;
    if logs_dir.exists() {
        for entry in std::fs::read_dir(&logs_dir).map_err(|e| {
            ReplayError::Internal(format!("read_dir({}): {e}", logs_dir.display()))
        })? {
            if let Ok(e) = entry {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }

    // Wipe Claude Code session transcripts that match Replay paths.
    // Path encoding: ~/.claude/projects/-Users-...-Replay-replays-<id>/
    if let Ok(home) = std::env::var("HOME") {
        let projects = std::path::Path::new(&home).join(".claude").join("projects");
        if projects.exists() {
            if let Ok(read) = std::fs::read_dir(&projects) {
                for entry in read.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if name.contains("Replay-replays") {
                            let _ = std::fs::remove_dir_all(entry.path());
                        }
                    }
                }
            }
        }
    }

    crate::events::broadcast(&app, &state.inner().clone()).await;
    Ok(())
}

#[tauri::command]
async fn get_settings(state: tauri::State<'_, AppState>) -> Result<Settings> {
    Ok(state.settings.lock().await.clone())
}

#[tauri::command]
async fn set_settings(
    new_settings: Settings,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    settings_io::save(&new_settings)?;
    let new_mode = if new_settings.always_warm {
        CaptureMode::AlwaysWarm
    } else {
        CaptureMode::Fresh
    };
    let prev_mode = *state.mode.lock().await;
    *state.settings.lock().await = new_settings;

    // Apply mode change side effects.
    if prev_mode != new_mode {
        match new_mode {
            CaptureMode::AlwaysWarm => {
                recording::start_prewarm(app.clone(), state.inner().clone()).await?;
            }
            CaptureMode::Fresh => {
                recording::stop_prewarm(app.clone(), state.inner().clone()).await?;
            }
        }
    }
    *state.mode.lock().await = new_mode;
    events::broadcast(&app, &state.inner().clone()).await;
    Ok(())
}

#[tauri::command]
async fn get_capture_state(state: tauri::State<'_, AppState>) -> Result<state::CaptureState> {
    Ok(state.snapshot_capture_state().await)
}

#[tauri::command]
async fn agent_status() -> Result<agent::AgentStatus> {
    Ok(agent::detect().await)
}

#[tauri::command]
async fn check_permissions() -> Result<permissions::PermissionsReport> {
    permissions::check_via_probe().await
}

#[tauri::command]
async fn list_monitors() -> Result<Vec<monitors::MonitorInfo>> {
    monitors::list().await
}

#[tauri::command]
async fn open_permission_settings(kind: String) -> Result<()> {
    permissions::open_settings_pane(&kind)
}

#[tauri::command]
async fn has_api_key(provider: String) -> Result<bool> {
    let p = Provider::from_str(&provider)
        .ok_or_else(|| ReplayError::Internal(format!("unknown provider: {provider}")))?;
    // Local agents don't need a Replay-managed key; they use the CLI's own auth.
    if p.is_local_agent() {
        return Ok(true);
    }
    Ok(keychain::get_key(p)?.is_some())
}

#[tauri::command]
async fn set_api_key(provider: String, key: String) -> Result<()> {
    let p = Provider::from_str(&provider)
        .ok_or_else(|| ReplayError::Internal(format!("unknown provider: {provider}")))?;
    if p.is_local_agent() {
        return Err(ReplayError::Internal(
            "local-agent providers don't use Replay-managed keys".into(),
        ));
    }
    if key.trim().is_empty() {
        keychain::delete_key(p)?;
    } else {
        keychain::set_key(p, &key)?;
    }
    Ok(())
}

#[tauri::command]
async fn quit_capturing(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<()> {
    if let Some(child) = state.screenpipe_child.lock().await.take() {
        recording::kill_child(child).await?;
    }
    *state.mode.lock().await = CaptureMode::Fresh;
    *state.recording_start.lock().await = None;
    let mut s = state.settings.lock().await.clone();
    s.always_warm = false;
    settings_io::save(&s)?;
    *state.settings.lock().await = s;
    events::broadcast(&app, &state.inner().clone()).await;
    Ok(())
}

#[tauri::command]
async fn open_replay_dir(id: String) -> Result<()> {
    let path = paths::replays_dir()?.join(&id);
    if !path.exists() {
        return Err(ReplayError::Internal(format!(
            "no replay at {}",
            path.display()
        )));
    }
    let _ = std::process::Command::new("open").arg(&path).spawn();
    Ok(())
}

/// Opens one of the well-known Replay-managed directories in Finder.
/// kind: "root" | "replays" | "screenpipe" | "logs"
#[tauri::command]
async fn open_app_folder(kind: String) -> Result<()> {
    let path = match kind.as_str() {
        "root" => paths::app_support_dir()?,
        "replays" => paths::replays_dir()?,
        "screenpipe" => paths::screenpipe_data_dir()?,
        "logs" => paths::logs_dir()?,
        other => {
            return Err(ReplayError::Internal(format!(
                "unknown folder kind: {other}"
            )));
        }
    };
    paths::ensure_dirs()?; // create if missing so Finder doesn't error
    let _ = std::process::Command::new("open").arg(&path).spawn();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    if let Err(e) = paths::ensure_dirs() {
        eprintln!("warning: ensure_dirs failed: {e}");
    }
    install_panic_hook();
    let settings = settings_io::load().unwrap_or_default();
    let app_state: AppState = Arc::new(AppStateInner::new(settings.clone()));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state.clone())
        .invoke_handler(tauri::generate_handler![
            setup_check,
            install_screenpipe,
            start_prewarm,
            stop_prewarm,
            start_recording,
            stop_recording,
            list_replays,
            read_replay,
            read_replay_detail,
            read_replay_frame,
            delete_replay,
            delete_all_replays,
            wipe_all_state,
            rerender_replay,
            get_settings,
            set_settings,
            get_capture_state,
            has_api_key,
            set_api_key,
            agent_status,
            check_permissions,
            list_monitors,
            open_permission_settings,
            quit_capturing,
            open_replay_dir,
            open_app_folder,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let state_for_janitor = app_state.clone();
            janitor::spawn(handle.clone(), state_for_janitor);

            // If always-warm is on at boot, fire it up.
            if settings.always_warm {
                let s2 = app_state.clone();
                let h2 = handle.clone();
                tauri::async_runtime::spawn(async move {
                    if let Err(e) = recording::start_prewarm(h2, s2).await {
                        log::warn!("boot prewarm failed: {e}");
                    }
                });
            }

            // Tray icon
            if let Err(e) = menubar::install(&handle) {
                log::warn!("tray install failed: {e}");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
