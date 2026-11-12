//! Doozer's native shell: one transparent window showing one page
//! (WORK_PLAN.md section 3, "The single-window rule").
//!
//! * `mode`  — window shapes and where they go on a monitor (pure)
//! * `hit`   — hit regions and the catch / let-through rule (pure)
//! * `save`  — the atomic save file (pure)
//! * `win`   — the Win32 calls
//! * `shell` — the window's state and the cursor tracker thread
//! * `tray`  — tray icon and native menu
//! * `spike` — test hooks for the Phase 3 spike (`--features spike` only)

#[cfg(not(windows))]
compile_error!("Doozer's shell is Windows-only in v1 (DESIGN_SPEC.md section 11).");

mod hit;
mod mode;
pub mod save;
mod shell;
mod spike;
mod tray;
mod win;

use hit::Region;
use mode::WindowMode;
use shell::{Shell, Status, WindowInfo};
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State, WebviewWindow, WebviewWindowBuilder};

type ShellState<'a> = State<'a, Arc<Shell>>;

/// Where the window waits between being created and the page choosing a view.
const STARTUP_MODE: WindowMode =
  WindowMode::Docked { width: 214.0, height: 54.0, anchor: mode::Anchor::TopCenter, margin: 0.0 };

fn save_dir(app: &AppHandle) -> Result<PathBuf, String> {
  // The spike's kill test points this at a scratch folder.
  if let Ok(dir) = std::env::var("DOOZER_SAVE_DIR") {
    return Ok(PathBuf::from(dir));
  }
  app.path().app_data_dir().map_err(|e| format!("no app-data folder: {e}"))
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
#[tauri::command(async)]
fn show_menu(app: AppHandle, window: WebviewWindow) -> Result<(), String> {
  let handle = app.clone();
  app
    .run_on_main_thread(move || {
      if let Some(menu) = handle.try_state::<tray::TrayMenu>() {
        let _ = window.popup_menu(&menu.menu);
      }
    })
    .map_err(|e| e.to_string())
}

#[tauri::command]
fn quit(app: AppHandle) {
  app.exit(0);
}

// ---- Startup -------------------------------------------------------------------

pub fn run() {
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

      shell::spawn_tracker(shell);
      spike::start(&handle);
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running Doozer");
}
