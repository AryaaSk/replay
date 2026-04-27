use tauri::{AppHandle, Emitter};

use crate::menubar;
use crate::state::AppState;

const CAPTURE_STATE_EVENT: &str = "capture-state-changed";

pub async fn broadcast(app: &AppHandle, state: &AppState) {
    let snapshot = state.snapshot_capture_state().await;
    // Keep the tray icon in lockstep with the frontend indicator. The user is
    // always told when capture is happening, regardless of whether the main
    // window is visible (PLAN.md §7).
    menubar::set_capturing(app, snapshot.capturing);
    if let Err(e) = app.emit(CAPTURE_STATE_EVENT, &snapshot) {
        log::warn!("failed to emit {CAPTURE_STATE_EVENT}: {e}");
    }
}
