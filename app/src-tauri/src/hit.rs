//! Hit regions and the rule that decides when the window catches the mouse.
//!
//! Pure: no Win32 in this file.

use serde::{Deserialize, Serialize};

/// One area of the page that should catch the mouse, in CSS pixels relative to
/// the top-left of the viewport. A rounded rectangle; `r` at least half the
/// shorter side makes it a pill or a circle.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Region {
  pub x: f64,
  pub y: f64,
  pub w: f64,
  pub h: f64,
  #[serde(default)]
  pub r: f64,
}

impl Region {
  /// A region is usable when all its numbers are finite and it has an area.
  pub fn is_valid(&self) -> bool {
    [self.x, self.y, self.w, self.h, self.r].iter().all(|v| v.is_finite()) && self.w > 0.0 && self.h > 0.0
  }

  pub fn contains(&self, px: f64, py: f64) -> bool {
    if px < self.x || py < self.y || px >= self.x + self.w || py >= self.y + self.h {
      return false;
    }
    let r = self.r.max(0.0).min(self.w / 2.0).min(self.h / 2.0);
    if r <= 0.0 {
      return true;
    }
    // Inside the bounding box. Only the four corner squares need the circle test.
    let cx = px.clamp(self.x + r, self.x + self.w - r);
    let cy = py.clamp(self.y + r, self.y + self.h - r);
    let (dx, dy) = (px - cx, py - cy);
    dx * dx + dy * dy <= r * r
  }
}

pub fn any_contains(regions: &[Region], px: f64, py: f64) -> bool {
  regions.iter().any(|r| r.contains(px, py))
}

/// Should the window catch the mouse on this tick?
///
/// * `catching` — what it does now.
/// * `inside` — the cursor is over a hit region.
/// * `button_down` — any mouse button is held.
///
/// While a button is held the state is frozen. A press that started on Doozer
/// keeps going to the page when the cursor strays outside the region (carrying
/// Doozer, dragging a slider), and a drag that started in another application
/// is not hijacked when it passes over Doozer.
pub fn decide(catching: bool, inside: bool, button_down: bool) -> bool {
  if button_down { catching } else { inside }
}

