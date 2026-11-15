//! Test hooks for the Phase 3 shell spike. See docs/shell-spike.md.
//!
//! Built only with `--features spike`. Without the feature every command here
//! answers with an error and the helper functions do nothing, so a normal build
//! contains none of this machinery.
//!
//! The hooks keep the real mouse out of test runs. The cursor tracker is fed a
//! pretend cursor (`spike_inject`), so a test neither moves the user's pointer
//! nor is disturbed by it, while the window style it produces is the real one
//! and is read back from Windows. The one exception, `spike_real_input`, uses
//! the real pointer and refuses to run unless the machine has been left alone.
//!
//! * `spike_inject`, `spike_probe` — pretend cursor; read back what Windows would hit
//! * `spike_backdrop`              — flat-colour patches behind the areas being filmed
//! * `spike_capture_*`             — sample screen rectangles as fast as possible
//! * `spike_clobber_style`         — break the window style on purpose, to test the repair
//! * `spike_real_input`            — real pointer and real clicks, only on an idle machine

use serde_json::Value;
use tauri::utils::config::WindowConfig;

#[cfg(not(feature = "spike"))]
const DISABLED: &str = "this build does not include the spike test hooks (build with --features spike)";

/// Experiment switches read from the environment before the window is created.
pub fn adjust_window_config(config: &mut WindowConfig) {
  #[cfg(feature = "spike")]
  if let Ok(v) = std::env::var("DOOZER_NRB") {
    config.no_redirection_bitmap = v == "1";
  }
  let _ = config;
}

/// Whether WS_EX_LAYERED stays on permanently (true) or is toggled together
/// with click-through (false). See docs/shell-spike.md for why this is the default.
pub fn layered_always() -> bool {
  #[cfg(feature = "spike")]
  if let Ok(v) = std::env::var("DOOZER_CT") {
    return v == "perma";
  }
  false
}

/// Experiment switch: go back to moving and invalidating the window on every
/// mode change, even when its rectangle is unchanged. Only for reproducing the
/// "view vanishes after being re-applied" problem described in docs/shell-spike.md.
pub fn always_reposition() -> bool {
  #[cfg(feature = "spike")]
  return std::env::var("DOOZER_SPIKE_ALWAYS_SETPOS").as_deref() == Ok("1");
  #[cfg(not(feature = "spike"))]
  false
}

/// Experiment switch: sample the cursor at the fast rate all the time, as if the
/// mouse never stopped moving. For measuring what the tracker costs at its busiest.
pub fn always_fast_ticks() -> bool {
  #[cfg(feature = "spike")]
  return std::env::var("DOOZER_SPIKE_FAST_TICKS").as_deref() == Ok("1");
  #[cfg(not(feature = "spike"))]
  false
}

/// Test runs start several copies at once (one films another starting up).
pub fn allow_many_instances() -> bool {
  #[cfg(feature = "spike")]
  return std::env::var("DOOZER_SPIKE").is_ok();
  #[cfg(not(feature = "spike"))]
  false
}

pub fn start(_app: &tauri::AppHandle) {
  #[cfg(feature = "spike")]
  imp::start(_app);
}

/// Record a timestamped label alongside the screen-capture frames.
pub fn mark(_label: &str) {
  #[cfg(feature = "spike")]
  imp::mark(_label);
}

#[tauri::command]
pub fn spike_config() -> Value {
  #[cfg(feature = "spike")]
  return imp::config();
  #[cfg(not(feature = "spike"))]
  serde_json::json!({ "enabled": false })
}

