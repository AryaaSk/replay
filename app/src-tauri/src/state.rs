use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::process::Child;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CaptureMode {
    Fresh,
    AlwaysWarm,
}

#[derive(Debug, Clone, Serialize)]
pub struct CaptureState {
    pub capturing: bool,
    pub mode: CaptureMode,
    /// ISO 8601 — present when an explicit recording is in progress.
    pub recording_start: Option<String>,
    pub prewarm_active: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Anthropic,
    Openai,
}

impl Provider {
    pub fn as_str(&self) -> &'static str {
        match self {
            Provider::Anthropic => "anthropic",
            Provider::Openai => "openai",
        }
    }
    pub fn from_str(s: &str) -> Option<Self> {
        match s {
            "anthropic" => Some(Provider::Anthropic),
            "openai" => Some(Provider::Openai),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub always_warm: bool,
    pub lookback_seconds: u32,
    #[serde(default = "default_provider")]
    pub provider: Provider,
    pub model: String,
    pub monitor_id: Option<u32>,
    pub filter_music: bool,
    pub use_pii_removal: bool,
    pub redact_secrets: bool,
    pub confirm_before_send: bool,
    pub wipe_on_quit: bool,
    pub auto_copy_to_clipboard: bool,
    pub save_bundle_to_documents: bool,
    pub auto_check_screenpipe_updates: bool,
    pub pinned_screenpipe_version: Option<String>,
    pub disable_audio: bool,
}

fn default_provider() -> Provider {
    Provider::Anthropic
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            always_warm: false,
            lookback_seconds: 60,
            provider: Provider::Anthropic,
            model: "claude-sonnet-4-6".into(),
            monitor_id: None,
            filter_music: true,
            use_pii_removal: true,
            redact_secrets: true,
            confirm_before_send: true,
            wipe_on_quit: true,
            auto_copy_to_clipboard: true,
            save_bundle_to_documents: false,
            auto_check_screenpipe_updates: true,
            pinned_screenpipe_version: None,
            disable_audio: false,
        }
    }
}

/// Held inside the Tauri-managed global state. All mutable runtime state lives here.
pub struct AppStateInner {
    pub screenpipe_child: Mutex<Option<Child>>,
    pub recording_start: Mutex<Option<String>>,
    pub settings: Mutex<Settings>,
    pub mode: Mutex<CaptureMode>,
}

impl AppStateInner {
    pub fn new(settings: Settings) -> Self {
        let mode = if settings.always_warm {
            CaptureMode::AlwaysWarm
        } else {
            CaptureMode::Fresh
        };
        Self {
            screenpipe_child: Mutex::new(None),
            recording_start: Mutex::new(None),
            settings: Mutex::new(settings),
            mode: Mutex::new(mode),
        }
    }

    pub async fn snapshot_capture_state(&self) -> CaptureState {
        let mode = *self.mode.lock().await;
        let recording_start = self.recording_start.lock().await.clone();
        let prewarm_active = matches!(mode, CaptureMode::AlwaysWarm)
            && self.screenpipe_child.lock().await.is_some();
        let capturing = self.screenpipe_child.lock().await.is_some();
        CaptureState {
            capturing,
            mode,
            recording_start,
            prewarm_active,
        }
    }
}

pub type AppState = Arc<AppStateInner>;
