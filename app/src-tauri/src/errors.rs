use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum ReplayError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),

    #[error("network: {0}")]
    Network(#[from] reqwest::Error),

    #[error("json: {0}")]
    Json(#[from] serde_json::Error),

    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),

    #[error("checksum mismatch: expected {expected}, got {got}")]
    ChecksumMismatch { expected: String, got: String },

    #[error("screenpipe binary missing: {0}")]
    BinaryMissing(String),

    #[error("screenpipe spawn failed: {0}")]
    SpawnFailed(String),

    #[error("not recording")]
    NotRecording,

    #[error("already recording")]
    AlreadyRecording,

    #[error("keychain: {0}")]
    Keychain(String),

    #[error("api key missing")]
    ApiKeyMissing,

    #[error("sidecar: {0}")]
    Sidecar(String),

    #[error("invalid state: {0}")]
    InvalidState(String),

    #[error("internal: {0}")]
    Internal(String),
}

// Errors are serialized to the frontend as plain strings via Tauri commands.
impl Serialize for ReplayError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub type Result<T> = std::result::Result<T, ReplayError>;
