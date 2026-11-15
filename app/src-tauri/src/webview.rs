//! The one thing the shell asks of the browser itself: to hold less memory.
//!
//! WebView2 has a switch for this (`MemoryUsageTargetLevel`). Set to *low*, the browser
//! collects garbage, drops what it can do without and lets Windows take back the pages
//! its processes are not using; set back to *normal*, it carries on as before. The page
//! cannot do any of that for itself.
//!
//! What it gives back and what it does not is measured in docs/polish-checks.md.

use tauri::WebviewWindow;
use webview2_com::Microsoft::Web::WebView2::Win32::{
  COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL, ICoreWebView2_19,
};
use windows_core::Interface;

/// Ask the browser to hold as little memory as it can (`low`), or to go back to normal.
///
/// Does nothing on a WebView2 runtime too old to have the switch (before 1.0.1901).
pub fn set_low_memory(window: &WebviewWindow, low: bool) -> Result<(), String> {
  window
    .with_webview(move |webview| {
      let level =
        if low { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW } else { COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL };
      // SAFETY: plain COM calls on the UI thread, which is where `with_webview` runs this.
      unsafe {
        if let Ok(core) = webview.controller().CoreWebView2()
          && let Ok(core) = core.cast::<ICoreWebView2_19>()
        {
          let _ = core.SetMemoryUsageTargetLevel(level);
        }
      }
    })
    .map_err(|e| e.to_string())
}
