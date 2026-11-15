//! Doozer's native shell: one transparent window showing one page
//! (WORK_PLAN.md section 3, "The single-window rule").
//!
//! * `mode`  — window shapes and where they go on a monitor (pure)
//! * `hit`   — hit regions and the catch / let-through rule (pure)
//! * `save`  — the atomic save file (pure)
//! * `win`   — the Win32 calls
//! * `shell` — the window's state and the cursor tracker thread
//! * `tray`  — tray icon and native menu
//! * `autostart` — "Start with Windows"
//! * `hotkey` — the one keyboard shortcut, which opens the Card
//! * `webview` — asking the browser to hold less memory
//! * `spike` — test hooks for the Phase 3 spike (`--features spike` only)

#[cfg(not(windows))]
compile_error!("Doozer's shell is Windows-only in v1 (DESIGN_SPEC.md section 11).");

mod autostart;
mod hit;
mod hotkey;
mod mode;
pub mod save;
mod shell;
mod spike;
mod tray;
mod webview;
mod win;

use hit::Region;
use mode::WindowMode;
use shell::{Shell, Status, WindowInfo};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, WebviewWindow, WebviewWindowBuilder};

type ShellState<'a> = State<'a, Arc<Shell>>;

/// The app's identifier. **Settled on 2026-11-13: it stays.** It is the name of the
/// folder the save lives in (`%APPDATA%\com.doozer.desktop\`), so changing it would
/// leave every existing pet behind. It must equal `identifier` in tauri.conf.json,
/// which is where Tauri reads it from; a test below keeps the two together.
pub const APP_ID: &str = "com.doozer.desktop";

/// Where the window waits between being created and the page choosing a view.
const STARTUP_MODE: WindowMode =
  WindowMode::Docked { width: 214.0, height: 54.0, anchor: mode::Anchor::TopCenter, margin: 0.0 };

fn save_dir(app: &AppHandle) -> Result<PathBuf, String> {
  // Test runs point this at a scratch folder.
  if let Ok(dir) = std::env::var("DOOZER_SAVE_DIR") {
    return Ok(PathBuf::from(dir));
  }
  let dir = app.path().app_data_dir().map_err(|e| format!("no app-data folder: {e}"))?;
  // A development build keeps its own pet, so working on the app never touches
  // the one the owner is looking after.
  Ok(if cfg!(debug_assertions) { dir.join("dev") } else { dir })
}

/// The name that makes Doozer one-per-save: two copies writing the same save
/// would overwrite each other. A copy pointed at another save folder is a
/// different Doozer and may run alongside.
fn instance_name() -> String {
  let mut name = format!("Local\\{APP_ID}");
  if cfg!(debug_assertions) {
    name.push_str(".dev");
  }
  if let Ok(dir) = std::env::var("DOOZER_SAVE_DIR") {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    dir.to_lowercase().hash(&mut hasher);
    name.push_str(&format!(".{:016x}", hasher.finish()));
  }
  name
}

/// The Run key to use, and whether this build may be registered at all.
fn autostart_key() -> Result<String, String> {
  // Tests point this at a scratch key so the real one is never written.
  if let Ok(key) = std::env::var("DOOZER_AUTOSTART_KEY") {
    return Ok(key);
  }
  if cfg!(debug_assertions) {
    return Err("a development build is not registered to start with Windows".into());
  }
  Ok(autostart::RUN_KEY.to_string())
}

// ---- Commands (the page calls these through app/src/shell.ts) ------------------

/// Change the window's shape. Resolves once the window has its new bounds.
#[tauri::command(async)]
fn set_window_mode(
  shell: ShellState<'_>,
  app: AppHandle,
  mode: WindowMode,
  view: Option<String>,
) -> Result<WindowInfo, String> {
  let info = shell.on_ui_thread(move |shell| shell.apply_mode(mode, view, false))??;
  if let Some(menu) = app.try_state::<tray::TrayMenu>() {
    menu.mark(info.view.as_deref());
  }
  Ok(info)
}

#[tauri::command]
fn window_info(shell: ShellState<'_>) -> Option<WindowInfo> {
  shell.window_info()
}

/// Replace the areas of the page that catch the mouse. Everything else is click-through.
#[tauri::command]
fn set_hit_regions(shell: ShellState<'_>, regions: Vec<Region>) -> Result<usize, String> {
  shell.set_regions(regions)
}

