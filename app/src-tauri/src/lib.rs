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

  /// The content security policy of the page (tauri.conf.json, `app.security.csp`; why each
  /// line is there is in docs/release.md). This fails if the policy is taken out, or if
  /// anything is allowed that is not in the table below. Making it stricter passes.
  ///
  /// `style-src-attr 'unsafe-inline'` is the one concession: the rig and the Radial write
  /// their pivots as `style="--px:..."` in markup. It allows a style *attribute* and nothing
  /// else: no inline script, no inline style sheet, no script from a string.
  #[test]
  fn the_content_security_policy_is_there_and_has_not_been_loosened() {
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let security = &config["app"]["security"];
    let csp = security["csp"].as_object().expect("app.security.csp must be set, as a table of directives");
    assert!(security.get("dangerousDisableAssetCspModification").is_none_or(|v| v == false));

    // Everything a directive may contain. A directive that is not here may not be there at all.
    let allowed: &[(&str, &[&str])] = &[
      ("default-src", &["'none'"]),
      ("script-src", &["'self'"]),
      ("style-src", &["'self'"]),
      ("style-src-attr", &["'unsafe-inline'"]),
      ("img-src", &["'self'"]),
      ("font-src", &["'self'"]),
      ("connect-src", &["'self'", "ipc:", "http://ipc.localhost"]),
      ("frame-src", &["'self'"]),
      ("frame-ancestors", &["'self'"]),
      ("base-uri", &["'none'"]),
      ("form-action", &["'none'"]),
    ];
    for (directive, value) in csp {
      let Some((_, may)) = allowed.iter().find(|(name, _)| name == directive) else {
        panic!("{directive} is not a directive this policy is known to need");
      };
      let sources = value.as_str().map(str::to_owned).unwrap_or_else(|| {
        value.as_array().expect("a directive is a string or a list").iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>().join(" ")
      });
      for source in sources.split_whitespace() {
        assert!(source == "'none'" || may.contains(&source), "{directive} allows {source}");
      }
    }
    // What is not said falls back to this, so this is what makes the rest a whitelist.
    assert_eq!(csp["default-src"], "'none'");
    // And the three things a policy is for, said outright: no script but the app's own
    // files, nothing fetched from anywhere but the app and its own shell.
    let all = serde_json::to_string(csp).unwrap();
    for never in ["unsafe-eval", "wasm-unsafe-eval", "*", "https:", "data:", "blob:"] {
      assert!(!all.contains(never), "the policy mentions {never}");
    }
    assert!(!csp.get("script-src").and_then(|v| v.as_str()).unwrap_or("").contains("unsafe-inline"));
  }

  /// One version, written in three places (the installer and "Installed apps" read
  /// tauri.conf.json, the executable's properties Cargo.toml, the page package.json).
  #[test]
  fn the_version_is_the_same_everywhere() {
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    let page: serde_json::Value = serde_json::from_str(include_str!("../../package.json")).unwrap();
    assert_eq!(config["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(page["version"], env!("CARGO_PKG_VERSION"));
  }

  /// Tauri's uninstaller removes the value named after the product from the user's Run key
  /// (`DeleteRegValue HKCU "...\Run" "${PRODUCTNAME}"` in its installer script). That is
  /// what takes "Start with Windows" away on uninstall, so the name the app writes and the
  /// product's name must stay the same.
  #[test]
  fn the_uninstaller_clears_the_start_up_entry_the_app_writes() {
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(config["productName"], autostart::VALUE_NAME);
    assert_eq!(autostart::RUN_KEY, r"Software\Microsoft\Windows\CurrentVersion\Run");
  }

  /// Doozer's own addition to the uninstaller clears the browser's folder, named by the
  /// identifier, and never names the save's.
  #[test]
  fn the_uninstall_hook_never_touches_the_save() {
    let hooks: String =
      include_str!("../installer/hooks.nsh").lines().filter(|line| !line.trim_start().starts_with(';')).collect::<Vec<_>>().join("\n");
    assert!(hooks.contains(r#"RMDir /r "$LOCALAPPDATA\${BUNDLEID}""#));
    assert!(!hooks.contains("$APPDATA"));
    assert_eq!(hooks.matches("RMDir").count(), 1);
    // Nothing is deleted from disk but that folder, and no registry *value* at all.
    assert!(!hooks.contains("Delete ") && !hooks.contains("DeleteRegValue"));
  }

  /// The hook also removes the key where the installer notes its folder
  /// (`HKCU\Software\Doozer\Doozer`), which Tauri keeps unless the save is deleted and which
  /// 1.0.0 therefore left behind on every ordinary uninstall; and its parent, only if empty.
  /// Everything the hook does is inside one "not on the way to an update" test.
  #[test]
  fn the_uninstall_hook_removes_the_install_path_key_and_never_during_an_update() {
    let hooks: String =
      include_str!("../installer/hooks.nsh").lines().filter(|line| !line.trim_start().starts_with(';')).collect::<Vec<_>>().join("\n");
    let key = r#"DeleteRegKey SHCTX "${MANUPRODUCTKEY}""#;
    let parent = r#"DeleteRegKey /ifempty SHCTX "${MANUKEY}""#;
    assert!(hooks.contains(key) && hooks.contains(parent));
    // The parent is only ever removed empty: other things may live under the manufacturer's name.
    for line in hooks.lines().filter(|line| line.contains("${MANUKEY}\"")) {
      assert!(line.contains("/ifempty"), "{line}");
    }
    // One guard, and every removal between its two ends.
    assert_eq!(hooks.matches("${If} $UpdateMode <> 1").count(), 1);
    assert_eq!(hooks.matches("${EndIf}").count(), 1);
    let (from, to) = (hooks.find("${If} $UpdateMode <> 1").unwrap(), hooks.find("${EndIf}").unwrap());
    for (at, _) in hooks.match_indices("DeleteRegKey").chain(hooks.match_indices("RMDir")) {
      assert!(from < at && at < to, "something is removed outside the guard");
    }
    // The names are the installer's own (its script defines them from these), so the key
    // is the one named in the hook's comment and in docs/release.md.
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(config["bundle"]["publisher"], "Doozer");
    assert_eq!(config["productName"], "Doozer");
  }

  /// The installer's wording is Doozer's own where Tauri's would say "kill" of a pet that
  /// never dies, or leave the user guessing what "application data" is.
  #[test]
  fn the_installer_speaks_of_the_save_and_never_of_killing() {
    let config: serde_json::Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(config["bundle"]["windows"]["nsis"]["customLanguageFiles"]["English"], "installer/English.nsh");
    // Each line is `LangString <name> ${LANG_ENGLISH} "<what is shown>"`. Tauri's names
    // for the strings say "Kill" and cannot be changed; what is shown must not.
    let shown: Vec<(&str, &str)> = include_str!("../installer/English.nsh")
      .lines()
      .filter_map(|line| {
        let mut parts = line.trim_start_matches('\u{feff}').splitn(4, ' ');
        (parts.next() == Some("LangString")).then(|| (parts.next().unwrap_or(""), parts.nth(1).unwrap_or("")))
      })
      .collect();
    assert!(shown.len() > 20, "the file should carry every string of Tauri's own");
    for (name, text) in &shown {
      assert!(!text.to_lowercase().contains("kill"), "{name} says: {text}");
    }
    let tick_box = shown.iter().find(|(name, _)| *name == "deleteAppData").expect("the tick box has a label").1;
    assert!(tick_box.contains("save"));
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
