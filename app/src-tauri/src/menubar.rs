use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager};

use crate::errors::Result;

const TRAY_ID: &str = "main";

// Embed both PNGs at compile time so we never have to read from disk at runtime
// and the tray can swap instantly when capture state changes.
const IDLE_PNG: &[u8] = include_bytes!("../icons/tray-idle.png");
const CAPTURING_PNG: &[u8] = include_bytes!("../icons/tray-capturing.png");

pub fn install(app: &AppHandle) -> Result<()> {
    let show_window = MenuItem::with_id(app, "show", "Open Replay", true, None::<&str>)
        .map_err(|e| crate::errors::ReplayError::Internal(format!("menubar: {e}")))?;
    let stop_capture = MenuItem::with_id(
        app,
        "stop-capture",
        "Stop capturing now",
        true,
        None::<&str>,
    )
    .map_err(|e| crate::errors::ReplayError::Internal(format!("menubar: {e}")))?;
    let quit = PredefinedMenuItem::quit(app, Some("Quit Replay"))
        .map_err(|e| crate::errors::ReplayError::Internal(format!("menubar: {e}")))?;

    let menu = Menu::with_items(app, &[&show_window, &stop_capture, &quit])
        .map_err(|e| crate::errors::ReplayError::Internal(format!("menubar: {e}")))?;

    let idle_image = Image::from_bytes(IDLE_PNG)
        .map_err(|e| crate::errors::ReplayError::Internal(format!("idle icon: {e}")))?;

    TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .icon(idle_image)
        .icon_as_template(true) // recolour to match menubar in idle
        .on_menu_event(|app, event: MenuEvent| match event.id.as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "stop-capture" => {
                // If a recording is in progress, do the full Stop + Render flow
                // (same as the in-app stop button) so the user gets their replay.
                // Otherwise just kill any always-warm screenpipe child as an
                // emergency capture-stop.
                let app_clone = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = app_clone.state::<crate::state::AppState>();
                    let recording_active = state.recording_start.lock().await.is_some();

                    if recording_active {
                        match crate::recording::stop_recording(app_clone.clone(), state.inner().clone()).await {
                            Ok((start_ts, end_ts)) => {
                                let id = crate::replays::new_id();
                                match crate::sidecar::run_render(&app_clone, &start_ts, &end_ts, &id).await {
                                    Ok(_) => {
                                        let _ = app_clone.emit("tray-replay-rendered", &id);
                                    }
                                    Err(e) => {
                                        log::error!("tray render failed: {e}");
                                        let _ = app_clone.emit("tray-stop-error", &e.to_string());
                                    }
                                }
                            }
                            Err(e) => log::error!("tray stop_recording failed: {e}"),
                        }
                    } else {
                        if let Some(child) = state.screenpipe_child.lock().await.take() {
                            let _ = crate::recording::kill_child(child).await;
                        }
                    }
                    *state.mode.lock().await = crate::state::CaptureMode::Fresh;
                    crate::events::broadcast(&app_clone, &state).await;
                    let _ = app_clone.emit("capture-stopped-from-tray", ());
                });
            }
            _ => {}
        })
        .build(app)
        .map_err(|e| crate::errors::ReplayError::Internal(format!("tray build: {e}")))?;

    Ok(())
}

#[derive(Debug, Clone, Copy)]
pub enum TrayState {
    Standby,    // screenpipe not running
    Buffering,  // screenpipe alive, no active recording (always-warm)
    Recording,  // user is bracketing a window
}

/// Swap the tray icon based on the three-state ladder.
/// Called from `events::broadcast` so it stays in lockstep with the frontend.
pub fn set_state(app: &AppHandle, state: TrayState) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    // For now we only have two PNG assets (idle ring + filled red dot).
    // Map: Standby → idle template; Buffering → idle non-template (so it
    // shows the ring shape but in its native colour, distinguishing from
    // standby); Recording → filled red dot. A future refinement could ship
    // a third PNG for buffering specifically.
    let (bytes, is_template) = match state {
        TrayState::Standby => (IDLE_PNG, true),
        TrayState::Buffering => (IDLE_PNG, false),
        TrayState::Recording => (CAPTURING_PNG, false),
    };
    match Image::from_bytes(bytes) {
        Ok(img) => {
            if let Err(e) = tray.set_icon(Some(img)) {
                log::warn!("tray.set_icon failed: {e}");
            }
            if let Err(e) = tray.set_icon_as_template(is_template) {
                log::warn!("tray.set_icon_as_template failed: {e}");
            }
        }
        Err(e) => log::warn!("tray icon decode failed: {e}"),
    }
}

// Backwards-compat shim — kept while events.rs still calls set_capturing.
pub fn set_capturing(app: &AppHandle, capturing: bool) {
    set_state(app, if capturing { TrayState::Recording } else { TrayState::Standby });
}
