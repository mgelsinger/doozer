//! Thin, safe wrappers over the handful of Win32 calls the shell needs.
//!
//! Everything here is a plain query or a plain window operation. Nothing in this
//! file knows about modes, regions or the page.

use crate::mode::{Monitor, Rect};
use std::ffi::c_void;
use windows::Win32::Foundation::{COLORREF, HWND, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DWMWA_CLOAK, DwmSetWindowAttribute};
use windows::Win32::Graphics::Gdi::{
  ClientToScreen, GetMonitorInfoW, HMONITOR, MONITOR_DEFAULTTONEAREST, MONITORINFO, MonitorFromPoint,
  MonitorFromWindow, ScreenToClient,
};
use windows::Win32::System::SystemInformation::GetTickCount;
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::Input::KeyboardAndMouse::{
  GetAsyncKeyState, GetLastInputInfo, LASTINPUTINFO, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
};
use windows::Win32::UI::Shell::SHQueryUserNotificationState;
use windows::Win32::UI::WindowsAndMessaging::{
  GWL_EXSTYLE, GetClassNameW, GetCursorPos, GetForegroundWindow, GetWindowLongPtrW, GetWindowRect, HWND_NOTOPMOST,
  HWND_TOPMOST, IsWindowVisible, LWA_ALPHA, SW_HIDE, SW_SHOWNOACTIVATE, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE,
  SWP_NOCOPYBITS, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos,
  ShowWindow, WS_EX_APPWINDOW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
};

/// A window handle that can cross threads. Win32 window handles are process-wide
/// integers; the `HWND` wrapper is only `!Send` because it holds a raw pointer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hwnd(pub isize);

impl Hwnd {
  pub fn from_raw(hwnd: HWND) -> Self {
    Hwnd(hwnd.0 as isize)
  }
  pub fn raw(self) -> HWND {
    HWND(self.0 as *mut c_void)
  }
}

pub const EX_TRANSPARENT: u32 = WS_EX_TRANSPARENT.0;
pub const EX_LAYERED: u32 = WS_EX_LAYERED.0;
pub const EX_NOACTIVATE: u32 = WS_EX_NOACTIVATE.0;
pub const EX_TOOLWINDOW: u32 = WS_EX_TOOLWINDOW.0;
pub const EX_APPWINDOW: u32 = WS_EX_APPWINDOW.0;

fn rect_from(r: RECT) -> Rect {
  Rect { x: r.left, y: r.top, w: r.right - r.left, h: r.bottom - r.top }
}

fn monitor_from_handle(handle: HMONITOR) -> Option<Monitor> {
  let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
  // SAFETY: `info` is a correctly sized MONITORINFO.
  if !unsafe { GetMonitorInfoW(handle, &mut info) }.as_bool() {
    return None;
  }
  let (mut dpi_x, mut dpi_y) = (96u32, 96u32);
  // SAFETY: both out-pointers are valid for the call.
  let _ = unsafe { GetDpiForMonitor(handle, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y) };
  Some(Monitor { full: rect_from(info.rcMonitor), work: rect_from(info.rcWork), scale: f64::from(dpi_x.max(1)) / 96.0 })
}

/// The monitor the window is (mostly) on.
pub fn monitor_of_window(hwnd: Hwnd) -> Option<Monitor> {
  // SAFETY: plain query; an invalid handle yields the nearest monitor.
  monitor_from_handle(unsafe { MonitorFromWindow(hwnd.raw(), MONITOR_DEFAULTTONEAREST) })
}

/// The monitor containing, or nearest to, a point in screen pixels.
pub fn monitor_at(x: i32, y: i32) -> Option<Monitor> {
  // SAFETY: plain query.
  monitor_from_handle(unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONEAREST) })
}

/// Cursor position in physical screen pixels.
pub fn cursor_pos() -> Option<(i32, i32)> {
  let mut p = POINT::default();
  // SAFETY: `p` is valid for the call. Fails on the secure desktop (lock screen, UAC).
  unsafe { GetCursorPos(&mut p) }.ok().map(|_| (p.x, p.y))
}

