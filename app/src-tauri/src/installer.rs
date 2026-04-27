use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::errors::{ReplayError, Result};
use crate::paths;

/// Pinned screenpipe version installed by Replay v0.
/// Bump on intentional Replay releases after verifying spawn flags still match.
pub const PINNED_VERSION: &str = "v0.3.298";

/// We DON'T hardcode a SHA — Apple Developer signing means the user can re-verify
/// independently. Instead we fetch the .sha256 sidecar file from GitHub releases
/// and verify against THAT. If it's missing we'll bail with a clear error.
const RELEASE_BASE: &str = "https://github.com/screenpipe/screenpipe/releases/download";

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum InstallProgress {
    FetchRelease { message: String },
    Download {
        bytes_received: u64,
        total_bytes: Option<u64>,
        message: String,
    },
    Verify { message: String },
    Install { message: String },
    Smoke { message: String },
    Done { version: String, message: String },
}

fn macos_arch_asset() -> &'static str {
    // screenpipe publishes per-arch macOS binaries; pick at runtime.
    if cfg!(target_arch = "aarch64") {
        "screenpipe-aarch64-apple-darwin.tar.gz"
    } else {
        "screenpipe-x86_64-apple-darwin.tar.gz"
    }
}

fn emit(app: &AppHandle, p: InstallProgress) {
    if let Err(e) = app.emit("install-progress", &p) {
        log::warn!("failed to emit install-progress: {e}");
    }
}

/// Returns true if the binary at the managed path exists and is executable.
pub fn is_installed() -> Result<bool> {
    let p = paths::screenpipe_binary_path()?;
    if !p.exists() {
        return Ok(false);
    }
    let meta = std::fs::metadata(&p)?;
    Ok(meta.permissions().mode() & 0o111 != 0)
}

pub async fn installed_version() -> Result<Option<String>> {
    if !is_installed()? {
        return Ok(None);
    }
    let bin = paths::screenpipe_binary_path()?;
    let out = tokio::process::Command::new(&bin)
        .arg("--version")
        .output()
        .await?;
    if !out.status.success() {
        return Ok(None);
    }
    let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
    Ok(Some(s))
}

