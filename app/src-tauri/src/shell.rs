//! The one window: its shape, its click-through state, dragging, and the
//! thread that watches the cursor.
//!
//! Threads and locking. Three kinds of thread touch `Shell`:
//!
//! * the UI thread, which owns the window (mode changes, show/hide run here);
//! * Tauri's command threads;
//! * the cursor tracker thread started by `spawn_tracker`.
//!
//! One rule keeps them from deadlocking: **never hold the lock while calling a
//! Win32 function that can send a message to the window** (`SetWindowPos`,
//! `SetWindowLongPtr`, `ShowWindow`). Take the lock, decide, release, then act.
//!
//! Who owns the window styles. Tao (Tauri's window layer) rewrites the whole
//! extended style from its own flags whenever one of its flags changes, and its
//! `show()` activates the window. So after creation the shell never calls Tao
//! for anything style-related: click-through, focusability and show/hide are all
//! done here with Win32, and the tracker repairs the style if anything else
//! changes it.

use crate::hit::{self, Region};
use crate::mode::{self, Monitor, Rect, WindowMode};
use crate::win::{self, Hwnd};
use serde::Serialize;
use std::sync::{Arc, Mutex, MutexGuard, mpsc};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

/// How often the cursor is sampled while it is moving.
const TICK_ACTIVE: Duration = Duration::from_millis(16);
/// How often it is sampled after it has been still for `ACTIVE_FOR`.
const TICK_RESTING: Duration = Duration::from_millis(100);
/// How often the window is moved while it is being dragged.
const TICK_DRAGGING: Duration = Duration::from_millis(6);
const ACTIVE_FOR: Duration = Duration::from_millis(1500);
/// After the shortcut has given the window the keyboard, the page has this long to say it
/// wants it (by asking to be focusable). If it does not, the keyboard is given back.
const KEYBOARD_GRACE: Duration = Duration::from_millis(1500);

/// The page must check in at least this often or its hit regions are dropped.
pub const WATCHDOG_TIMEOUT: Duration = Duration::from_secs(6);
/// How often the monitor layout is compared with the one the window was placed on.
const DISPLAY_CHECK: Duration = Duration::from_secs(1);
/// More regions than this is a bug in a view, not a design.
const MAX_REGIONS: usize = 64;

pub const EVENT_DRAG_END: &str = "shell://drag-end";
pub const EVENT_WATCHDOG: &str = "shell://watchdog";
pub const EVENT_DISPLAY_CHANGED: &str = "shell://display-changed";
pub const EVENT_FULLSCREEN_CHANGED: &str = "shell://fullscreen-changed";
pub const EVENT_POINTER_RELEASED: &str = "shell://pointer-released";

/// Where the pointer was when a press on the page ended, in CSS pixels relative
/// to the viewport. It can be outside the window.
#[derive(Debug, Clone, Copy, Serialize)]
pub struct ReleasedAt {
  pub x: f64,
  pub y: f64,
}

#[derive(Debug, Clone, Copy)]
struct Drag {
  /// Cursor position relative to the window's top-left corner, in screen pixels.
  grab_x: i32,
  grab_y: i32,
}

#[derive(Debug, Default, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
  pub ticks: u64,
  /// Times the window changed between catching the mouse and letting it through.
  pub flips: u64,
  /// Times the tracker found the window style different from what it should be, with
  /// nothing of the shell's own to explain it, and fixed it: something else (Tao, another
  /// program) had rewritten it.
  pub style_repairs: u64,
  /// Times the tracker wrote a style that the shell itself had asked for a moment before
  /// (`Inner::style_due`). Not a repair: the ordinary way those changes reach the window.
  pub style_catch_ups: u64,
  /// The style the last repair found, and the one it put back.
  pub last_repair_from: u32,
  pub last_repair_to: u32,
  /// Times the page went silent and its hit regions were dropped.
  pub watchdog_trips: u64,
  /// Times the monitor layout changed under the window and it was put back in place.
  pub display_changes: u64,
  pub mode_switches: u64,
  pub last_switch_ms: f64,
}