/// True while any mouse button is physically held.
pub fn any_button_down() -> bool {
  // SAFETY: plain query. The high bit means "down right now".
  [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|vk| unsafe { GetAsyncKeyState(i32::from(vk.0)) } < 0)
}

/// Convert a screen point to window client pixels.
pub fn screen_to_client(hwnd: Hwnd, x: i32, y: i32) -> Option<(i32, i32)> {
  let mut p = POINT { x, y };
  // SAFETY: `p` is valid for the call.
  unsafe { ScreenToClient(hwnd.raw(), &mut p) }.as_bool().then_some((p.x, p.y))
}

/// Convert a client point to screen pixels.
pub fn client_to_screen(hwnd: Hwnd, x: i32, y: i32) -> Option<(i32, i32)> {
  let mut p = POINT { x, y };
  // SAFETY: `p` is valid for the call.
  unsafe { ClientToScreen(hwnd.raw(), &mut p) }.as_bool().then_some((p.x, p.y))
}

/// Device pixels per CSS pixel for this window.
pub fn scale_of(hwnd: Hwnd) -> f64 {
  // SAFETY: plain query; returns 0 for an invalid window.
  let dpi = unsafe { GetDpiForWindow(hwnd.raw()) };
  if dpi == 0 { 1.0 } else { f64::from(dpi) / 96.0 }
}

/// The window rectangle in screen pixels.
pub fn window_rect(hwnd: Hwnd) -> Option<Rect> {
  let mut r = RECT::default();
  // SAFETY: `r` is valid for the call.
  unsafe { GetWindowRect(hwnd.raw(), &mut r) }.ok().map(|_| rect_from(r))
}

pub fn ex_style(hwnd: Hwnd) -> u32 {
  // SAFETY: plain query.
  unsafe { GetWindowLongPtrW(hwnd.raw(), GWL_EXSTYLE) as u32 }
}

pub fn set_ex_style(hwnd: Hwnd, style: u32) {
  // SAFETY: changing the extended style of our own window.
  unsafe { SetWindowLongPtrW(hwnd.raw(), GWL_EXSTYLE, style as isize) };
}

/// A layered window is not drawn until its attributes have been set once.
pub fn set_layered_opaque(hwnd: Hwnd) {
  // SAFETY: our own window; fails harmlessly if it is not layered.
  let _ = unsafe { SetLayeredWindowAttributes(hwnd.raw(), COLORREF(0), 255, LWA_ALPHA) };
}

/// Move and resize in one operation, without activating the window.
///
/// `discard_pixels` tells Windows not to carry the old picture over to the new
/// rectangle. Use it when the size changes (the old picture would be stretched
/// or cropped into the new shape for a frame). Do not use it for a plain move:
/// it invalidates the window, and a web view asked to repaint when nothing has
/// changed can put an older frame back on screen.
pub fn set_bounds(hwnd: Hwnd, rect: Rect, topmost: bool, discard_pixels: bool) {
  let after = if topmost { HWND_TOPMOST } else { HWND_NOTOPMOST };
  let flags = if discard_pixels { SWP_NOACTIVATE | SWP_NOCOPYBITS } else { SWP_NOACTIVATE };
  // SAFETY: our own window.
  let _ = unsafe { SetWindowPos(hwnd.raw(), Some(after), rect.x, rect.y, rect.w, rect.h, flags) };
}

/// Move only. Safe to call from a thread that does not own the window: the
/// request is posted, so the caller never waits on the UI thread.
pub fn move_to(hwnd: Hwnd, x: i32, y: i32) {
  // SAFETY: our own window.
  let _ = unsafe {
    SetWindowPos(hwnd.raw(), None, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_ASYNCWINDOWPOS)
  };
}

/// Put the window back at the front of the always-on-top band (or take it out).
pub fn set_topmost(hwnd: Hwnd, topmost: bool) {
  let after = if topmost { HWND_TOPMOST } else { HWND_NOTOPMOST };
  // SAFETY: our own window.
  let _ = unsafe { SetWindowPos(hwnd.raw(), Some(after), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE) };
}

