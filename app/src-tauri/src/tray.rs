//! The tray icon and the one native menu (also shown on right-click).
//!
//! The menu never changes the view itself. Changing view means unmounting one
//! page module and mounting another, which only the page can do, so a view item
//! just asks the page to switch. Quit is the exception: it is handled here, so
//! it works even if the page is hung. The page is told first and given a moment
//! to write its save (`QUIT_GRACE`); it answers by calling the `quit` command.

use crate::shell::Shell;
use std::sync::Arc;
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

/// The four homes, in menu order: id, label.
pub const VIEWS: [(&str, &str); 4] = [("pill", "Pill"), ("room", "Room"), ("island", "Island"), ("desktop", "Desktop")];

pub const EVENT_VIEW_REQUESTED: &str = "shell://view-requested";
pub const EVENT_SETTINGS_REQUESTED: &str = "shell://settings-requested";
pub const EVENT_QUIT_REQUESTED: &str = "shell://quit-requested";

/// How long the page gets to write its save after Quit is chosen. Quit happens
/// when this runs out whether or not the page has answered.
const QUIT_GRACE: Duration = Duration::from_millis(900);

const VIEW_PREFIX: &str = "view:";
const ID_CARD: &str = "card";
const ID_SETTINGS: &str = "settings";
const ID_QUIT: &str = "quit";

pub struct TrayMenu {
  pub menu: Menu<Wry>,
  views: Vec<(&'static str, CheckMenuItem<Wry>)>,
}

impl TrayMenu {
  /// Tick the item for `current` and untick the rest.
  pub fn mark(&self, current: Option<&str>) {
    for (id, item) in &self.views {
      let _ = item.set_checked(Some(*id) == current);
    }
  }

  /// Views that are not built yet stay in the menu, greyed out and marked.
  pub fn set_available(&self, available: &[String]) {
    for (id, item) in &self.views {
      let on = available.iter().any(|v| v == id);
      let label = VIEWS.iter().find(|(view, _)| view == id).map_or(*id, |(_, label)| *label);
      let _ = item.set_enabled(on);
      let _ = item.set_text(view_label(label, on));
    }
  }

  /// Each view item as the menu shows it: id, text, and whether it can be chosen.
  #[cfg(feature = "spike")]
  pub fn describe(&self) -> Vec<(&'static str, String, bool)> {
    self
      .views
      .iter()
      .map(|(id, item)| (*id, item.text().unwrap_or_default(), item.is_enabled().unwrap_or(false)))
      .collect()
  }

  /// The views whose items are ticked right now (there should be at most one).
  #[cfg(feature = "spike")]
  pub fn ticked(&self) -> Vec<&'static str> {
    self.views.iter().filter(|(_, item)| item.is_checked().unwrap_or(false)).map(|(id, _)| *id).collect()
  }
}

/// The text of a view's menu item.
pub fn view_label(label: &str, available: bool) -> String {
  if available { label.to_string() } else { format!("{label} (coming soon)") }
}

/// Quit, giving the page a moment to save first. Safe to call more than once.
pub fn request_quit(app: &AppHandle) {
  let _ = app.emit(EVENT_QUIT_REQUESTED, ());
  let handle = app.clone();
  std::thread::spawn(move || {
    std::thread::sleep(QUIT_GRACE);
    handle.exit(0);
  });
}

pub fn build(app: &AppHandle) -> tauri::Result<TrayMenu> {
  let mut views = Vec::new();
  for (id, label) in VIEWS {
    views.push((id, CheckMenuItem::with_id(app, format!("{VIEW_PREFIX}{id}"), label, true, false, None::<&str>)?));
  }
  // The shortcut is shown beside the item; it is the shell that listens for it (hotkey.rs).
  let card = MenuItem::with_id(app, ID_CARD, format!("Open Doozer's card\t{}", crate::hotkey::SHORTCUT_LABEL), true, None::<&str>)?;
  let settings = MenuItem::with_id(app, ID_SETTINGS, "Settings…", true, None::<&str>)?;
  let quit = MenuItem::with_id(app, ID_QUIT, "Quit Doozer", true, None::<&str>)?;
  let line_1 = PredefinedMenuItem::separator(app)?;
  let line_2 = PredefinedMenuItem::separator(app)?;

  let menu = Menu::new(app)?;
  for (_, item) in &views {
    menu.append(item)?;
  }
  menu.append_items(&[&line_1, &card, &settings, &line_2, &quit])?;

  let mut tray = TrayIconBuilder::with_id("doozer").tooltip("Doozer").menu(&menu).show_menu_on_left_click(true);
  if let Some(icon) = app.default_window_icon() {
    tray = tray.icon(icon.clone());
  }
  tray.build(app)?;

  Ok(TrayMenu { menu, views })
}

/// Handles clicks from both the tray menu and the right-click menu.
pub fn on_menu_event(app: &AppHandle, event: MenuEvent) {
  let id = event.id().as_ref();
  if id == ID_QUIT {
    request_quit(app);
  } else if id == ID_CARD {
    crate::hotkey::requested_from_menu(app);
  } else if id == ID_SETTINGS {
    let _ = app.emit(EVENT_SETTINGS_REQUESTED, ());
  } else if let Some(view) = id.strip_prefix(VIEW_PREFIX) {
    let _ = app.emit(EVENT_VIEW_REQUESTED, view);
    // Clicking a check item toggles it. The tick must show the view that is
    // really on screen, which only changes once the page has switched.
    if let (Some(menu), Some(shell)) = (app.try_state::<TrayMenu>(), app.try_state::<Arc<Shell>>()) {
      menu.mark(shell.view().as_deref());
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn a_view_that_is_not_built_yet_says_so() {
    assert_eq!(view_label("Pill", true), "Pill");
    assert_eq!(view_label("Room", false), "Room (coming soon)");
  }
}
