//! The one keyboard shortcut: Ctrl+Alt+D opens Doozer's Card and gives it the keyboard.
//!
//! Doozer never takes keyboard focus unasked (WORK_PLAN.md, principle 2), which left the
//! Card out of reach of anyone not using a mouse. Pressing the shortcut is asking: the
//! window takes the keyboard there and then (Windows only allows that at the moment of the
//! key press, so it cannot wait for the page), the page is told to open the Card and put
//! the focus on it, and when the Card closes the keyboard goes back to the window that had
//! it. If the page never answers, `Shell::tick` gives the keyboard back by itself.
//!
//! If another program already has the shortcut, registering fails and nothing happens:
//! the tray menu's "Open Doozer's card" still opens it, without the keyboard.

use crate::shell::Shell;
use serde::Serialize;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use windows::Win32::UI::Input::KeyboardAndMouse::{MOD_ALT, MOD_CONTROL, MOD_NOREPEAT, RegisterHotKey};
use windows::Win32::UI::WindowsAndMessaging::{GetMessageW, MSG, WM_HOTKEY};

pub const EVENT_CARD_REQUESTED: &str = "shell://card-requested";
/// As it is written in the tray menu.
pub const SHORTCUT_LABEL: &str = "Ctrl+Alt+D";
const SHORTCUT_KEY: u32 = b'D' as u32;
const SHORTCUT_ID: i32 = 1;

/// What the page is told: open the Card, and whether the window has been given the keyboard for it.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct CardRequest {
  pub keyboard: bool,
}

/// The shortcut was pressed (or a test says it was).
pub fn pressed(app: &AppHandle, shell: &Arc<Shell>) {
  let keyboard = shell.take_keyboard();
  let _ = app.emit(EVENT_CARD_REQUESTED, CardRequest { keyboard });
}

/// The tray menu's item: the Card, without the keyboard.
pub fn requested_from_menu(app: &AppHandle) {
  let _ = app.emit(EVENT_CARD_REQUESTED, CardRequest { keyboard: false });
}

/// Register the shortcut and wait for it, on a thread of its own (a shortcut is delivered
/// to the thread that registered it).
pub fn spawn(app: AppHandle, shell: Arc<Shell>) {
  let _ = std::thread::Builder::new().name("doozer-hotkey".into()).spawn(move || {
    // SAFETY: plain registration for this thread; no window is involved.
    let registered = unsafe { RegisterHotKey(None, SHORTCUT_ID, MOD_CONTROL | MOD_ALT | MOD_NOREPEAT, SHORTCUT_KEY) };
    if registered.is_err() {
      // Somebody else has it. Not an error worth a word to the user: the menu still works.
      return;
    }
    let mut message = MSG::default();
    // SAFETY: `message` is valid for the call; the loop ends when the thread's queue is closed.
    while unsafe { GetMessageW(&mut message, None, 0, 0) }.as_bool() {
      if message.message == WM_HOTKEY && message.wParam.0 == SHORTCUT_ID as usize {
        pressed(&app, &shell);
      }
    }
  });
}