/// Show without taking keyboard focus from whatever the user is doing.
pub fn show_no_activate(hwnd: Hwnd) {
  // SAFETY: our own window.
  let _ = unsafe { ShowWindow(hwnd.raw(), SW_SHOWNOACTIVATE) };
}

pub fn hide(hwnd: Hwnd) {
  // SAFETY: our own window.
  let _ = unsafe { ShowWindow(hwnd.raw(), SW_HIDE) };
}

pub fn is_visible(hwnd: Hwnd) -> bool {
  // SAFETY: plain query.
  unsafe { IsWindowVisible(hwnd.raw()) }.as_bool()
}

/// Cloaking hides a window from the screen while it stays "visible" to itself,
/// so the page keeps rendering. Not needed so far: mode switches are clean
/// without it (docs/shell-spike.md). Kept as the fallback the work plan names
/// ("hide, resize, show") and used by the spike's invisible test runs.
#[cfg_attr(not(feature = "spike"), allow(dead_code))]
pub fn set_cloaked(hwnd: Hwnd, cloaked: bool) {
  let value: i32 = i32::from(cloaked);
  // SAFETY: `value` outlives the call and its size is passed correctly.
  let _ = unsafe {
    DwmSetWindowAttribute(
      hwnd.raw(),
      DWMWA_CLOAK,
      &value as *const i32 as *const c_void,
      std::mem::size_of::<i32>() as u32,
    )
  };
}

/// The window that currently has keyboard focus, as an integer handle.
pub fn foreground_window() -> isize {
  // SAFETY: plain query.
  unsafe { GetForegroundWindow() }.0 as isize
}

pub fn class_name(hwnd: Hwnd) -> String {
  let mut buffer = [0u16; 128];
  // SAFETY: the buffer is valid for its length.
  let n = unsafe { GetClassNameW(hwnd.raw(), &mut buffer) };
  String::from_utf16_lossy(&buffer[..n.max(0) as usize])
}

/// Is the window with keyboard focus covering its whole monitor? The desktop
/// itself does not count. A cruder test than `fullscreen_app_in_front`, kept in
/// the status snapshot so the two can be compared.
pub fn foreground_is_fullscreen() -> bool {
  let foreground = Hwnd(foreground_window());
  if foreground.0 == 0 {
    return false;
  }
  let class = class_name(foreground);
  if class == "Progman" || class == "WorkerW" {
    return false; // the desktop
  }
  match (window_rect(foreground), monitor_of_window(foreground)) {
    (Some(rect), Some(monitor)) => {
      rect.x <= monitor.full.x
        && rect.y <= monitor.full.y
        && rect.right() >= monitor.full.right()
        && rect.bottom() >= monitor.full.bottom()
    }
    _ => false,
  }
}

/// Is a fullscreen app (game, video, presentation) in front, by Windows' own
/// judgement? This is what "tuck away during fullscreen apps" keys on. It is the
/// same test Windows uses to hold back notifications, so a maximised window on a
/// machine with an auto-hidden taskbar does not count.
pub fn fullscreen_app_in_front() -> bool {
  matches!(user_notification_state(), 2..=4)
}

/// What Windows itself thinks the user is doing, as a QUERY_USER_NOTIFICATION_STATE
/// number: 2 = a fullscreen app is running, 3 = a fullscreen Direct3D app,
/// 4 = presentation mode, 5 = accepts notifications (normal desktop use).
pub fn user_notification_state() -> i32 {
  // SAFETY: plain query.
  unsafe { SHQueryUserNotificationState() }.map(|state| state.0).unwrap_or(0)
}

/// Milliseconds since the last real keyboard or mouse input anywhere on the machine.
pub fn user_idle_ms() -> u32 {
  let mut info = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
  // SAFETY: `info` is a correctly sized LASTINPUTINFO.
  if !unsafe { GetLastInputInfo(&mut info) }.as_bool() {
    return 0;
  }
  // SAFETY: plain query.
  unsafe { GetTickCount() }.wrapping_sub(info.dwTime)
}