struct Inner {
  hwnd: Hwnd,
  mode: Option<WindowMode>,
  view: Option<String>,
  regions: Vec<Region>,
  /// When the regions were reported. A region that is moving is worked out from here.
  regions_at: Instant,
  /// The watchdog dropped the regions; the page has to send them again.
  regions_lost: bool,
  /// The window catches the mouse (true) or lets it through (false).
  catching: bool,
  /// Clicking the window may give it keyboard focus.
  focusable: bool,
  /// `catching` or `focusable` was changed by something that left writing the style to the
  /// tracker's next tick (hiding the window, the start of a drag, the keyboard given back
  /// by the tracker itself). That write is the shell catching up with itself, and must not
  /// be counted as repairing somebody else's damage: until Phase 11's second look it was,
  /// which is all the "style repairs" of the Desktop soaks ever were.
  style_due: bool,
  visible: bool,
  topmost: bool,
  drag: Option<Drag>,
  /// A button is down on a press that went to the page (see `hit::hold_step`).
  holding: bool,
  /// The window that had the keyboard when the shortcut took it, to give it back to.
  keyboard_from: Option<isize>,
  /// The shortcut took the keyboard at this moment and the page has not yet said it wants it.
  keyboard_pending: Option<Instant>,
  last_heartbeat: Instant,
  last_cursor: (i32, i32),
  last_cursor_move: Instant,
  /// The monitor geometry the current bounds were computed from.
  placed_on: Option<Monitor>,
  last_display_check: Instant,
  /// A fullscreen app was in front at the last check.
  fullscreen_in_front: bool,
  /// Keep WS_EX_LAYERED on permanently instead of toggling it with click-through.
  layered_always: bool,
  /// Test builds only: a pretend cursor (screen position, button held) that
  /// replaces the real mouse, so tests neither move the user's cursor nor are
  /// disturbed by it. Always `None` in a normal build.
  injected: Option<((i32, i32), bool)>,
  stats: Stats,
}

pub struct Shell {
  inner: Mutex<Inner>,
  app: AppHandle,
}

/// What the page is told about the window after a change.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
  /// `docked`, `floating` or `overlay`.
  pub kind: &'static str,
  pub view: Option<String>,
  /// Window rectangle in physical screen pixels.
  pub x: i32,
  pub y: i32,
  pub width: i32,
  pub height: i32,
  /// Device pixels per CSS pixel.
  pub scale: f64,
  /// The viewport size the page should see, in CSS pixels.
  pub css_width: f64,
  pub css_height: f64,
  pub monitor: Monitor,
  /// Time the native side spent changing the window.
  pub native_ms: f64,
}

/// A snapshot for diagnostics and tests.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
  pub kind: Option<&'static str>,
  pub view: Option<String>,
  pub bounds: Option<Rect>,
  pub scale: f64,
  pub regions: usize,
  pub regions_lost: bool,
  /// What the shell wants.
  pub catching: bool,
  /// What the window style actually says right now.
  pub style_click_through: bool,
  pub style_layered: bool,
  pub style_no_activate: bool,
  pub style_tool_window: bool,
  pub visible: bool,
  pub focusable: bool,
  pub topmost: bool,
  pub dragging: bool,
  /// A button is held on a press that went to the page.
  pub holding: bool,
  pub is_foreground: bool,
  /// Handle of the window that has keyboard focus, to see whether it ever changes.
  pub foreground: isize,
  pub foreground_class: String,
  /// A fullscreen app (game, video, presentation) is in front, as Windows judges it.
  pub fullscreen_in_front: bool,
  /// Cruder: the focused window's rectangle covers its whole monitor.
  pub foreground_fullscreen: bool,
  /// Windows' own QUERY_USER_NOTIFICATION_STATE (2, 3, 4 = busy with something fullscreen).
  pub user_notification_state: i32,
  pub user_idle_ms: u32,
  pub ms_since_heartbeat: u64,
  pub stats: Stats,
}

