use std::sync::Arc;

use serde::Serialize;

mod errors;
mod events;
mod installer;
mod janitor;
mod keychain;
mod menubar;
mod paths;
mod recording;
mod replays;
mod settings_io;
mod sidecar;
mod state;

use errors::{ReplayError, Result};
use state::{AppState, AppStateInner, CaptureMode, Provider, Settings};

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
    let id = replays::new_id();
    let report_path = sidecar::run_render(&app, &start_ts, &end_ts, &id).await?;
    Ok(StopResult {
        replay_id: id,
        report_path: report_path.display().to_string(),
        start_ts,
        end_ts,
    })
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
async fn has_api_key(provider: String) -> Result<bool> {
    let p = Provider::from_str(&provider)
        .ok_or_else(|| ReplayError::Internal(format!("unknown provider: {provider}")))?;
    Ok(keychain::get_key(p)?.is_some())
}

#[tauri::command]
async fn set_api_key(provider: String, key: String) -> Result<()> {
    let p = Provider::from_str(&provider)
        .ok_or_else(|| ReplayError::Internal(format!("unknown provider: {provider}")))?;
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    env_logger::init();
    if let Err(e) = paths::ensure_dirs() {
        eprintln!("warning: ensure_dirs failed: {e}");
    }
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
            get_settings,
            set_settings,
            get_capture_state,
            has_api_key,
            set_api_key,
            quit_capturing,
            open_replay_dir,
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
