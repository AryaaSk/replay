use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentInfo {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct AgentStatus {
    pub claude: AgentInfo,
    pub codex: AgentInfo,
}

/// Detect installed agent CLIs by going through the user's login shell, so PATH
/// is sourced from ~/.zshrc / ~/.bashrc / brew / nvm etc. macOS GUI apps inherit
/// a minimal PATH from launchd, so a naive `which` won't find user-installed
/// CLIs. `bash -lc 'which <bin>'` is the reliable approach.
pub async fn detect() -> AgentStatus {
    AgentStatus {
        claude: detect_one("claude").await,
        codex: detect_one("codex").await,
    }
}

async fn detect_one(bin: &str) -> AgentInfo {
    let path_cmd = format!("command -v {bin} 2>/dev/null || true");
    let path = match tokio::process::Command::new("bash")
        .args(["-lc", &path_cmd])
        .output()
        .await
    {
        Ok(o) => String::from_utf8_lossy(&o.stdout).trim().to_string(),
        Err(_) => String::new(),
    };
    if path.is_empty() {
        return AgentInfo {
            installed: false,
            path: None,
            version: None,
        };
    }
    // Try `<bin> --version` via login shell so its env (auth tokens etc) is loaded.
    let version_cmd = format!("{bin} --version 2>/dev/null || true");
    let version = match tokio::process::Command::new("bash")
        .args(["-lc", &version_cmd])
        .output()
        .await
    {
        Ok(o) => {
            let s = String::from_utf8_lossy(&o.stdout).trim().to_string();
            if s.is_empty() { None } else { Some(s) }
        }
        Err(_) => None,
    };
    AgentInfo {
        installed: true,
        path: Some(path),
        version,
    }
}