/// The extended style the window should have, given what it has now.
///
/// Only the bits the shell manages are touched; everything else is preserved.
pub fn desired_ex_style(current: u32, catching: bool, focusable: bool, layered_always: bool) -> u32 {
  let managed = win::EX_TRANSPARENT | win::EX_LAYERED | win::EX_NOACTIVATE | win::EX_TOOLWINDOW | win::EX_APPWINDOW;
  // A tool window is kept out of Alt-Tab and off the taskbar.
  let mut style = (current & !managed) | win::EX_TOOLWINDOW;
  if !focusable {
    style |= win::EX_NOACTIVATE;
  }
  if !catching {
    // Layered + transparent is what makes Windows hit-test straight through the
    // window to whatever application is underneath.
    style |= win::EX_TRANSPARENT | win::EX_LAYERED;
  } else if layered_always {
    style |= win::EX_LAYERED;
  }
  style
}

impl Shell {
  pub fn new(app: AppHandle, hwnd: Hwnd, layered_always: bool) -> Arc<Self> {
    let now = Instant::now();
    Arc::new(Shell {
      app,
      inner: Mutex::new(Inner {
        hwnd,
        mode: None,
        view: None,
        regions: Vec::new(),
        regions_at: now,
        regions_lost: false,
        catching: false,
        focusable: false,
        style_due: false,
        visible: true,
        topmost: true,
        drag: None,
        holding: false,
        keyboard_from: None,
        keyboard_pending: None,
        last_heartbeat: now,
        last_cursor: (i32::MIN, i32::MIN),
        last_cursor_move: now,
        placed_on: None,
        last_display_check: now,
        fullscreen_in_front: false,
        layered_always,
        injected: None,
        stats: Stats::default(),
      }),
    })
  }

