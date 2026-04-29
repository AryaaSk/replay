use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter};

use crate::errors::{ReplayError, Result};
use crate::paths;

/// Pinned screenpipe version installed by Replay v0.
/// Bump on intentional Replay releases after verifying spawn flags still match.
///
/// 0.3.299 had a vision regression where VisionManager started but never
/// attached to any monitor — audio + UI events still worked, but the frames
/// table stayed empty. 0.3.304 enumerates and attaches monitors correctly
/// (verified against an M4 Mac on macOS 15.6 with dual displays).
pub const PINNED_VERSION: &str = "0.3.304";

/// screenpipe distributes its CLI through npm rather than GitHub releases.
/// The main `screenpipe` package is a thin JS launcher; the actual native
/// binaries live in per-arch optional-dep packages (@screenpipe/cli-<arch>),
/// which we download directly from the npm registry. URLs at registry.npmjs.org
/// are stable + immutable.
const NPM_REGISTRY: &str = "https://registry.npmjs.org";

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

/// e.g. "darwin-arm64" or "darwin-x64". Maps to @screenpipe/cli-<arch>.
fn npm_arch_slug() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "darwin-arm64"
    } else {
        "darwin-x64"
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

    let arch = npm_arch_slug();
    // npm tarball URL: registry.npmjs.org/@screenpipe/cli-darwin-arm64/-/cli-darwin-arm64-0.3.299.tgz
    let url = format!(
        "{}/@screenpipe/cli-{arch}/-/cli-{arch}-{version}.tgz",
        NPM_REGISTRY
    );
    emit(
        app,
        InstallProgress::FetchRelease {
            message: format!("fetching @screenpipe/cli-{arch}@{version}"),
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
            message: "verified via HTTPS to registry.npmjs.org".into(),
        },
    );
    // Note: npm registry tarballs are append-only and immutable; integrity hashes
    // are exposed via the package's `dist.integrity` JSON field rather than as
    // `.sha256` sidecars. For v0 we rely on HTTPS + npm-registry trust; a future
    // hardening step is to fetch /@screenpipe/cli-<arch> metadata first and
    // verify against `dist.integrity`.
    let _ = sha256_file; // silence dead-code warning; helper kept for that future hardening

    emit(
        app,
        InstallProgress::Install {
            message: "extracting binary".into(),
        },
    );

    // Extract the npm tarball. Layout is `package/bin/screenpipe`,
    // `package/bin/mlx.metallib`, `package/package.json`.
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

    // Copy the entire `package/bin/` contents to our managed bin/ — the binary
    // depends on sibling files like `mlx.metallib` to be there at runtime.
    let src_bin = extract_dir.join("package").join("bin");
    if !src_bin.exists() {
        return Err(ReplayError::Internal(format!(
            "expected {} to exist after extraction",
            src_bin.display()
        )));
    }
    let target_bin = paths::bin_dir()?;
    tokio::fs::create_dir_all(&target_bin).await?;
    copy_dir_contents(&src_bin, &target_bin).await?;

    // Make `screenpipe` executable.
    let target = paths::screenpipe_binary_path()?;
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

/// Copy every file in `src` (one level, non-recursive) into `dst`, overwriting
/// any existing entries. Used to land the npm package's `bin/` contents into
/// our managed bin dir.
async fn copy_dir_contents(src: &Path, dst: &Path) -> Result<()> {
    let mut entries = tokio::fs::read_dir(src).await?;
    while let Some(entry) = entries.next_entry().await? {
        let from = entry.path();
        let to = dst.join(entry.file_name());
        if to.exists() {
            let _ = tokio::fs::remove_file(&to).await;
        }
        tokio::fs::copy(&from, &to).await?;
    }
    Ok(())
}
