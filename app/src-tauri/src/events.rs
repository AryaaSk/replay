use tauri::{AppHandle, Emitter};

use crate::menubar::{self, TrayState};
use crate::state::AppState;

const CAPTURE_STATE_EVENT: &str = "capture-state-changed";

pub async fn broadcast(app: &AppHandle, state: &AppState) {
    let snapshot = state.snapshot_capture_state().await;
    // Three-state ladder: recording > buffering > standby. The tray icon and
    // the frontend's StateChip both render this same ladder so they can never
    // disagree about what's happening.
    let tray_state = if snapshot.recording_start.is_some() {
        TrayState::Recording
    } else if snapshot.capturing {
        TrayState::Buffering
    } else {
        TrayState::Standby
    };
    menubar::set_state(app, tray_state);
    if let Err(e) = app.emit(CAPTURE_STATE_EVENT, &snapshot) {
        log::warn!("failed to emit {CAPTURE_STATE_EVENT}: {e}");
    }
}