  fn lock(&self) -> MutexGuard<'_, Inner> {
    // A panic while holding the lock must not take click-through handling down with it.
    self.inner.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
  }

  #[cfg(feature = "spike")]
  pub fn hwnd(&self) -> Hwnd {
    self.lock().hwnd
  }

  /// Replace the real mouse with a pretend one (`Some`), or go back to the real one (`None`).
  #[cfg(feature = "spike")]
  pub fn inject_cursor(&self, cursor: Option<((i32, i32), bool)>) {
    let mut s = self.lock();
    s.injected = cursor;
    // Sample at the fast rate for a while, as real movement would cause.
    s.last_cursor_move = Instant::now();
  }

  pub fn view(&self) -> Option<String> {
    self.lock().view.clone()
  }

  /// Bring the real window style in line with the wanted state. Call without the lock.
  fn sync_style(&self) {
    let (hwnd, catching, focusable, layered_always) = {
      let s = self.lock();
      (s.hwnd, s.catching, s.focusable, s.layered_always)
    };
    let _ = apply_style(hwnd, catching, focusable, layered_always);
  }

  /// First-time setup, on the UI thread, right after the window exists.
  pub fn adopt_window(&self) {
    self.sync_style();
    let (hwnd, topmost) = {
      let s = self.lock();
      (s.hwnd, s.topmost)
    };
    win::set_topmost(hwnd, topmost);
  }

  /// Change the window's shape. **UI thread only.**
  ///
  /// `keep_regions` is for re-placing the window after a display change, where
  /// the page has not asked for anything and its regions still describe it.
  pub fn apply_mode(&self, mode: WindowMode, view: Option<String>, keep_regions: bool) -> Result<WindowInfo, String> {
    let started = Instant::now();
    let (hwnd, topmost) = {
      let mut s = self.lock();
      s.drag = None;
      if !keep_regions {
        // The old view's regions describe a layout that is about to disappear.
        // Until the new view reports its own, nothing catches the mouse.
        s.regions.clear();
        s.regions_lost = false;
        s.catching = false;
      }
      (s.hwnd, s.topmost)
    };
    self.sync_style();

    let monitor = match mode.saved_position() {
      Some((x, y)) => win::monitor_at(x, y),
      None => win::monitor_of_window(hwnd),
    }
    .ok_or("no monitor found for the window")?;
    let rect = mode::bounds_for(&mode, &monitor);
    crate::spike::mark("native-bounds-begin");
    let current = win::window_rect(hwnd);
    if current == Some(rect) && !crate::spike::always_reposition() {
      // Already there (the same view chosen again, or two views that share a
      // rectangle). Leave the window alone; just keep it in front.
      win::set_topmost(hwnd, topmost);
    } else {
      let resizing = current.is_none_or(|c| c.w != rect.w || c.h != rect.h) || crate::spike::always_reposition();
      win::set_bounds(hwnd, rect, topmost, resizing);
      // Landing on a monitor with different scaling makes Windows resize the
      // window on arrival. Put it back to what was asked for.
      if win::window_rect(hwnd) != Some(rect) {
        win::set_bounds(hwnd, rect, topmost, true);
      }
    }
    crate::spike::mark("native-bounds-end");

    let native_ms = started.elapsed().as_secs_f64() * 1000.0;
    let mut s = self.lock();
    s.mode = Some(mode.clone());
    if view.is_some() {
      s.view = view;
    }
    s.placed_on = Some(monitor);
    s.stats.mode_switches += 1;
    s.stats.last_switch_ms = native_ms;
    Ok(window_info(&mode, s.view.clone(), rect, monitor, native_ms))
  }

  pub fn window_info(&self) -> Option<WindowInfo> {
    let s = self.lock();
    let mode = s.mode.clone()?;
    let rect = win::window_rect(s.hwnd)?;
    let monitor = s.placed_on.or_else(|| win::monitor_of_window(s.hwnd))?;
    Some(window_info(&mode, s.view.clone(), rect, monitor, s.stats.last_switch_ms))
  }

  /// Replace the hit regions. Counts as a sign of life from the page.
  pub fn set_regions(&self, regions: Vec<Region>) -> Result<usize, String> {
    if regions.len() > MAX_REGIONS {
      return Err(format!("{} hit regions is more than the limit of {MAX_REGIONS}", regions.len()));
    }
    let regions: Vec<Region> = regions.into_iter().filter(Region::is_valid).collect();
    let mut s = self.lock();
    let now = Instant::now();
    s.regions = regions;
    s.regions_at = now;
    s.regions_lost = false;
    s.last_heartbeat = now;
    Ok(s.regions.len())
  }

  /// The page says it is alive. Returns true if it has to send its regions again.
  pub fn heartbeat(&self) -> bool {
    let mut s = self.lock();
    s.last_heartbeat = Instant::now();
    s.regions_lost
  }

  /// Start moving the window with the mouse. `x`, `y` are where the pointer
  /// went down, in CSS pixels relative to the viewport. Only a floating window
  /// can be dragged, and only while a button is still held.
  pub fn begin_drag(&self, x: f64, y: f64) -> bool {
    let real_down = win::any_button_down();
    let mut s = self.lock();
    let button_down = match s.injected {
      Some((_, down)) => down,
      None => real_down,
    };
    if !button_down {
      return false;
    }
    if !matches!(s.mode, Some(WindowMode::Floating { .. })) {
      return false;
    }
    let hwnd = s.hwnd;
    let (Some(rect), Some((client_x, client_y))) = (win::window_rect(hwnd), win::client_to_screen(hwnd, 0, 0)) else {
      return false;
    };
    let scale = win::scale_of(hwnd);
    s.drag = Some(Drag {
      grab_x: (client_x - rect.x) + (x * scale).round() as i32,
      grab_y: (client_y - rect.y) + (y * scale).round() as i32,
    });
    s.style_due |= !s.catching;
    s.catching = true;
    true
  }

  pub fn set_focusable(&self, focusable: bool) {
    let give_back = {
      let mut s = self.lock();
      s.focusable = focusable;
      // The page has spoken: whatever the shortcut began is its business now.
      s.keyboard_pending = None;
      if focusable { None } else { s.keyboard_from.take().map(|from| (s.hwnd, from)) }
    };
    if let Some((hwnd, from)) = give_back {
      give_keyboard_back(hwnd, from);
    }
    self.sync_style();
  }

  /// The keyboard shortcut was pressed: take the keyboard for the Card, now, remembering
  /// who had it. Returns false if Windows would not let the window have it.
  pub fn take_keyboard(&self) -> bool {
    let hwnd = {
      let mut s = self.lock();
      let before = win::foreground_window();
      if before != 0 && before != s.hwnd.0 && s.keyboard_from.is_none() {
        s.keyboard_from = Some(before);
      }
      s.focusable = true;
      s.keyboard_pending = Some(Instant::now());
      s.hwnd
    };
    // The window may not be activated while it has the no-activate style.
    self.sync_style();
    let taken = win::set_foreground(hwnd) || win::foreground_window() == hwnd.0;
    if !taken {
      // Windows refused. Leave everything as it was: the Card still opens, without the keyboard.
      let mut s = self.lock();
      s.focusable = false;
      s.keyboard_pending = None;
      s.keyboard_from = None;
      drop(s);
      self.sync_style();
    }
    taken
  }

  /// Show or hide the window without ever taking keyboard focus. **UI thread only.**
  pub fn set_visible(&self, visible: bool) {
    let hwnd = {
      let mut s = self.lock();
      s.visible = visible;
      if !visible {
        // A hidden window catches nothing whatever its style says; the tracker writes
        // the click-through style on its next tick.
        s.style_due |= s.catching;
        s.catching = false;
        s.drag = None;
      }
      s.hwnd
    };
    if visible {
      win::show_no_activate(hwnd);
    } else {
      win::hide(hwnd);
    }
  }

  /// **UI thread only.**
  pub fn set_topmost(&self, topmost: bool) {
    let hwnd = {
      let mut s = self.lock();
      s.topmost = topmost;
      s.hwnd
    };
    win::set_topmost(hwnd, topmost);
  }

  pub fn status(&self) -> Status {
    let s = self.lock();
    let style = win::ex_style(s.hwnd);
    Status {
      kind: s.mode.as_ref().map(WindowMode::kind),
      view: s.view.clone(),
      bounds: win::window_rect(s.hwnd),
      scale: win::scale_of(s.hwnd),
      regions: s.regions.len(),
      regions_lost: s.regions_lost,
      catching: s.catching,
      style_click_through: style & win::EX_TRANSPARENT != 0,
      style_layered: style & win::EX_LAYERED != 0,
      style_no_activate: style & win::EX_NOACTIVATE != 0,
      style_tool_window: style & win::EX_TOOLWINDOW != 0,
      visible: win::is_visible(s.hwnd),
      focusable: s.focusable,
      topmost: s.topmost,
      dragging: s.drag.is_some(),
      holding: s.holding,
      is_foreground: win::foreground_window() == s.hwnd.0,
      foreground: win::foreground_window(),
      foreground_class: win::class_name(Hwnd(win::foreground_window())),
      fullscreen_in_front: win::fullscreen_app_in_front(),
      foreground_fullscreen: win::foreground_is_fullscreen(),
      user_notification_state: win::user_notification_state(),
      user_idle_ms: win::user_idle_ms(),
      ms_since_heartbeat: s.last_heartbeat.elapsed().as_millis() as u64,
      stats: s.stats,
    }
  }

  /// Run `f` on the UI thread and wait for its result.
  pub fn on_ui_thread<T, F>(self: &Arc<Self>, f: F) -> Result<T, String>
  where
    T: Send + 'static,
    F: FnOnce(&Shell) -> T + Send + 'static,
  {
    let (tx, rx) = mpsc::channel();
    let shell = Arc::clone(self);
    self
      .app
      .run_on_main_thread(move || {
        let _ = tx.send(f(&shell));
      })
      .map_err(|e| e.to_string())?;
    rx.recv_timeout(Duration::from_secs(5)).map_err(|_| "the UI thread did not answer".to_string())
  }
}