/// The page is alive. Returns true if the shell dropped the regions and needs them again.
#[tauri::command]
fn heartbeat(shell: ShellState<'_>) -> bool {
  shell.heartbeat()
}

/// Start dragging the window from the point (x, y) of the viewport, in CSS pixels.
#[tauri::command]
fn begin_drag(shell: ShellState<'_>, x: f64, y: f64) -> bool {
  shell.begin_drag(x, y)
}

#[tauri::command(async)]
fn set_focusable(shell: ShellState<'_>, focusable: bool) -> Result<(), String> {
  shell.on_ui_thread(move |shell| shell.set_focusable(focusable))
}

#[tauri::command(async)]
fn set_window_visible(shell: ShellState<'_>, visible: bool) -> Result<(), String> {
  shell.on_ui_thread(move |shell| shell.set_visible(visible))
}

#[tauri::command(async)]
fn set_always_on_top(shell: ShellState<'_>, on_top: bool) -> Result<(), String> {
  shell.on_ui_thread(move |shell| shell.set_topmost(on_top))
}

/// Is a fullscreen app (game, video, presentation) in front right now?
/// Changes arrive as the `shell://fullscreen-changed` event.
#[tauri::command]
fn fullscreen_in_front() -> bool {
  win::fullscreen_app_in_front()
}

#[tauri::command]
fn shell_status(shell: ShellState<'_>) -> Status {
  shell.status()
}

#[tauri::command(async)]
fn load_save(app: AppHandle) -> Result<save::Loaded, String> {
  Ok(save::load(&save_dir(&app)?))
}

#[tauri::command(async)]
fn write_save(app: AppHandle, json: String) -> Result<(), String> {
  save::save(&save_dir(&app)?, &json)
}

/// Pop up the native menu (the four views, Settings, Quit) at the cursor.
///
/// A popup menu only closes on a click elsewhere if its window has the keyboard
/// focus, so the menu library takes it for as long as the menu is up. Doozer
/// must not keep it: when the menu closes, focus goes back to whoever had it.
#[tauri::command(async)]
fn show_menu(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
  let handle = app.clone();
  app
    .run_on_main_thread(move || {
      if let Some(menu) = handle.try_state::<tray::TrayMenu>() {
        let before = win::foreground_window();
        let ours = window.hwnd().map(|h| win::Hwnd::from_raw(h).0).unwrap_or(0);
        // Returns once the menu has closed.
        let _ = window.popup_menu(&menu.menu);
        if before != 0 && before != ours && win::foreground_window() == ours {
          win::set_foreground(win::Hwnd(before));
        }
      }
    })
    .map_err(|e| e.to_string())
}

/// Which views exist. The rest stay in the menu, greyed out, as "coming soon".
#[tauri::command(async)]
fn set_available_views(app: AppHandle, views: Vec<String>) -> Result<(), String> {
  let handle = app.clone();
  app
    .run_on_main_thread(move || {
      if let Some(menu) = handle.try_state::<tray::TrayMenu>() {
        menu.set_available(&views);
      }
    })
    .map_err(|e| e.to_string())
}

/// Is this copy of Doozer registered to start when the user signs in?
#[tauri::command]
fn autostart_enabled() -> bool {
  match (autostart_key(), std::env::current_exe()) {
    (Ok(key), Ok(exe)) => autostart::is_registered(&key, autostart::VALUE_NAME, &exe),
    _ => false,
  }
}

/// Register or unregister this copy of Doozer to start with Windows. Returns
/// what is now true. Registering again after the app has moved fixes the path.
#[tauri::command(async)]
fn set_autostart(enabled: bool) -> Result<bool, String> {
  let key = autostart_key()?;
  let exe = std::env::current_exe().map_err(|e| format!("cannot find the running program: {e}"))?;
  let command = autostart::command_for(&exe);
  autostart::write(&key, autostart::VALUE_NAME, enabled.then_some(command.as_str()))?;
  Ok(autostart::is_registered(&key, autostart::VALUE_NAME, &exe))
}

/// The "Interface size" setting: draw everything `scale` times its usual size. The page
/// is zoomed in the browser and the shell's own arithmetic follows (`win::scale_of`); the
/// page then asks for its window again, which comes out that much larger. Returns the
/// scale that was set.
#[tauri::command(async)]
fn set_ui_scale(window: WebviewWindow, scale: f64) -> Result<f64, String> {
  let zoom = win::clamp_ui_zoom(scale);
  window.set_zoom(zoom).map_err(|e| e.to_string())?;
  Ok(win::set_ui_zoom(zoom))
}