/// Follows a press that belongs to the page, one tick at a time.
///
/// Returns `(holding, released)`. `holding` is true while a button is down on a
/// window that is catching the mouse, which means the press went to the page.
/// `released` is true on the one tick where such a press has ended.
///
/// The page is told about that tick, so a drag it is running always ends, even
/// if the mouse-up itself never reaches it (capture lost, focus taken by
/// something else). A press on another application is none of the page's
/// business, and a drag of the whole window has its own ending.
pub fn hold_step(was_holding: bool, catching: bool, button_down: bool, dragging_window: bool) -> (bool, bool) {
  let released = was_holding && !button_down;
  let holding = catching && button_down && !dragging_window;
  (holding, released)
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn plain_rectangle_includes_its_top_left_and_excludes_its_bottom_right() {
    let r = Region { x: 10.0, y: 20.0, w: 100.0, h: 50.0, r: 0.0 };
    assert!(r.contains(10.0, 20.0));
    assert!(r.contains(109.9, 69.9));
    assert!(!r.contains(110.0, 70.0));
    assert!(!r.contains(9.9, 30.0));
  }

  #[test]
  fn rounded_corners_are_outside() {
    let r = Region { x: 0.0, y: 0.0, w: 100.0, h: 100.0, r: 20.0 };
    assert!(!r.contains(1.0, 1.0));
    assert!(!r.contains(99.0, 99.0));
    assert!(r.contains(20.0, 20.0));
    assert!(!r.contains(5.0, 5.0)); // 15 px from the arc centre on each axis: 21.2 px away
    assert!(r.contains(6.0, 6.0)); // 14 px on each axis: 19.8 px away, inside the 20 px arc
    assert!(r.contains(50.0, 0.5));
  }

  #[test]
  fn an_oversized_radius_makes_a_pill() {
    let pill = Region { x: 0.0, y: 0.0, w: 214.0, h: 54.0, r: 999.0 };
    assert!(pill.contains(107.0, 27.0));
    assert!(pill.contains(1.0, 27.0));
    assert!(!pill.contains(3.0, 3.0));
    assert!(!pill.contains(211.0, 51.0));
  }

  #[test]
  fn a_circle() {
    let c = Region { x: 100.0, y: 100.0, w: 60.0, h: 60.0, r: 30.0 };
    assert!(c.contains(130.0, 130.0));
    assert!(c.contains(130.0, 101.0));
    assert!(!c.contains(104.0, 104.0));
  }

  #[test]
  fn invalid_regions_are_detected() {
    assert!(!Region { x: 0.0, y: 0.0, w: 0.0, h: 10.0, r: 0.0 }.is_valid());
    assert!(!Region { x: f64::NAN, y: 0.0, w: 10.0, h: 10.0, r: 0.0 }.is_valid());
    assert!(!Region { x: 0.0, y: 0.0, w: f64::INFINITY, h: 10.0, r: 0.0 }.is_valid());
    assert!(Region { x: -5.0, y: -5.0, w: 10.0, h: 10.0, r: 0.0 }.is_valid());
  }

  #[test]
  fn regions_deserialise_without_a_radius() {
    let r: Region = serde_json::from_str(r#"{"x":1,"y":2,"w":3,"h":4}"#).unwrap();
    assert_eq!(r, Region { x: 1.0, y: 2.0, w: 3.0, h: 4.0, r: 0.0 });
  }

  #[test]
  fn decide_follows_the_cursor_when_no_button_is_held() {
    assert!(decide(false, true, false));
    assert!(!decide(true, false, false));
    assert!(decide(true, true, false));
    assert!(!decide(false, false, false));
  }

  /// Feed a sequence of (cursor over a region, button down) samples through the
  /// two rules, starting from rest, and collect what happened on each tick.
  fn run(samples: &[(bool, bool)]) -> Vec<(bool, bool)> {
    let (mut catching, mut holding) = (false, false);
    samples
      .iter()
      .map(|&(inside, down)| {
        catching = decide(catching, inside, down);
        let (now_holding, released) = hold_step(holding, catching, down, false);
        holding = now_holding;
        (catching, released)
      })
      .collect()
  }

  #[test]
  fn a_press_on_doozer_is_followed_until_the_button_comes_up_wherever_that_is() {
    // Over Doozer, press, the cursor outruns Doozer for three ticks, release far away, rest.
    let ticks =
      run(&[(true, false), (true, true), (false, true), (false, true), (false, true), (false, false), (false, false)]);
    let catching: Vec<bool> = ticks.iter().map(|t| t.0).collect();
    let released: Vec<bool> = ticks.iter().map(|t| t.1).collect();
    assert_eq!(catching, [true, true, true, true, true, false, false], "caught for as long as the button was down");
    assert_eq!(
      released,
      [false, false, false, false, false, true, false],
      "the page is told once, on the tick the button came up"
    );
  }

  #[test]
  fn a_press_that_starts_elsewhere_is_never_reported_to_the_page() {
    // Beside Doozer, press, drag across Doozer, release on Doozer.
    let ticks = run(&[(false, false), (false, true), (true, true), (true, true), (true, false), (true, false)]);
    assert!(ticks.iter().all(|t| !t.1), "not the page's press, so no release for the page");
    assert_eq!(ticks.iter().map(|t| t.0).collect::<Vec<_>>(), [false, false, false, false, true, true]);
  }

  #[test]
  fn dragging_the_whole_window_has_its_own_ending() {
    // The window drag starts on the second held tick; its release is `drag-end`, not this.
    let (holding, released) = hold_step(false, true, true, false);
    assert!(holding && !released);
    let (holding, released) = hold_step(holding, true, true, true);
    assert!(!holding && !released);
    let (holding, released) = hold_step(holding, false, false, false);
    assert!(!holding && !released);
  }

  #[test]
  fn decide_freezes_while_a_button_is_held() {
    // Pressed on Doozer, cursor wandered off: keep catching.
    assert!(decide(true, false, true));
    // Dragging something from another app across Doozer: stay out of the way.
    assert!(!decide(false, true, true));
  }
}
