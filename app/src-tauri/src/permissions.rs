use std::time::Duration;

use serde::Serialize;
use tokio::io::AsyncBufReadExt;

use crate::errors::{ReplayError, Result};
use crate::paths;

#[derive(Debug, Serialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum PermissionStatus {
    Ok,
    Denied,
    Unknown,
}

#[derive(Debug, Serialize, Clone)]
pub struct PermissionsReport {
    pub screen_recording: PermissionStatus,
    pub microphone: PermissionStatus,
    pub accessibility: PermissionStatus,
    /// True when the report comes from a fresh screenpipe-startup probe.
    /// False if we couldn't run the probe (binary missing).
    pub fresh: bool,
}

impl PermissionsReport {
    pub fn unknown() -> Self {
        Self {
            screen_recording: PermissionStatus::Unknown,
            microphone: PermissionStatus::Unknown,
            accessibility: PermissionStatus::Unknown,
            fresh: false,
        }
    }
}

/// Spawns the managed screenpipe binary briefly with a tiny temp data dir,
/// reads its first ~5 seconds of stderr looking for the
/// "screen recording: ok / microphone: ok / accessibility: ok" lines it
/// prints during startup, then kills the process.
///
/// This is the authoritative source of truth — macOS scopes permissions to
/// the screenpipe binary path, so checking Replay's own process (e.g. via
/// CGPreflightScreenCaptureAccess) would report the wrong thing.
pub async fn check_via_probe() -> Result<PermissionsReport> {
    let bin = paths::screenpipe_binary_path()?;
    if !bin.exists() {
        return Ok(PermissionsReport::unknown());
    }

    // Use a unique tmp data dir so the probe doesn't pollute the real
    // .screenpipe state and doesn't race with an active screenpipe instance.
    let tmp_dir = std::env::temp_dir()
        .join(format!("replay-permcheck-{}", std::process::id()));
    let _ = tokio::fs::create_dir_all(&tmp_dir).await;

    let mut cmd = tokio::process::Command::new(&bin);
    cmd.arg("record")
        .arg("--data-dir")
        .arg(&tmp_dir)
        .arg("--port")
        .arg("0")
        .arg("--disable-telemetry")
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::null());

    let mut child = cmd
        .spawn()
        .map_err(|e| ReplayError::SpawnFailed(format!("permcheck spawn: {e}")))?;

    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| ReplayError::Internal("permcheck: no stderr pipe".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ReplayError::Internal("permcheck: no stdout pipe".into()))?;

    let combined = futures_util::stream::select(
        tokio_stream::wrappers::LinesStream::new(tokio::io::BufReader::new(stderr).lines()),
        tokio_stream::wrappers::LinesStream::new(tokio::io::BufReader::new(stdout).lines()),
    );

    let report =
        tokio::time::timeout(Duration::from_secs(8), parse_permission_lines(combined)).await;

    // Kill regardless of result. SIGINT first; SIGKILL if it ignores us.
    if let Some(pid) = child.id() {
        let _ = nix::sys::signal::kill(
            nix::unistd::Pid::from_raw(pid as i32),
            nix::sys::signal::Signal::SIGINT,
        );
    }
    let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
    let _ = child.kill().await;
    let _ = child.wait().await;

    // Best-effort cleanup
    let _ = tokio::fs::remove_dir_all(&tmp_dir).await;

    let mut report = match report {
        Ok(r) => r,
        Err(_) => PermissionsReport::unknown(),
    };
    report.fresh = true;
    Ok(report)
}

async fn parse_permission_lines<S>(mut stream: S) -> PermissionsReport
where
    S: futures_util::Stream<Item = std::io::Result<String>> + Unpin,
{
    use futures_util::StreamExt;
    let mut report = PermissionsReport::unknown();
    let mut seen = 0u8;
    while let Some(Ok(raw)) = stream.next().await {
        let line = raw.to_lowercase();
        // Strip ANSI escape codes that show up in screenpipe's coloured logs.
        let line = strip_ansi(&line);
        if let Some(status) = parse_status_line(&line, "screen recording") {
            report.screen_recording = status;
            seen |= 1;
        } else if let Some(status) = parse_status_line(&line, "microphone") {
            report.microphone = status;
            seen |= 2;
        } else if let Some(status) = parse_status_line(&line, "accessibility") {
            report.accessibility = status;
            seen |= 4;
        }
        if seen == 7 {
            // All three captured; can return early.
            return report;
        }
    }
    report
}

fn parse_status_line(line: &str, label: &str) -> Option<PermissionStatus> {
    let idx = line.find(label)?;
    let after = &line[idx + label.len()..];
    if !after.contains(':') {
        return None;
    }
    let value = after.split(':').nth(1)?.trim();
    if value.starts_with("ok") || value.starts_with("granted") || value.starts_with("authorized") {
        Some(PermissionStatus::Ok)
    } else if value.starts_with("denied")
        || value.starts_with("missing")
        || value.starts_with("not")
        || value.starts_with("blocked")
    {
        Some(PermissionStatus::Denied)
    } else {
        None
    }
}

fn strip_ansi(s: &str) -> String {
    // Minimal ANSI escape stripper — we don't need full ECMA-48 support.
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            // Skip ESC + bracket + parameters until terminator
            if matches!(chars.peek(), Some('[')) {
                chars.next();
                while let Some(&n) = chars.peek() {
                    chars.next();
                    if n.is_alphabetic() {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(c);
    }
    out
}

/// Open a System Settings pane for the user to grant a specific permission.
/// Uses the documented x-apple.systempreferences URL scheme.
pub fn open_settings_pane(kind: &str) -> Result<()> {
    let target = match kind {
        "screen-recording" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
        }
        "microphone" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"
        }
        "accessibility" => {
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
        }
        other => {
            return Err(ReplayError::Internal(format!(
                "unknown settings pane: {other}"
            )));
        }
    };
    let _ = std::process::Command::new("open").arg(target).spawn();
    Ok(())
}
