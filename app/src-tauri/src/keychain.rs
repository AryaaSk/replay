use crate::errors::{ReplayError, Result};
use crate::state::Provider;

const SERVICE: &str = "com.aryaa.replay";

fn account_for(provider: Provider) -> &'static str {
    match provider {
        Provider::Anthropic => "anthropic-api-key",
        Provider::Openai => "openai-api-key",
    }
}

/// macOS OSStatus for "specified item could not be found in the keychain".
/// We treat this as "key absent" rather than an error.
#[cfg(target_os = "macos")]
const ERR_SEC_ITEM_NOT_FOUND: i32 = -25300;

#[cfg(target_os = "macos")]
pub fn set_key(provider: Provider, key: &str) -> Result<()> {
    use security_framework::passwords::set_generic_password;
    set_generic_password(SERVICE, account_for(provider), key.as_bytes())
        .map_err(|e| ReplayError::Keychain(e.to_string()))
}

#[cfg(target_os = "macos")]
pub fn get_key(provider: Provider) -> Result<Option<String>> {
    use security_framework::passwords::get_generic_password;
    match get_generic_password(SERVICE, account_for(provider)) {
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
    match delete_generic_password(SERVICE, account_for(provider)) {
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
