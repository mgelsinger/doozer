//! "Start with Windows": one value under the current user's Run key.
//!
//! The functions take the key path, so tests use a scratch key and never touch
//! the real one. Nothing here needs administrator rights.

use std::path::Path;
use winreg::RegKey;
use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};

/// Where Windows looks for programs to start when this user signs in.
pub const RUN_KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
/// The name of Doozer's value under that key.
pub const VALUE_NAME: &str = "Doozer";

/// The command line Windows should run: the executable's path, quoted.
pub fn command_for(exe: &Path) -> String {
  format!("\"{}\"", exe.display())
}

/// The command registered under `name`, if any.
pub fn read(key_path: &str, name: &str) -> Option<String> {
  let key = RegKey::predef(HKEY_CURRENT_USER).open_subkey_with_flags(key_path, KEY_READ).ok()?;
  key.get_value::<String, _>(name).ok()
}

/// Register `command` under `name`, or remove the value when `command` is `None`.
/// Removing a value that is not there is not an error.
pub fn write(key_path: &str, name: &str, command: Option<&str>) -> Result<(), String> {
  let root = RegKey::predef(HKEY_CURRENT_USER);
  match command {
    Some(command) => {
      let (key, _) = root.create_subkey(key_path).map_err(|e| format!("cannot open {key_path}: {e}"))?;
      key.set_value(name, &command).map_err(|e| format!("cannot write {name}: {e}"))
    }
    None => {
      let Ok(key) = root.open_subkey_with_flags(key_path, KEY_SET_VALUE) else {
        return Ok(()); // no key, so nothing registered
      };
      match key.delete_value(name) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(format!("cannot remove {name}: {e}")),
      }
    }
  }
}

/// Is `exe` what is registered? A different path (the app was moved) counts as no.
pub fn is_registered(key_path: &str, name: &str, exe: &Path) -> bool {
  read(key_path, name).is_some_and(|found| found.eq_ignore_ascii_case(&command_for(exe)))
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::path::PathBuf;
  use std::sync::atomic::{AtomicU32, Ordering};

  /// A key of our own under HKCU, removed again when the test ends.
  struct Scratch(String);

  impl Scratch {
    fn new() -> Self {
      static NEXT: AtomicU32 = AtomicU32::new(0);
      let n = NEXT.fetch_add(1, Ordering::SeqCst);
      Scratch(format!(r"Software\DoozerTests\autostart-{}-{n}", std::process::id()))
    }
  }

  impl Drop for Scratch {
    fn drop(&mut self) {
      let root = RegKey::predef(HKEY_CURRENT_USER);
      let _ = root.delete_subkey_all(&self.0);
      // The parent goes too once the last test's key has gone. While another
      // test's key is still there this fails, which is what should happen.
      let _ = root.delete_subkey(r"Software\DoozerTests");
    }
  }

  #[test]
  fn the_command_is_the_quoted_path() {
    assert_eq!(command_for(Path::new(r"C:\Program Files\Doozer\doozer.exe")), r#""C:\Program Files\Doozer\doozer.exe""#);
  }

  #[test]
  fn nothing_is_registered_to_begin_with() {
    let key = Scratch::new();
    assert_eq!(read(&key.0, VALUE_NAME), None);
    assert!(!is_registered(&key.0, VALUE_NAME, Path::new(r"C:\doozer.exe")));
  }

  #[test]
  fn registering_then_removing() {
    let key = Scratch::new();
    let exe = PathBuf::from(r"C:\Apps\Doozer\doozer.exe");
    write(&key.0, VALUE_NAME, Some(&command_for(&exe))).unwrap();
    assert_eq!(read(&key.0, VALUE_NAME).as_deref(), Some(r#""C:\Apps\Doozer\doozer.exe""#));
    assert!(is_registered(&key.0, VALUE_NAME, &exe));
    write(&key.0, VALUE_NAME, None).unwrap();
    assert_eq!(read(&key.0, VALUE_NAME), None);
  }

  #[test]
  fn a_moved_app_does_not_count_as_registered() {
    let key = Scratch::new();
    write(&key.0, VALUE_NAME, Some(&command_for(Path::new(r"C:\Old\doozer.exe")))).unwrap();
    assert!(!is_registered(&key.0, VALUE_NAME, Path::new(r"C:\New\doozer.exe")));
    // Case does not matter in a Windows path.
    assert!(is_registered(&key.0, VALUE_NAME, Path::new(r"c:\old\DOOZER.exe")));
  }

  #[test]
  fn removing_what_is_not_there_is_fine() {
    let key = Scratch::new();
    assert!(write(&key.0, VALUE_NAME, None).is_ok());
    write(&key.0, "Other", Some("x")).unwrap();
    assert!(write(&key.0, VALUE_NAME, None).is_ok());
    assert_eq!(read(&key.0, "Other").as_deref(), Some("x"));
  }
}