/// Replace the real mouse with a pretend cursor at a viewport point (CSS
/// pixels), or pass `null` to hand control back to the real mouse.
#[tauri::command]
pub fn spike_inject(_app: tauri::AppHandle, _cursor: Option<Value>) -> Result<Value, String> {
  #[cfg(feature = "spike")]
  return imp::inject(&_app, _cursor);
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

#[tauri::command(async)]
pub fn spike_probe(_app: tauri::AppHandle, _points: Value, _settle_ms: Option<u64>) -> Result<Value, String> {
  #[cfg(feature = "spike")]
  return imp::probe(&_app, _points, _settle_ms.unwrap_or(150));
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

#[tauri::command(async)]
pub fn spike_real_input(_app: tauri::AppHandle, _steps: Value, _min_idle_ms: Option<u32>) -> Result<Value, String> {
  #[cfg(feature = "spike")]
  return imp::real_input(&_app, _steps, _min_idle_ms.unwrap_or(45_000));
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

#[tauri::command(async)]
pub fn spike_backdrop(_app: tauri::AppHandle, _rects: Option<Value>) -> Result<Value, String> {
  #[cfg(feature = "spike")]
  return imp::backdrop(&_app, _rects);
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

#[tauri::command(async)]
pub fn spike_capture_start(_rects: Value, _name: Option<String>) -> Result<Value, String> {
  #[cfg(feature = "spike")]
  return imp::capture_start(_rects, _name);
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

#[tauri::command(async)]
pub fn spike_capture_stop() -> Result<Value, String> {
  #[cfg(feature = "spike")]
  return imp::capture_stop();
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

#[tauri::command]
pub fn spike_mark(_label: String) -> f64 {
  #[cfg(feature = "spike")]
  return imp::mark(&_label);
  #[cfg(not(feature = "spike"))]
  0.0
}

/// Set the window's click-through style to the opposite of what it should be,
/// as a misbehaving library or program might. The tracker has to put it right.
#[tauri::command]
pub fn spike_clobber_style(_app: tauri::AppHandle) -> Result<Value, String> {
  #[cfg(feature = "spike")]
  return imp::clobber_style(&_app);
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

/// What is on screen right now at some points (screen pixels), and where Doozer
/// and the backdrops sit in the stacking order. No backdrop needed.
#[tauri::command(async)]
pub fn spike_look(_app: tauri::AppHandle, _points: Value) -> Result<Value, String> {
  #[cfg(feature = "spike")]
  return imp::look(&_app, _points);
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

/// Act as if a native menu item had been clicked, and say which view items are ticked afterwards.
#[tauri::command(async)]
pub fn spike_menu(_app: tauri::AppHandle, _id: Option<String>) -> Result<Value, String> {
  #[cfg(feature = "spike")]
  return imp::menu(&_app, _id);
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

/// Act as if the keyboard shortcut had been pressed. This really takes the keyboard, so a
/// scripted run only does it when nobody has touched the machine for a while.
#[tauri::command(async)]
pub fn spike_shortcut(_app: tauri::AppHandle) -> Result<Value, String> {
  #[cfg(feature = "spike")]
  return imp::shortcut(&_app);
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

/// True when "start with Windows" is pointed at a scratch registry key, so a
/// test may switch it on and off without touching the real one.
#[tauri::command]
pub fn spike_autostart_is_scratch() -> bool {
  #[cfg(feature = "spike")]
  return std::env::var("DOOZER_AUTOSTART_KEY").is_ok();
  #[cfg(not(feature = "spike"))]
  false
}

#[tauri::command(async)]
pub fn spike_report(_name: String, _json: String) -> Result<String, String> {
  #[cfg(feature = "spike")]
  return imp::report(&_name, &_json);
  #[cfg(not(feature = "spike"))]
  Err(DISABLED.into())
}

#[cfg(feature = "spike")]
mod imp {
  use crate::mode::Rect;
  use crate::shell::Shell;
  use crate::win::{self, Hwnd};
  use serde::Deserialize;
  use serde_json::{Value, json};
  use std::collections::HashSet;
  use std::ffi::c_void;
  use std::path::PathBuf;
  use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
  use std::sync::{Arc, Mutex, OnceLock};
  use std::time::{Duration, Instant};
  use tauri::Manager;
  use windows::Win32::Foundation::{COLORREF, HMODULE, HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
  use windows::Win32::Graphics::Direct3D::D3D_DRIVER_TYPE_HARDWARE;
  use windows::Win32::Graphics::Direct3D11::{
    D3D11_BOX, D3D11_CPU_ACCESS_READ, D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_MAP_READ, D3D11_MAPPED_SUBRESOURCE,
    D3D11_SDK_VERSION, D3D11_TEXTURE2D_DESC, D3D11_USAGE_STAGING, D3D11CreateDevice, ID3D11Device, ID3D11DeviceContext,
    ID3D11Texture2D,
  };
  use windows::Win32::Graphics::Dxgi::Common::{DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_SAMPLE_DESC};
  use windows::Win32::Graphics::Dxgi::{
    DXGI_ERROR_WAIT_TIMEOUT, DXGI_OUTDUPL_FRAME_INFO, IDXGIDevice, IDXGIOutput1, IDXGIResource,
  };
  use windows::Win32::Graphics::Gdi::{
    BI_RGB, BITMAPINFO, BITMAPINFOHEADER, BeginPaint, BitBlt, CreateCompatibleDC, CreateDIBSection, CreateSolidBrush,
    DIB_RGB_COLORS, DT_LEFT, DT_SINGLELINE, DeleteDC, DeleteObject, DrawTextW, EndPaint, GetDC, GetPixel, HBITMAP, HDC,
    PAINTSTRUCT, ReleaseDC, SRCCOPY, SelectObject, SetBkMode, SetTextColor, TRANSPARENT,
  };
  use windows::Win32::System::LibraryLoader::GetModuleHandleW;
  use windows::Win32::UI::Input::KeyboardAndMouse::{
    INPUT, INPUT_0, INPUT_MOUSE, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEINPUT, SendInput,
  };
  use windows::Win32::UI::WindowsAndMessaging::{
    CS_HREDRAW, CS_VREDRAW, CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GA_ROOT, GW_HWNDNEXT,
    GetAncestor, GetClientRect, GetMessageW, GetTopWindow, GetWindow, HWND_TOPMOST, IDC_ARROW, LoadCursorW, MSG,
    PostMessageW, PostQuitMessage, RegisterClassW, SW_SHOWNOACTIVATE, SWP_NOACTIVATE, SetCursorPos, SetTimer,
    SetWindowPos, ShowWindow, TranslateMessage, WM_CLOSE, WM_DESTROY, WM_LBUTTONDOWN, WM_PAINT, WM_TIMER, WNDCLASSW,
    WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_POPUP, WindowFromPoint,
  };
  use windows::core::{Interface, PCWSTR, w};

  /// The backdrop colour: pure magenta, which nothing on the test page uses.
  const BACKDROP_RGB: (u8, u8, u8) = (255, 0, 255);
  const BACKDROP_CLASS: PCWSTR = w!("DoozerSpikeBackdrop");
  /// Backdrops remove themselves after this long even if the test never finishes.
  const BACKDROP_MAX_LIFE_MS: u32 = 3 * 60 * 1000;
  /// A patch no taller than this is a label, not a backdrop: it gets the explanatory text.
  const LABEL_PATCH_MAX_HEIGHT: i32 = 48;

  static EPOCH: OnceLock<Instant> = OnceLock::new();
  static MARKS: Mutex<Vec<(f64, String)>> = Mutex::new(Vec::new());
  static BACKDROPS: Mutex<Vec<isize>> = Mutex::new(Vec::new());
  static BACKDROP_CLICKS: AtomicU32 = AtomicU32::new(0);
  static CAPTURE: Mutex<Option<Capture>> = Mutex::new(None);
  /// Set between the marks `blank-begin` and `blank-end`: the page has hidden
  /// everything, so every filmed pixel should be backdrop.
  static BLANK: AtomicBool = AtomicBool::new(false);

  fn now_ms() -> f64 {
    EPOCH.get_or_init(Instant::now).elapsed().as_secs_f64() * 1000.0
  }

  fn out_dir() -> PathBuf {
    let dir = std::env::var("DOOZER_SPIKE_OUT")
      .map(PathBuf::from)
      .unwrap_or_else(|_| std::env::temp_dir().join("doozer-spike"));
    let _ = std::fs::create_dir_all(&dir);
    dir
  }

  fn shell_of(app: &tauri::AppHandle) -> Arc<Shell> {
    Arc::clone(&app.state::<Arc<Shell>>())
  }

  pub fn start(app: &tauri::AppHandle) {
    now_ms();
    // Run without anything appearing on screen, for checks that do not need to be seen.
    if std::env::var("DOOZER_SPIKE_CLOAK").as_deref() == Ok("1") {
      win::set_cloaked(shell_of(app).hwnd(), true);
    }
  }

  pub fn config() -> Value {
    let scenario = std::env::var("DOOZER_SPIKE").ok();
    let args: Value =
      std::env::var("DOOZER_SPIKE_ARGS").ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or(Value::Null);
    json!({
      "enabled": scenario.is_some(),
      "scenario": scenario,
      "args": args,
      "out": out_dir().to_string_lossy(),
      "noRedirectionBitmap": std::env::var("DOOZER_NRB").ok(),
      "clickThrough": std::env::var("DOOZER_CT").ok(),
      "cloaked": std::env::var("DOOZER_SPIKE_CLOAK").as_deref() == Ok("1"),
      "debugBuild": cfg!(debug_assertions),
    })
  }

  pub fn mark(label: &str) -> f64 {
    let t = now_ms();
    match label {
      "blank-begin" => BLANK.store(true, Ordering::SeqCst),
      "blank-end" => BLANK.store(false, Ordering::SeqCst),
      _ => {}
    }
    MARKS.lock().unwrap().push((t, label.to_string()));
    t
  }

  pub fn report(name: &str, json: &str) -> Result<String, String> {
    let safe: String =
      name.chars().map(|c| if c.is_ascii_alphanumeric() || "-_.".contains(c) { c } else { '_' }).collect();
    let path = out_dir().join(safe);
    std::fs::write(&path, json).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
  }

  /// What Windows would deliver a click to at this screen point.
  fn under_point(x: i32, y: i32) -> (isize, String) {
    // SAFETY: plain queries.
    let hit = unsafe { WindowFromPoint(POINT { x, y }) };
    if hit.0.is_null() {
      return (0, String::new());
    }
    let root = unsafe { GetAncestor(hit, GA_ROOT) };
    let root = if root.0.is_null() { hit } else { root };
    (root.0 as isize, win::class_name(Hwnd(root.0 as isize)))
  }

  fn to_screen(hwnd: Hwnd, css_x: f64, css_y: f64) -> Option<(i32, i32)> {
    let scale = win::scale_of(hwnd);
    win::client_to_screen(hwnd, (css_x * scale).round() as i32, (css_y * scale).round() as i32)
  }

  #[derive(Deserialize)]
  struct InjectedCursor {
    x: f64,
    y: f64,
    #[serde(default)]
    down: bool,
    /// Give the position in screen pixels instead of viewport CSS pixels.
    #[serde(default)]
    screen: bool,
  }

  pub fn inject(app: &tauri::AppHandle, cursor: Option<Value>) -> Result<Value, String> {
    let shell = shell_of(app);
    let Some(cursor) = cursor.filter(|c| !c.is_null()) else {
      shell.inject_cursor(None);
      return Ok(json!({ "injected": false }));
    };
    let c: InjectedCursor = serde_json::from_value(cursor).map_err(|e| e.to_string())?;
    let position = if c.screen {
      (c.x.round() as i32, c.y.round() as i32)
    } else {
      to_screen(shell.hwnd(), c.x, c.y).ok_or("no screen position")?
    };
    shell.inject_cursor(Some((position, c.down)));
    Ok(json!({ "injected": true, "screen": [position.0, position.1], "down": c.down }))
  }

  #[derive(Deserialize)]
  struct ProbePoint {
    label: String,
    x: f64,
    y: f64,
    #[serde(default)]
    down: bool,
  }

  /// Put the pretend cursor on each point (CSS pixels in the viewport), give the
  /// tracker time to react, and record what Windows now says about that spot:
  /// the window's real style, and the window a click there would be delivered to.
  /// The real pointer is not touched.
  pub fn probe(app: &tauri::AppHandle, points: Value, settle_ms: u64) -> Result<Value, String> {
    let points: Vec<ProbePoint> = serde_json::from_value(points).map_err(|e| e.to_string())?;
    let shell = shell_of(app);
    let hwnd = shell.hwnd();
    let mut results = Vec::new();
    for p in points {
      let Some((sx, sy)) = to_screen(hwnd, p.x, p.y) else {
        results.push(json!({ "label": p.label, "error": "no screen position" }));
        continue;
      };
      shell.inject_cursor(Some(((sx, sy), p.down)));
      std::thread::sleep(Duration::from_millis(settle_ms));
      let style = win::ex_style(hwnd);
      let (root, class) = under_point(sx, sy);
      results.push(json!({
        "label": p.label,
        "screen": [sx, sy],
        "down": p.down,
        "styleClickThrough": style & win::EX_TRANSPARENT != 0,
        "hitIsDoozer": root == hwnd.0,
        "hitClass": class,
      }));
    }
    Ok(Value::Array(results))
  }

  pub fn shortcut(app: &tauri::AppHandle) -> Result<Value, String> {
    let shell = Arc::clone(&*app.state::<Arc<Shell>>());
    let before = win::foreground_window();
    crate::hotkey::pressed(app, &shell);
    Ok(json!({ "foregroundBefore": before, "foregroundAfter": win::foreground_window(), "ours": shell.hwnd().0 }))
  }

  pub fn menu(app: &tauri::AppHandle, id: Option<String>) -> Result<Value, String> {
    use crate::tray::TrayMenu;
    if let Some(id) = id {
      let handle = app.clone();
      app
        .run_on_main_thread(move || {
          crate::tray::on_menu_event(&handle, tauri::menu::MenuEvent { id: tauri::menu::MenuId::new(id) })
        })
        .map_err(|e| e.to_string())?;
      std::thread::sleep(Duration::from_millis(60));
    }
    let ticked = app.try_state::<TrayMenu>().map(|m| m.ticked()).unwrap_or_default();
    let items = app.try_state::<TrayMenu>().map(|m| m.describe()).unwrap_or_default();
    let labels: serde_json::Map<String, Value> = items.iter().map(|(id, text, _)| (id.to_string(), json!(text))).collect();
    let enabled: serde_json::Map<String, Value> = items.iter().map(|(id, _, on)| (id.to_string(), json!(on))).collect();
    Ok(json!({
      "ticked": ticked,
      "trayIconExists": app.tray_by_id("doozer").is_some(),
      "labels": labels,
      "enabled": enabled,
    }))
  }

  pub fn look(app: &tauri::AppHandle, points: Value) -> Result<Value, String> {
    let points: Vec<(i32, i32)> = serde_json::from_value(points).map_err(|e| e.to_string())?;
    let doozer = shell_of(app).hwnd();
    let backdrops = BACKDROPS.lock().unwrap().clone();
    // SAFETY: reading single pixels from the screen and walking the window list.
    unsafe {
      let screen = GetDC(None);
      let colours: Vec<Value> = points
        .iter()
        .map(|(x, y)| {
          let c = GetPixel(screen, *x, *y).0;
          json!([c & 0xff, (c >> 8) & 0xff, (c >> 16) & 0xff])
        })
        .collect();
      ReleaseDC(None, screen);
      // Top-level windows from front to back; note where ours are.
      let mut order = Vec::new();
      let mut index = 0;
      let mut next = GetTopWindow(None).ok();
      while let Some(hwnd) = next {
        let raw = hwnd.0 as isize;
        if raw == doozer.0 {
          order.push(json!({ "at": index, "window": "doozer" }));
        } else if backdrops.contains(&raw) {
          order.push(json!({ "at": index, "window": "backdrop" }));
        }
        index += 1;
        next = GetWindow(hwnd, GW_HWNDNEXT).ok();
      }
      Ok(json!({ "colours": colours, "order": order, "doozerVisible": win::is_visible(doozer) }))
    }
  }

  pub fn clobber_style(app: &tauri::AppHandle) -> Result<Value, String> {
    let hwnd = shell_of(app).hwnd();
    let before = win::ex_style(hwnd);
    // Flip click-through and knock out the other managed bits.
    let broken = (before ^ win::EX_TRANSPARENT) & !(win::EX_NOACTIVATE | win::EX_TOOLWINDOW);
    win::set_ex_style(hwnd, broken);
    Ok(json!({ "before": before, "broken": broken, "at": now_ms() }))
  }

  // ---- Real pointer, real clicks: only on a machine nobody is using ----------

  #[derive(Deserialize)]
  struct RealStep {
    label: String,
    x: f64,
    y: f64,
    #[serde(default)]
    click: bool,
  }

  /// Move the real pointer through `steps` (viewport CSS pixels), optionally
  /// clicking. Refuses unless nobody has touched the machine for `min_idle_ms`
  /// and no fullscreen app is in front. A click is only sent if it would land on
  /// Doozer or on one of the spike's own backdrops, never on another program.
  /// Stops at the first sign that a person has taken the mouse.
  pub fn real_input(app: &tauri::AppHandle, steps: Value, min_idle_ms: u32) -> Result<Value, String> {
    let steps: Vec<RealStep> = serde_json::from_value(steps).map_err(|e| e.to_string())?;
    let idle = win::user_idle_ms();
    if idle < min_idle_ms {
      return Ok(json!({ "ran": false, "why": format!("the machine is in use (last input {idle} ms ago)") }));
    }
    if win::foreground_is_fullscreen() {
      return Ok(json!({ "ran": false, "why": "a fullscreen app is in front" }));
    }
    let shell = shell_of(app);
    let hwnd = shell.hwnd();
    let backdrops = BACKDROPS.lock().unwrap().clone();
    let home = win::cursor_pos();
    shell.inject_cursor(None); // the tracker follows the real pointer for this test
    let mut results = Vec::new();
    let mut aborted = None;
    for step in steps {
      let Some((sx, sy)) = to_screen(hwnd, step.x, step.y) else { continue };
      // SAFETY: moving the pointer; it is put back below.
      let _ = unsafe { SetCursorPos(sx, sy) };
      std::thread::sleep(Duration::from_millis(160));
      if win::cursor_pos() != Some((sx, sy)) {
        aborted = Some("someone moved the mouse");
        break;
      }
      let style = win::ex_style(hwnd);
      let (root, class) = under_point(sx, sy);
      let target = if root == hwnd.0 {
        "doozer"
      } else if backdrops.contains(&root) {
        "backdrop"
      } else {
        "other"
      };
      let backdrop_before = BACKDROP_CLICKS.load(Ordering::SeqCst);
      let foreground_before = win::foreground_window();
      let mut clicked = false;
      if step.click && target != "other" {
        let press = |flags| INPUT {
          r#type: INPUT_MOUSE,
          Anonymous: INPUT_0 { mi: MOUSEINPUT { dx: 0, dy: 0, mouseData: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } },
        };
        // SAFETY: two well-formed mouse events, aimed at our own windows (checked above).
        unsafe {
          SendInput(&[press(MOUSEEVENTF_LEFTDOWN)], std::mem::size_of::<INPUT>() as i32);
          std::thread::sleep(Duration::from_millis(50));
          SendInput(&[press(MOUSEEVENTF_LEFTUP)], std::mem::size_of::<INPUT>() as i32);
        }
        clicked = true;
        std::thread::sleep(Duration::from_millis(200));
      }
      results.push(json!({
        "label": step.label,
        "screen": [sx, sy],
        "styleClickThrough": style & win::EX_TRANSPARENT != 0,
        "target": target,
        "hitClass": class,
        "clicked": clicked,
        "backdropClicks": BACKDROP_CLICKS.load(Ordering::SeqCst) - backdrop_before,
        "foregroundChanged": win::foreground_window() != foreground_before,
        "doozerIsForeground": win::foreground_window() == hwnd.0,
      }));
    }
    if let Some((x, y)) = home {
      // SAFETY: putting the pointer back where it was.
      let _ = unsafe { SetCursorPos(x, y) };
    }
    Ok(json!({ "ran": true, "idleMsBefore": idle, "aborted": aborted, "steps": results }))
  }

  // ---- Backdrop patches ------------------------------------------------------

  unsafe extern "system" fn backdrop_proc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    unsafe {
      match msg {
        WM_LBUTTONDOWN => {
          BACKDROP_CLICKS.fetch_add(1, Ordering::SeqCst);
          LRESULT(0)
        }
        WM_PAINT => {
          let mut ps = PAINTSTRUCT::default();
          let hdc = BeginPaint(hwnd, &mut ps);
          let mut client = RECT::default();
          let _ = GetClientRect(hwnd, &mut client);
          if client.bottom <= LABEL_PATCH_MAX_HEIGHT {
            SetBkMode(hdc, TRANSPARENT);
            SetTextColor(hdc, COLORREF(0x0050_0050));
            let mut text: Vec<u16> =
              "Doozer shell test: filming the pink area, closes by itself".encode_utf16().collect();
            let mut rc = RECT { left: 10, top: 6, right: client.right, bottom: client.bottom };
            DrawTextW(hdc, &mut text, &mut rc, DT_LEFT | DT_SINGLELINE);
          }
          let _ = EndPaint(hwnd, &ps);
          LRESULT(0)
        }
        WM_TIMER | WM_CLOSE => {
          let _ = DestroyWindow(hwnd);
          LRESULT(0)
        }
        WM_DESTROY => {
          let mut list = BACKDROPS.lock().unwrap();
          list.retain(|h| *h != hwnd.0 as isize);
          if list.is_empty() {
            PostQuitMessage(0);
          }
          LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, msg, wparam, lparam),
      }
    }
  }

  /// Show a flat-colour, always-on-top, non-activating patch behind each
  /// rectangle (screen pixels), or remove them all when `rects` is null.
  pub fn backdrop(app: &tauri::AppHandle, rects: Option<Value>) -> Result<Value, String> {
    let existing = BACKDROPS.lock().unwrap().clone();
    for h in &existing {
      // SAFETY: asking our own windows to close.
      let _ = unsafe { PostMessageW(Some(HWND(*h as *mut c_void)), WM_CLOSE, WPARAM(0), LPARAM(0)) };
    }
    let Some(rects) = rects.filter(|r| !r.is_null()) else {
      return Ok(json!({ "shown": 0, "clicks": BACKDROP_CLICKS.load(Ordering::SeqCst) }));
    };
    let rects: Vec<Rect> = serde_json::from_value(rects).map_err(|e| e.to_string())?;
    // Let the old thread finish before starting a new set.
    let waited = Instant::now();
    while !BACKDROPS.lock().unwrap().is_empty() && waited.elapsed() < Duration::from_secs(2) {
      std::thread::sleep(Duration::from_millis(10));
    }
    let count = rects.len();
    let (tx, rx) = std::sync::mpsc::channel::<usize>();
    std::thread::Builder::new()
      .name("doozer-spike-backdrop".into())
      .spawn(move || unsafe {
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let (r, g, b) = BACKDROP_RGB;
        let brush = CreateSolidBrush(COLORREF(u32::from(r) | (u32::from(g) << 8) | (u32::from(b) << 16)));
        let class = WNDCLASSW {
          style: CS_HREDRAW | CS_VREDRAW,
          lpfnWndProc: Some(backdrop_proc),
          hInstance: instance.into(),
          hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
          hbrBackground: brush,
          lpszClassName: BACKDROP_CLASS,
          ..Default::default()
        };
        RegisterClassW(&class); // fails harmlessly the second time
        let mut made = 0;
        for area in rects {
          let Ok(hwnd) = CreateWindowExW(
            WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
            BACKDROP_CLASS,
            w!("Doozer shell test backdrop"),
            WS_POPUP,
            area.x,
            area.y,
            area.w,
            area.h,
            None,
            None,
            Some(instance.into()),
            None,
          ) else {
            continue;
          };
          BACKDROPS.lock().unwrap().push(hwnd.0 as isize);
          let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), area.x, area.y, area.w, area.h, SWP_NOACTIVATE);
          let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
          SetTimer(Some(hwnd), 1, BACKDROP_MAX_LIFE_MS, None);
          made += 1;
        }
        let _ = tx.send(made);
        if made == 0 {
          return;
        }
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
          let _ = TranslateMessage(&msg);
          DispatchMessageW(&msg);
        }
      })
      .map_err(|e| e.to_string())?;
    let made = rx.recv_timeout(Duration::from_secs(5)).unwrap_or(0);
    if made != count {
      return Err(format!("made {made} of {count} backdrop patches"));
    }
    // Everything here is always-on-top. The last window raised wins, so raise Doozer.
    let shell = shell_of(app);
    let doozer = shell.hwnd();
    shell.on_ui_thread(move |_| win::set_topmost(doozer, true))?;
    std::thread::sleep(Duration::from_millis(200));
    Ok(json!({ "shown": made, "rgb": [BACKDROP_RGB.0, BACKDROP_RGB.1, BACKDROP_RGB.2] }))
  }

  // ---- Screen capture --------------------------------------------------------
  //
  // Two ways of filming. With one rectangle the Desktop Duplication API is used:
  // Windows hands over every frame it composes, and says how many it composed
  // since the last one we took, so it is known whether any frame went unseen.
  // With several rectangles, or if duplication is unavailable, the rectangles
  // are copied from the screen with GDI, which tops out at about 60 grabs a
  // second and so can miss frames on a faster display.

  struct Capture {
    stop: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<CaptureResult>,
  }

  #[derive(Default)]
  struct CaptureResult {
    method: &'static str,
    note: Option<String>,
    frames: Vec<Value>,
    saved: Vec<Value>,
    /// Grabs taken.
    count: u64,
    /// Frames Windows composed that were folded into a later grab and never seen on their own.
    unseen: u64,
    max_gap_ms: f64,
    slow_gaps: u64,
    total_ms: f64,
    backdrop: Option<(u8, u8, u8)>,
  }

  #[derive(Default, Clone, Copy, PartialEq)]
  struct Counts {
    background: u32,
    black: u32,
    white: u32,
    other: u32,
    /// Bounding box of everything that is not backdrop, in rect-local pixels.
    x0: i32,
    y0: i32,
    x1: i32,
    y1: i32,
  }

  /// The commonest colour in a grab. The backdrop is most of what is filmed, so
  /// this is the backdrop as the screen really shows it, which is not always
  /// pure magenta: a dimming layer over the desktop or a colour-managed display
  /// changes it.
  fn commonest_colour(pixels: &[u32]) -> (u8, u8, u8) {
    let mut tally: std::collections::HashMap<u32, u32> = std::collections::HashMap::new();
    for px in pixels.iter().step_by(7) {
      *tally.entry(px & 0x00ff_ffff).or_default() += 1;
    }
    let px = tally.into_iter().max_by_key(|(_, n)| *n).map(|(px, _)| px).unwrap_or(0);
    (((px >> 16) & 0xff) as u8, ((px >> 8) & 0xff) as u8, (px & 0xff) as u8)
  }

  /// Has to finish well inside one frame (8 ms at 120 Hz) for a two-megapixel
  /// strip, so the common case, a pixel that is exactly the backdrop colour, is
  /// a single comparison.
  fn classify(pixels: &[u32], width: i32, backdrop: (u8, u8, u8)) -> Counts {
    let (br, bg, bb) = backdrop;
    let exact = (u32::from(br) << 16) | (u32::from(bg) << 8) | u32::from(bb);
    let mut c = Counts { x0: i32::MAX, y0: i32::MAX, x1: -1, y1: -1, ..Default::default() };
    for (y, row) in pixels.chunks_exact(width as usize).enumerate() {
      let mut first = -1i32;
      let mut last = -1i32;
      for (x, &px) in row.iter().enumerate() {
        if px & 0x00ff_ffff == exact {
          continue;
        }
        let b = (px & 0xff) as u8;
        let g = ((px >> 8) & 0xff) as u8;
        let r = ((px >> 16) & 0xff) as u8;
        if r.abs_diff(br) <= 6 && g.abs_diff(bg) <= 6 && b.abs_diff(bb) <= 6 {
          continue;
        }
        if r <= 10 && g <= 10 && b <= 10 {
          c.black += 1;
        } else if r >= 246 && g >= 246 && b >= 246 {
          c.white += 1;
        } else {
          c.other += 1;
        }
        if first < 0 {
          first = x as i32;
        }
        last = x as i32;
      }
      if first >= 0 {
        c.x0 = c.x0.min(first);
        c.x1 = c.x1.max(last);
        c.y0 = c.y0.min(y as i32);
        c.y1 = c.y1.max(y as i32);
      }
    }
    c.background = pixels.len() as u32 - c.black - c.white - c.other;
    c
  }

  fn write_bmp(path: &std::path::Path, pixels: &[u32], w: i32, h: i32) -> std::io::Result<()> {
    let data_len = (w * h * 4) as u32;
    let mut out = Vec::with_capacity(54 + data_len as usize);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&(54 + data_len).to_le_bytes());
    out.extend_from_slice(&[0; 4]);
    out.extend_from_slice(&54u32.to_le_bytes());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&(-h).to_le_bytes()); // negative height: rows run top to bottom
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&[0; 24]);
    for px in pixels {
      out.extend_from_slice(&(px | 0xff00_0000).to_le_bytes());
    }
    std::fs::write(path, out)
  }

  /// Turns grabs into the log: every distinct picture with the time it was first
  /// seen, plus an image file for the first sight of every distinct *shape* (the
  /// bounding box of what is not backdrop) and for any block of black or white.
  /// A steady view produces a handful of shapes; a glitch is an extra, short-lived one.
  struct Recorder {
    dir: PathBuf,
    prefix: String,
    result: CaptureResult,
    last_counts: Vec<Option<Counts>>,
    seen_shapes: Vec<HashSet<(i32, i32, i32, i32)>>,
    last_grab_at: f64,
    started: f64,
    saved_shapes: u32,
    saved_flashes: u32,
    /// Images to write once filming is over. Writing a file takes longer than a frame.
    to_write: Vec<(PathBuf, Vec<u32>, i32, i32)>,
    /// The backdrop colour as measured in the first grab.
    backdrop: Option<(u8, u8, u8)>,
  }

  impl Recorder {
    fn new(rects: usize, dir: PathBuf, prefix: String, method: &'static str) -> Self {
      let now = now_ms();
      Recorder {
        dir,
        prefix,
        result: CaptureResult { method, ..Default::default() },
        last_counts: vec![None; rects],
        seen_shapes: vec![HashSet::new(); rects],
        last_grab_at: now,
        started: now,
        saved_shapes: 0,
        saved_flashes: 0,
        to_write: Vec::new(),
        backdrop: None,
      }
    }

    /// `images[i]` is rect i as (pixels, width, height). `unseen` is how many
    /// composed frames were folded into this grab without being seen separately.
    fn record(&mut self, taken_at: f64, cost_ms: f64, images: &[(&[u32], i32, i32)], unseen: u64) {
      let blank = BLANK.load(Ordering::SeqCst);
      let mut changed = false;
      let mut row = Vec::with_capacity(images.len());
      let backdrop = *self.backdrop.get_or_insert_with(|| commonest_colour(images[0].0));
      for (i, (pixels, w, h)) in images.iter().enumerate() {
        let c = classify(pixels, *w, backdrop);
        let flash = c.black > 60 || c.white > 60;
        let new_shape = c.x1 >= 0 && self.seen_shapes[i].insert((c.x0, c.y0, c.x1, c.y1));
        if (flash && !new_shape && self.saved_flashes < 4) || (new_shape && self.saved_shapes < 40) {
          let kind = if new_shape { "shape" } else { "flash" };
          let file = self.dir.join(format!("{}-{kind}-{:09.1}-r{i}.bmp", self.prefix, taken_at));
          self
            .result
            .saved
            .push(json!({ "t": taken_at, "rect": i, "kind": kind, "blank": blank, "file": file.to_string_lossy() }));
          self.to_write.push((file, pixels.to_vec(), *w, *h));
          if new_shape {
            self.saved_shapes += 1;
          } else {
            self.saved_flashes += 1;
          }
        }
        if self.last_counts[i] != Some(c) {
          changed = true;
          self.last_counts[i] = Some(c);
        }
        let bbox = if c.x1 >= 0 { json!([c.x0, c.y0, c.x1, c.y1]) } else { Value::Null };
        row.push(json!({ "black": c.black, "white": c.white, "other": c.other, "bbox": bbox }));
      }
      self.result.count += 1;
      self.result.unseen += unseen;
      let gap = taken_at - self.last_grab_at;
      self.result.max_gap_ms = self.result.max_gap_ms.max(gap);
      if gap > 8.4 {
        self.result.slow_gaps += 1; // longer than one refresh at 120 Hz
      }
      self.last_grab_at = taken_at;
      // Keep the log small: only grabs where the picture changed, or where a frame went unseen.
      if changed || unseen > 0 {
        self
          .result
          .frames
          .push(json!({ "t": taken_at, "cost": cost_ms, "gap": gap, "unseen": unseen, "blank": blank, "rects": row }));
      }
    }

    fn finish(mut self) -> CaptureResult {
      self.result.total_ms = now_ms() - self.started;
      self.result.backdrop = self.backdrop;
      for (file, pixels, w, h) in self.to_write.drain(..) {
        let _ = write_bmp(&file, &pixels, w, h);
      }
      self.result
    }
  }

  pub fn capture_start(rects: Value, name: Option<String>) -> Result<Value, String> {
    let rects: Vec<Rect> = serde_json::from_value(rects).map_err(|e| e.to_string())?;
    if rects.is_empty() || rects.iter().any(|r| r.w <= 0 || r.h <= 0) {
      return Err("need at least one non-empty rectangle".into());
    }
    let mut slot = CAPTURE.lock().unwrap();
    if slot.is_some() {
      return Err("a capture is already running".into());
    }
    let stop = Arc::new(AtomicBool::new(false));
    let stop_flag = Arc::clone(&stop);
    let dir = out_dir();
    let prefix = name.unwrap_or_else(|| "capture".into());
    let force_gdi = std::env::var("DOOZER_SPIKE_GDI").as_deref() == Ok("1");
    MARKS.lock().unwrap().clear();
    // Setting up takes a few hundred milliseconds. Do not return until the first
    // grab has been taken, or the start of the test would go unfilmed.
    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<()>();
    let thread = std::thread::Builder::new()
      .name("doozer-spike-capture".into())
      .spawn(move || unsafe {
        if rects.len() == 1 && !force_gdi {
          match duplication_loop(rects[0], &stop_flag, dir.clone(), prefix.clone(), &ready_tx) {
            Ok(result) => return result,
            Err(why) => {
              let mut result = gdi_loop(rects, &stop_flag, dir, prefix, &ready_tx);
              result.note = Some(format!("desktop duplication was not available ({why}); fell back to GDI"));
              return result;
            }
          }
        }
        gdi_loop(rects, &stop_flag, dir, prefix, &ready_tx)
      })
      .map_err(|e| e.to_string())?;
    *slot = Some(Capture { stop, thread });
    let filming = ready_rx.recv_timeout(Duration::from_secs(5)).is_ok();
    Ok(json!({ "started": now_ms(), "filming": filming }))
  }

  /// Film one rectangle through Desktop Duplication: one grab per composed frame.
  unsafe fn duplication_loop(
    rect: Rect,
    stop: &AtomicBool,
    dir: PathBuf,
    prefix: String,
    ready: &std::sync::mpsc::Sender<()>,
  ) -> Result<CaptureResult, String> {
    unsafe {
      let text = |e: windows::core::Error| e.to_string();
      let mut device: Option<ID3D11Device> = None;
      let mut context: Option<ID3D11DeviceContext> = None;
      D3D11CreateDevice(
        None,
        D3D_DRIVER_TYPE_HARDWARE,
        HMODULE::default(),
        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
        None,
        D3D11_SDK_VERSION,
        Some(&mut device),
        None,
        Some(&mut context),
      )
      .map_err(text)?;
      let (device, context) = (device.ok_or("no device")?, context.ok_or("no device context")?);
      let adapter = device.cast::<IDXGIDevice>().map_err(text)?.GetAdapter().map_err(text)?;

      // The output (monitor) that contains the rectangle.
      let mut found = None;
      let mut index = 0;
      while let Ok(output) = adapter.EnumOutputs(index) {
        index += 1;
        let Ok(desc) = output.GetDesc() else { continue };
        let d = desc.DesktopCoordinates;
        if rect.x >= d.left && rect.y >= d.top && rect.right() <= d.right && rect.bottom() <= d.bottom {
          found = Some((output, d));
          break;
        }
      }
      let (output, desktop) = found.ok_or("the rectangle is not inside one monitor of the default adapter")?;
      let duplication = output.cast::<IDXGIOutput1>().map_err(text)?.DuplicateOutput(&device).map_err(text)?;

      // A CPU-readable texture the size of the rectangle.
      let description = D3D11_TEXTURE2D_DESC {
        Width: rect.w as u32,
        Height: rect.h as u32,
        MipLevels: 1,
        ArraySize: 1,
        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
        Usage: D3D11_USAGE_STAGING,
        BindFlags: 0,
        CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
        MiscFlags: 0,
      };
      let mut staging: Option<ID3D11Texture2D> = None;
      device.CreateTexture2D(&description, None, Some(&mut staging)).map_err(text)?;
      let staging = staging.ok_or("no staging texture")?;
      let source_box = D3D11_BOX {
        left: (rect.x - desktop.left) as u32,
        top: (rect.y - desktop.top) as u32,
        front: 0,
        right: (rect.right() - desktop.left) as u32,
        bottom: (rect.bottom() - desktop.top) as u32,
        back: 1,
      };

      let mut recorder = Recorder::new(1, dir, prefix, "desktop duplication");
      let mut pixels = vec![0u32; (rect.w * rect.h) as usize];
      while !stop.load(Ordering::SeqCst) {
        let mut info = DXGI_OUTDUPL_FRAME_INFO::default();
        let mut resource: Option<IDXGIResource> = None;
        match duplication.AcquireNextFrame(50, &mut info, &mut resource) {
          Ok(()) => {}
          Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => continue, // nothing on screen changed
          Err(e) => {
            recorder.result.note = Some(format!("filming stopped early: {e}"));
            break;
          }
        }
        let taken_at = now_ms();
        // LastPresentTime is zero when only the mouse pointer moved.
        if info.LastPresentTime != 0
          && let Some(texture) = resource.as_ref().and_then(|r| r.cast::<ID3D11Texture2D>().ok())
        {
          context.CopySubresourceRegion(&staging, 0, 0, 0, 0, &texture, 0, Some(&source_box));
          let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
          if context.Map(&staging, 0, D3D11_MAP_READ, 0, Some(&mut mapped)).is_ok() {
            let width = rect.w as usize;
            for y in 0..rect.h as usize {
              let row = (mapped.pData as *const u8).add(y * mapped.RowPitch as usize) as *const u32;
              std::ptr::copy_nonoverlapping(row, pixels.as_mut_ptr().add(y * width), width);
            }
            context.Unmap(&staging, 0);
            // Frames that piled up before the very first grab are not "unseen": filming had not begun.
            let first = recorder.result.count == 0;
            let unseen = if first { 0 } else { u64::from(info.AccumulatedFrames.saturating_sub(1)) };
            recorder.record(taken_at, now_ms() - taken_at, &[(&pixels, rect.w, rect.h)], unseen);
            if first {
              let _ = ready.send(());
            }
          }
        }
        drop(resource);
        let _ = duplication.ReleaseFrame();
      }
      Ok(recorder.finish())
    }
  }

  /// Film by copying the rectangles from the screen with GDI, over and over.
  unsafe fn gdi_loop(
    rects: Vec<Rect>,
    stop: &AtomicBool,
    dir: PathBuf,
    prefix: String,
    ready: &std::sync::mpsc::Sender<()>,
  ) -> CaptureResult {
    unsafe {
      struct Surface {
        rect: Rect,
        bitmap: HBITMAP,
        bits: *mut u32,
      }
      let screen: HDC = GetDC(None);
      let mem = CreateCompatibleDC(Some(screen));
      let mut surfaces = Vec::new();
      for rect in &rects {
        let info = BITMAPINFO {
          bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: rect.w,
            biHeight: -rect.h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
          },
          ..Default::default()
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let Ok(bitmap) = CreateDIBSection(Some(screen), &info, DIB_RGB_COLORS, &mut bits, None, 0) else { continue };
        surfaces.push(Surface { rect: *rect, bitmap, bits: bits as *mut u32 });
      }
      let mut recorder = Recorder::new(surfaces.len(), dir, prefix, "GDI screen copy");
      while !stop.load(Ordering::SeqCst) {
        let t0 = now_ms();
        for s in &surfaces {
          SelectObject(mem, s.bitmap.into());
          let _ = BitBlt(mem, 0, 0, s.rect.w, s.rect.h, Some(screen), s.rect.x, s.rect.y, SRCCOPY);
        }
        let cost = now_ms() - t0;
        let images: Vec<(&[u32], i32, i32)> = surfaces
          .iter()
          .map(|s| (std::slice::from_raw_parts(s.bits, (s.rect.w * s.rect.h) as usize), s.rect.w, s.rect.h))
          .collect();
        recorder.record(t0, cost, &images, 0);
        let _ = ready.send(());
      }
      for s in surfaces {
        let _ = DeleteObject(s.bitmap.into());
      }
      let _ = DeleteDC(mem);
      ReleaseDC(None, screen);
      recorder.finish()
    }
  }

  pub fn capture_stop() -> Result<Value, String> {
    let capture = CAPTURE.lock().unwrap().take().ok_or("no capture is running")?;
    capture.stop.store(true, Ordering::SeqCst);
    let result = capture.thread.join().map_err(|_| "the capture thread panicked")?;
    let marks: Vec<Value> =
      MARKS.lock().unwrap().drain(..).map(|(t, label)| json!({ "t": t, "label": label })).collect();
    let fps = if result.total_ms > 0.0 { result.count as f64 * 1000.0 / result.total_ms } else { 0.0 };
    Ok(json!({
      "method": result.method,
      "note": result.note,
      "backdropAsFilmed": result.backdrop.map(|(r, g, b)| json!([r, g, b])),
      "frameCount": result.count,
      "unseenFrames": result.unseen,
      "durationMs": result.total_ms,
      "framesPerSecond": fps,
      "longestGapMs": result.max_gap_ms,
      "gapsOver8ms": result.slow_gaps,
      "frames": result.frames,
      "saved": result.saved,
      "marks": marks,
    }))
  }
}