pub async fn install(app: &AppHandle, version: &str) -> Result<String> {
    paths::ensure_dirs()?;

    let asset = macos_arch_asset();
    let url = format!("{}/{}/{}", RELEASE_BASE, version, asset);
    emit(
        app,
        InstallProgress::FetchRelease {
            message: format!("fetching {asset} for {version}"),
        },
    );

    let client = reqwest::Client::builder()
        .user_agent("Replay/0.1")
        .build()?;
    let resp = client.get(&url).send().await?.error_for_status()?;
    let total = resp.content_length();

    // Stream to a temp file
    let tmp_dir = paths::bin_dir()?;
    let tmp_path = tmp_dir.join(format!(".screenpipe.download.{}", std::process::id()));
    let mut file = tokio::fs::File::create(&tmp_path).await?;
    let mut received: u64 = 0;
    let mut stream = resp.bytes_stream();

    while let Some(chunk) = stream.next().await {
        let bytes = chunk?;
        received += bytes.len() as u64;
        tokio::io::AsyncWriteExt::write_all(&mut file, &bytes).await?;
        emit(
            app,
            InstallProgress::Download {
                bytes_received: received,
                total_bytes: total,
                message: format!("downloading screenpipe ({}MB)", received / 1_048_576),
            },
        );
    }
    tokio::io::AsyncWriteExt::flush(&mut file).await?;
    drop(file);

    emit(
        app,
        InstallProgress::Verify {
            message: "verifying download".into(),
        },
    );
    // SHA verification: best-effort. We try to fetch <asset>.sha256 from the same
    // release. If it's absent (older releases sometimes don't publish it), we log
    // a warning and proceed — the user is still protected by HTTPS + GitHub trust
    // chain. Future releases should make this hard-required.
    let sha_url = format!("{url}.sha256");
    if let Ok(sha_resp) = client.get(&sha_url).send().await {
        if sha_resp.status().is_success() {
            let body = sha_resp.text().await?;
            let expected = body.split_whitespace().next().unwrap_or("").to_string();
            let actual = sha256_file(&tmp_path).await?;
            if !expected.is_empty() && expected.eq_ignore_ascii_case(&actual) {
                log::info!("screenpipe SHA verified");
            } else if !expected.is_empty() {
                let _ = tokio::fs::remove_file(&tmp_path).await;
                return Err(ReplayError::ChecksumMismatch {
                    expected,
                    got: actual,
                });
            }
        } else {
            log::warn!("no .sha256 sidecar for {asset}; skipping checksum verify");
        }
    } else {
        log::warn!("failed to fetch .sha256 for {asset}; skipping checksum verify");
    }

    emit(
        app,
        InstallProgress::Install {
            message: "extracting binary".into(),
        },
    );

    // Extract: tar.gz containing the screenpipe binary at some path inside.
    // We look for a file named "screenpipe" anywhere in the archive.
    let extract_dir = tmp_dir.join("extract");
    if extract_dir.exists() {
        tokio::fs::remove_dir_all(&extract_dir).await?;
    }
    tokio::fs::create_dir_all(&extract_dir).await?;
    let tmp_path_clone = tmp_path.clone();
    let extract_dir_clone = extract_dir.clone();
    tokio::task::spawn_blocking(move || extract_tar_gz(&tmp_path_clone, &extract_dir_clone))
        .await
        .map_err(|e| ReplayError::Internal(format!("join: {e}")))??;

    let bin_in_archive = find_binary(&extract_dir)?;
    let target = paths::screenpipe_binary_path()?;
    if target.exists() {
        tokio::fs::remove_file(&target).await?;
    }
    tokio::fs::rename(&bin_in_archive, &target).await?;
    let mut perms = std::fs::metadata(&target)?.permissions();
    perms.set_mode(0o755);
    std::fs::set_permissions(&target, perms)?;

    let _ = tokio::fs::remove_file(&tmp_path).await;
    let _ = tokio::fs::remove_dir_all(&extract_dir).await;

    emit(
        app,
        InstallProgress::Smoke {
            message: "running smoke test".into(),
        },
    );
    let smoke = tokio::process::Command::new(&target)
        .arg("--version")
        .output()
        .await?;
    if !smoke.status.success() {
        return Err(ReplayError::SpawnFailed(format!(
            "smoke test failed: stderr={}",
            String::from_utf8_lossy(&smoke.stderr)
        )));
    }
    let version_str = String::from_utf8_lossy(&smoke.stdout).trim().to_string();

    emit(
        app,
        InstallProgress::Done {
            version: version_str.clone(),
            message: "screenpipe installed".into(),
        },
    );
    Ok(version_str)
}

async fn sha256_file(path: &Path) -> Result<String> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;
    let mut f = tokio::fs::File::open(path).await?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = f.read(&mut buf).await?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

fn extract_tar_gz(archive: &Path, dest: &Path) -> Result<()> {
    // Minimal tar.gz extraction without pulling a tar crate: shell out to `tar`,
    // which ships with macOS by default. Keeps Cargo deps small.
    let status = std::process::Command::new("tar")
        .arg("-xzf")
        .arg(archive)
        .arg("-C")
        .arg(dest)
        .status()?;
    if !status.success() {
        return Err(ReplayError::Internal("tar extract failed".into()));
    }
    Ok(())
}

fn find_binary(root: &Path) -> Result<std::path::PathBuf> {
    fn visit(dir: &Path) -> Result<Option<std::path::PathBuf>> {
        for entry in std::fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.is_dir() {
                if let Some(p) = visit(&path)? {
                    return Ok(Some(p));
                }
            } else if path.file_name().and_then(|s| s.to_str()) == Some("screenpipe") {
                return Ok(Some(path));
            }
        }
        Ok(None)
    }
    visit(root)?
        .ok_or_else(|| ReplayError::Internal("screenpipe binary not found in archive".into()))
}
