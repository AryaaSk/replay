use crate::errors::{ReplayError, Result};

const SERVICE: &str = "com.aryaa.replay";
const ACCOUNT: &str = "anthropic-api-key";

/// macOS OSStatus for "specified item could not be found in the keychain".
/// We treat this as "key absent" rather than an error.
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

#[cfg(target_os = "macos")]
pub fn set_anthropic_key(key: &str) -> Result<()> {
    use security_framework::passwords::set_generic_password;
    set_generic_password(SERVICE, ACCOUNT, key.as_bytes())
        .map_err(|e| ReplayError::Keychain(e.to_string()))
}

#[cfg(target_os = "macos")]
pub fn get_anthropic_key() -> Result<Option<String>> {
    use security_framework::passwords::get_generic_password;
    match get_generic_password(SERVICE, ACCOUNT) {
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
pub fn delete_anthropic_key() -> Result<()> {
    use security_framework::passwords::delete_generic_password;
    match delete_generic_password(SERVICE, ACCOUNT) {
        Ok(_) => Ok(()),
        Err(e) if e.code() == ERR_SEC_ITEM_NOT_FOUND => Ok(()),
        Err(e) => Err(ReplayError::Keychain(e.to_string())),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn set_anthropic_key(_key: &str) -> Result<()> {
    Err(ReplayError::Keychain("macOS-only".into()))
}

#[cfg(not(target_os = "macos"))]
pub fn get_anthropic_key() -> Result<Option<String>> {
    Ok(None)
}

#[cfg(not(target_os = "macos"))]
pub fn delete_anthropic_key() -> Result<()> {
    Ok(())
}
