use crate::errors::{ReplayError, Result};

const SERVICE: &str = "com.aryaa.replay";
const ACCOUNT: &str = "anthropic-api-key";

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
        Err(e) => {
            // -25300 == errSecItemNotFound
            let msg = e.to_string();
            if msg.contains("-25300") || msg.contains("not found") || msg.contains("Item Not") {
                Ok(None)
            } else {
                Err(ReplayError::Keychain(msg))
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub fn delete_anthropic_key() -> Result<()> {
    use security_framework::passwords::delete_generic_password;
    match delete_generic_password(SERVICE, ACCOUNT) {
        Ok(_) => Ok(()),
        Err(e) => {
            let msg = e.to_string();
            if msg.contains("-25300") || msg.contains("not found") {
                Ok(())
            } else {
                Err(ReplayError::Keychain(msg))
            }
        }
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