fn window_info(mode: &WindowMode, view: Option<String>, rect: Rect, monitor: Monitor, native_ms: f64) -> WindowInfo {
  WindowInfo {
    kind: mode.kind(),
    view,
    x: rect.x,
    y: rect.y,
    width: rect.w,
    height: rect.h,
    scale: monitor.scale,
    css_width: f64::from(rect.w) / monitor.scale,
    css_height: f64::from(rect.h) / monitor.scale,
    monitor,
    native_ms,
  }
}

/// Hand the keyboard back to the window that had it before the shortcut, if this window
/// still has it and that one still exists. If the user has already clicked elsewhere, the
/// keyboard is where they put it and stays there.
fn give_keyboard_back(ours: Hwnd, from: isize) {
  // While the foreground is passing from one window to another Windows says there is
  // none. That is not "the user has gone elsewhere": wait it out, briefly.
  let mut front = win::foreground_window();
  for _ in 0..12 {
    if front != 0 {
      break;
    }
    std::thread::sleep(Duration::from_millis(10));
    front = win::foreground_window();
  }
  if front == ours.0 && win::is_window(Hwnd(from)) {
    win::set_foreground(Hwnd(from));
  }
}

/// Write the wanted style if the window does not already have it. Returns the style it
/// found and the one it wrote, if it had to write.
fn apply_style(hwnd: Hwnd, catching: bool, focusable: bool, layered_always: bool) -> Option<(u32, u32)> {
  let actual = win::ex_style(hwnd);
  let wanted = desired_ex_style(actual, catching, focusable, layered_always);
  if actual == wanted {
    return None;
  }
  win::set_ex_style(hwnd, wanted);
  if layered_always && actual & win::EX_LAYERED == 0 {
    win::set_layered_opaque(hwnd);
  }
  Some((actual, wanted))
}