/// Ask the browser to hold as little memory as it can (`low`), or to carry on as normal.
/// The page asks for this when Doozer is tucked away, and for a moment after a view that
/// used a lot (the Island) has been left.
#[tauri::command]
fn set_low_memory(window: WebviewWindow, low: bool) -> Result<(), String> {
  webview::set_low_memory(&window, low)
}

/// The page has finished saving (or the user quit from the page): leave now.
#[tauri::command]
fn quit(app: AppHandle) {
  app.exit(0);
}

// ---- Startup -------------------------------------------------------------------

pub fn run() {
  // One Doozer per save. A second copy simply leaves; the first is already there.
  if !spike::allow_many_instances() && !win::claim_single_instance(&instance_name()) {
    return;
  }
  tauri::Builder::default()
    .on_menu_event(tray::on_menu_event)
    .invoke_handler(tauri::generate_handler![
      set_window_mode,
      window_info,
      set_hit_regions,
      heartbeat,
      begin_drag,
      set_focusable,
      set_window_visible,
      set_always_on_top,
      shell_status,
      fullscreen_in_front,
      load_save,
      write_save,
      show_menu,
      set_available_views,
      autostart_enabled,
      set_autostart,
      set_low_memory,
      set_ui_scale,
      quit,
      spike::spike_config,
      spike::spike_inject,
      spike::spike_probe,
      spike::spike_real_input,
      spike::spike_backdrop,
      spike::spike_capture_start,
      spike::spike_capture_stop,
      spike::spike_mark,
      spike::spike_clobber_style,
      spike::spike_menu,
      spike::spike_shortcut,
      spike::spike_autostart_is_scratch,
      spike::spike_look,
      spike::spike_report,
    ])
    .setup(|app| {
      let handle = app.handle().clone();

      // Leftovers from a run that was killed mid-save.
      if let Ok(dir) = save_dir(&handle) {
        save::sweep_temp_files(&dir);
      }

      // The window is declared in tauri.conf.json with "create": false, so it
      // can be built here and handed straight to the shell.
      let mut config = app.config().app.windows.first().cloned().ok_or("tauri.conf.json declares no window")?;
      spike::adjust_window_config(&mut config);
      let window = WebviewWindowBuilder::from_config(&handle, &config)?.build()?;
      let hwnd = win::Hwnd::from_raw(window.hwnd()?);

      let shell = Shell::new(handle.clone(), hwnd, spike::layered_always());
      // Click-through, tool-window and no-activate styles, before the first frame.
      shell.adopt_window();
      // Windows puts a new window wherever it likes. Park it where the pill
      // docks until the page says which view to open; it is empty, transparent
      // and click-through until then, so nothing shows.
      let _ = shell.apply_mode(STARTUP_MODE, None, false);
      app.manage(Arc::clone(&shell));

      let menu = tray::build(&handle)?;
      app.manage(menu);

      // Test runs do not listen for the shortcut: several run at once, cloaked, on a
      // machine somebody is using, and none of them may take the keyboard from that person.
      if !spike::allow_many_instances() {
        hotkey::spawn(handle.clone(), Arc::clone(&shell));
      }
      shell::spawn_tracker(shell);
      spike::start(&handle);
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running Doozer");
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The identifier decides the save folder. If this fails, someone changed it in one
  /// place: put it back, or every pet saved so far is left behind in the old folder.
  #[test]
  fn the_identifier_is_the_settled_one_in_both_places() {
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(config["identifier"], APP_ID);
    assert_eq!(APP_ID, "com.doozer.desktop");
  }

  #[test]
  fn the_interface_size_is_kept_within_reason() {
    assert_eq!(win::clamp_ui_zoom(1.0), 1.0);
    assert_eq!(win::clamp_ui_zoom(1.3), 1.3);
    assert_eq!(win::clamp_ui_zoom(9.0), win::UI_ZOOM_RANGE.1);
    assert_eq!(win::clamp_ui_zoom(0.1), win::UI_ZOOM_RANGE.0);
    // Nonsense is no zoom at all, never a window of no size or of endless size.
    for bad in [0.0, -2.0, f64::NAN, f64::INFINITY] {
      assert_eq!(win::clamp_ui_zoom(bad), 1.0);
    }
  }

  #[test]
  fn one_copy_per_save_is_named_after_the_identifier() {
    assert!(instance_name().starts_with(r"Local\com.doozer.desktop"));
  }
}
