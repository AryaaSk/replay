use std::sync::OnceLock;

use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::errors::Result;

const TRAY_ID: &str = "main";

// Embed both PNGs at compile time so we never have to read from disk at runtime
// and the tray can swap instantly when capture state changes.
const IDLE_PNG: &[u8] = include_bytes!("../icons/tray-idle.png");
const CAPTURING_PNG: &[u8] = include_bytes!("../icons/tray-capturing.png");

// Dynamic menu item handles. Stored in OnceLocks so set_state can update their
// labels based on capture state. MenuItem<Wry> is Clone (Arc-wrapped under the
// hood) so storing a clone here is cheap.
static RECORD_TOGGLE_ITEM: OnceLock<MenuItem<Wry>> = OnceLock::new();

pub fn install(app: &AppHandle) -> Result<()> {
    let show_window = MenuItem::with_id(app, "show", "Open Replay", true, None::<&str>)
        .map_err(|e| crate::errors::ReplayError::Internal(format!("menubar: {e}")))?;
    let record_toggle = MenuItem::with_id(
        app,
        "record-toggle",
        "Start recording",
        true,
        None::<&str>,
    )
    .map_err(|e| crate::errors::ReplayError::Internal(format!("menubar: {e}")))?;
    let _ = RECORD_TOGGLE_ITEM.set(record_toggle.clone());
    let quit = PredefinedMenuItem::quit(app, Some("Quit Replay"))
        .map_err(|e| crate::errors::ReplayError::Internal(format!("menubar: {e}")))?;

    let menu = Menu::with_items(app, &[&show_window, &record_toggle, &quit])
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
            "record-toggle" => {
                // Mirror the in-app Record button: emit an event the frontend
                // listens for, and let App.tsx call its own handleStart /
                // handleStop. That keeps permission checks, key checks, busy
                // state, and preview rendering in one place — the tray is
                // just a thin proxy.
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
                let _ = app.emit("tray-record-toggle", ());
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

/// Swap the tray icon AND the record-toggle menu item label based on the
/// three-state ladder. Called from `events::broadcast` so the tray stays in
/// lockstep with the frontend.
pub fn set_state(app: &AppHandle, state: TrayState) {
    // Update menu label: "Start recording" when nothing is being captured for
    // a replay, "Stop recording" when one is in progress.
    if let Some(item) = RECORD_TOGGLE_ITEM.get() {
        let label = match state {
            TrayState::Recording => "Stop recording",
            // Buffering and Standby both look the same from the user's
            // perspective: there's no active replay being recorded yet.
            _ => "Start recording",
        };
        if let Err(e) = item.set_text(label) {
            log::warn!("tray.set_text failed: {e}");
        }
    }

    // Update icon.
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
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