/// What a style write by the tracker was: the window following a decision the tracker
/// made on this very tick (`Flip`), the shell catching up with a change it had asked for
/// itself (`CatchUp`), or neither, which leaves only somebody else having rewritten the
/// style (`Repair`).
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum StyleWrite {
  Flip,
  CatchUp,
  Repair,
}

pub fn classify_style_write(flipped: bool, due: bool) -> StyleWrite {
  if flipped {
    StyleWrite::Flip
  } else if due {
    StyleWrite::CatchUp
  } else {
    StyleWrite::Repair
  }
}

// ---- The cursor tracker ---------------------------------------------------------

/// Start the thread that makes click-through follow the cursor.
///
/// Windows can only make a whole window click-through or not, so this thread
/// samples the cursor and switches the window to "catching" while the cursor is
/// over one of the page's hit regions, and back the moment it leaves.
pub fn spawn_tracker(shell: Arc<Shell>) {
  std::thread::Builder::new()
    .name("doozer-cursor".into())
    .spawn(move || {
      loop {
        // If a tick ever panics (unwinding builds only; release builds abort,
        // which removes the window altogether), fail open and carry on.
        let run = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
          loop {
            let pause = tick(&shell);
            std::thread::sleep(pause);
          }
        }));
        if run.is_err() {
          {
            let mut s = shell.lock();
            s.regions.clear();
            s.regions_lost = true;
            s.style_due |= s.catching;
            s.catching = false;
            s.drag = None;
          }
          shell.sync_style();
          std::thread::sleep(Duration::from_millis(250));
        }
      }
    })
    .expect("could not start the cursor tracker thread");
}

