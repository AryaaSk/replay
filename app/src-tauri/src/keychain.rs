use crate::errors::{ReplayError, Result};
use crate::state::Provider;

// Keychain service identifier — matches the app's bundle identifier in
// tauri.conf.json. Per-user isolation is provided by macOS's login keychain
// (each user's keychain is separate); this string identifies the APP, not
// the user.
const SERVICE: &str = "app.replay";

/// Returns the keychain account name for BYOK providers, or an Err for local
/// agents (which don't use Replay-managed keys). All callers in lib.rs already
/// gate on `Provider::is_local_agent()`, so reaching the local-agent arm here
/// is a programming error — return a clear message rather than panicking.
fn account_for(provider: Provider) -> Result<&'static str> {
    match provider {
        Provider::Anthropic => Ok("anthropic-api-key"),
        Provider::Openai => Ok("openai-api-key"),
        Provider::LocalClaude | Provider::LocalCodex => Err(ReplayError::Internal(
            "keychain ops not valid for local-agent providers".into(),
        )),
    }
}

/// macOS OSStatus for "specified item could not be found in the keychain".
/// We treat this as "key absent" rather than an error.
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

#[cfg(target_os = "macos")]
pub fn set_key(provider: Provider, key: &str) -> Result<()> {
    use security_framework::passwords::set_generic_password;
    let account = account_for(provider)?;
    set_generic_password(SERVICE, account, key.as_bytes())
        .map_err(|e| ReplayError::Keychain(e.to_string()))
}

#[cfg(target_os = "macos")]
pub fn get_key(provider: Provider) -> Result<Option<String>> {
    use security_framework::passwords::get_generic_password;
    let account = account_for(provider)?;
    match get_generic_password(SERVICE, account) {
        Ok(bytes) => {
            let s = String::from_utf8(bytes)
                .map_err(|e| ReplayError::Keychain(format!("utf8: {e}")))?;
            Ok(Some(s))
        }
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(None),
        Err(e) => Err(ReplayError::Keychain(e.to_string())),
    }
}

#[cfg(target_os = "macos")]
pub fn delete_key(provider: Provider) -> Result<()> {
    use security_framework::passwords::delete_generic_password;
    let account = account_for(provider)?;
    match delete_generic_password(SERVICE, account) {
        Ok(_) => Ok(()),
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(e) => Err(ReplayError::Keychain(e.to_string())),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_key(_provider: Provider, _key: &str) -> Result<()> {
    Err(ReplayError::Keychain("macOS-only".into()))
}

#[cfg(not(target_os = "macos"))]
pub fn get_key(_provider: Provider) -> Result<Option<String>> {
    Ok(None)
}

#[cfg(not(target_os = "macos"))]
pub fn delete_key(_provider: Provider) -> Result<()> {
    Ok(())
}