fn tick(shell: &Shell) -> Duration {
  let now = Instant::now();
  // None on the secure desktop (lock screen, UAC prompt): treat as "not over Doozer".
  let real_cursor = win::cursor_pos();
  let real_button_down = real_cursor.is_some() && win::any_button_down();

  let mut move_to = None;
  let mut drag_ended = false;
  let mut watchdog_tripped = false;
  let mut flipped = false;
  let mut check_display = None;
  let mut slow_checks_due = false;
  let mut released: Option<Option<ReleasedAt>> = None;

  let (hwnd, catching, focusable, layered_always, pause, keyboard_back, style_due) = {
    let mut s = shell.lock();
    s.stats.ticks += 1;
    let (cursor, button_down) = match s.injected {
      Some((position, down)) => (Some(position), down),
      None => (real_cursor, real_button_down),
    };
    if let Some(c) = cursor
      && c != s.last_cursor
    {
      s.last_cursor = c;
      s.last_cursor_move = now;
    }

    // Dragging the window: follow the cursor until every button is up.
    if let Some(drag) = s.drag {
      match cursor {
        Some((cx, cy)) if button_down => move_to = Some((cx - drag.grab_x, cy - drag.grab_y)),
        _ => {
          s.drag = None;
          drag_ended = true;
        }
      }
    }

    // The shortcut gave the window the keyboard and the page never said it wanted it
    // (it is hung, or the view has no Card to open): give it back.
    let mut keyboard_back = None;
    if let Some(since) = s.keyboard_pending
      && now.duration_since(since) > KEYBOARD_GRACE
    {
      s.keyboard_pending = None;
      s.style_due |= s.focusable;
      s.focusable = false;
      keyboard_back = s.keyboard_from.take().map(|from| (s.hwnd, from));
    }

    // Watchdog: a page that has stopped checking in cannot be trusted to have
    // current regions. Drop them, so a hung or crashed page can never leave an
    // invisible patch of screen that swallows clicks.
    if !s.regions.is_empty() && now.duration_since(s.last_heartbeat) > WATCHDOG_TIMEOUT {
      s.regions.clear();
      s.regions_lost = true;
      s.drag = None;
      s.stats.watchdog_trips += 1;
      watchdog_tripped = true;
    }

    let inside = match cursor {
      Some((cx, cy)) if s.visible && !s.regions.is_empty() => match win::screen_to_client(s.hwnd, cx, cy) {
        Some((px, py)) => {
          let scale = win::scale_of(s.hwnd);
          let since = now.saturating_duration_since(s.regions_at).as_secs_f64() * 1000.0;
          hit::any_contains_at(&s.regions, f64::from(px) / scale, f64::from(py) / scale, since)
        }
        None => false,
      },
      _ => false,
    };
    let wanted = if s.drag.is_some() { true } else { hit::decide(s.catching, inside, button_down) };
    if wanted != s.catching {
      s.catching = wanted;
      s.stats.flips += 1;
      flipped = true;
    }

    // The other half of "never stuck": a press that went to the page has ended.
    // The page is told, so a drag it is running ends even if it never sees the mouse-up.
    let (holding, press_ended) = hit::hold_step(s.holding, s.catching, button_down, s.drag.is_some());
    s.holding = holding;
    if press_ended {
      let at = cursor.and_then(|(cx, cy)| win::screen_to_client(s.hwnd, cx, cy)).map(|(px, py)| {
        let scale = win::scale_of(s.hwnd);
        ReleasedAt { x: f64::from(px) / scale, y: f64::from(py) / scale }
      });
      released = Some(at);
    }

    if now.duration_since(s.last_display_check) >= DISPLAY_CHECK {
      s.last_display_check = now;
      slow_checks_due = true;
      if s.drag.is_none()
        && !drag_ended
        && let (Some(mode), Some(placed)) = (s.mode.clone(), s.placed_on)
      {
        check_display = Some((mode, placed));
      }
    }

    let pause = if s.drag.is_some() {
      TICK_DRAGGING
    } else if s.holding || now.duration_since(s.last_cursor_move) < ACTIVE_FOR || crate::spike::always_fast_ticks() {
      // While a button is held on the page, stay fast even if the cursor is still:
      // the release has to be noticed promptly.
      TICK_ACTIVE
    } else {
      TICK_RESTING
    };
    // Whatever was left for this tick to write is written below: the note is spent.
    let style_due = std::mem::take(&mut s.style_due);
    (s.hwnd, s.catching, s.focusable, s.layered_always, pause, keyboard_back, style_due)
  };
  if let Some((ours, from)) = keyboard_back {
    give_keyboard_back(ours, from);
  }

  // From here on the lock is released: these calls can send window messages.
  if let Some((x, y)) = move_to {
    win::move_to(hwnd, x, y);
  }
  // Every tick, not only on a flip: this is also what repairs the style if
  // something else (Tao, another program) has changed it behind our back.
  if let Some((from, to)) = apply_style(hwnd, catching, focusable, layered_always) {
    let mut s = shell.lock();
    match classify_style_write(flipped, style_due) {
      StyleWrite::Flip => {}
      StyleWrite::CatchUp => s.stats.style_catch_ups += 1,
      StyleWrite::Repair => {
        s.stats.style_repairs += 1;
        s.stats.last_repair_from = from;
        s.stats.last_repair_to = to;
      }
    }
  }

  if drag_ended && let Some(rect) = win::window_rect(hwnd) {
    let info = {
      let mut s = shell.lock();
      if let Some(WindowMode::Floating { x, y, .. }) = s.mode.as_mut() {
        *x = Some(rect.x);
        *y = Some(rect.y);
      }
      // The window may have been carried to another monitor.
      s.placed_on = win::monitor_of_window(hwnd).or(s.placed_on);
      match (s.mode.clone(), s.placed_on) {
        (Some(mode), Some(monitor)) => Some(window_info(&mode, s.view.clone(), rect, monitor, 0.0)),
        _ => None,
      }
    };
    if let Some(info) = info {
      let _ = shell.app.emit(EVENT_DRAG_END, info);
    }
  }
  if let Some(at) = released {
    let _ = shell.app.emit(EVENT_POINTER_RELEASED, at);
  }
  if watchdog_tripped {
    let _ = shell.app.emit(EVENT_WATCHDOG, "page-silent");
  }
  if slow_checks_due {
    // Once a second: has a fullscreen app come to the front, or gone away?
    let fullscreen = win::fullscreen_app_in_front();
    let changed = {
      let mut s = shell.lock();
      let changed = s.fullscreen_in_front != fullscreen;
      s.fullscreen_in_front = fullscreen;
      changed
    };
    if changed {
      let _ = shell.app.emit(EVENT_FULLSCREEN_CHANGED, fullscreen);
    }
  }
  if let Some((mode, placed)) = check_display {
    let current = match mode.saved_position() {
      Some((x, y)) => win::monitor_at(x, y),
      None => win::monitor_of_window(hwnd),
    };
    if let Some(current) = current
      && current != placed
    {
      replace_after_display_change(shell, mode);
    }
  }
  pause
}

/// The taskbar moved, the resolution or the scaling changed, a monitor came or
/// went. Put the window back where its mode says it belongs and tell the page.
fn replace_after_display_change(shell: &Shell, mode: WindowMode) {
  let app = shell.app.clone();
  let _ = shell.app.run_on_main_thread(move || {
    use tauri::Manager;
    let shell = app.state::<Arc<Shell>>();
    if let Ok(info) = shell.apply_mode(mode, None, true) {
      shell.lock().stats.display_changes += 1;
      let _ = app.emit(EVENT_DISPLAY_CHANGED, info);
    }
  });
}

#[cfg(test)]
mod tests {
  use super::*;
  use crate::win::{EX_APPWINDOW, EX_LAYERED, EX_NOACTIVATE, EX_TOOLWINDOW, EX_TRANSPARENT};

  const OTHER: u32 = 0x0000_0008 | 0x0000_0100; // WS_EX_TOPMOST | WS_EX_WINDOWEDGE: not ours to touch

  /// The counter that read 19 after a three-hour soak counted the middle case as the last.
  #[test]
  fn a_style_write_the_shell_asked_for_is_not_a_repair() {
    assert_eq!(classify_style_write(true, false), StyleWrite::Flip);
    assert_eq!(classify_style_write(true, true), StyleWrite::Flip);
    assert_eq!(classify_style_write(false, true), StyleWrite::CatchUp);
    assert_eq!(classify_style_write(false, false), StyleWrite::Repair);
  }

  #[test]
  fn letting_clicks_through_sets_layered_and_transparent() {
    let style = desired_ex_style(OTHER, false, false, false);
    assert_eq!(style, OTHER | EX_TOOLWINDOW | EX_NOACTIVATE | EX_TRANSPARENT | EX_LAYERED);
  }

  #[test]
  fn catching_clears_transparent() {
    let through = desired_ex_style(OTHER, false, false, false);
    let catching = desired_ex_style(through, true, false, false);
    assert_eq!(catching, OTHER | EX_TOOLWINDOW | EX_NOACTIVATE);
    assert_eq!(desired_ex_style(through, true, false, true), OTHER | EX_TOOLWINDOW | EX_NOACTIVATE | EX_LAYERED);
  }

  #[test]
  fn focusable_drops_no_activate_only() {
    let style = desired_ex_style(OTHER, true, true, false);
    assert_eq!(style, OTHER | EX_TOOLWINDOW);
  }

  #[test]
  fn the_taskbar_style_tao_adds_is_removed_and_unmanaged_bits_survive() {
    let style = desired_ex_style(OTHER | EX_APPWINDOW, false, false, false);
    assert_eq!(style & EX_APPWINDOW, 0);
    assert_eq!(style & OTHER, OTHER);
  }

  #[test]
  fn the_wanted_style_is_stable() {
    for catching in [false, true] {
      for focusable in [false, true] {
        for layered in [false, true] {
          let once = desired_ex_style(OTHER | EX_APPWINDOW, catching, focusable, layered);
          assert_eq!(desired_ex_style(once, catching, focusable, layered), once);
        }
      }
    }
  }
}
