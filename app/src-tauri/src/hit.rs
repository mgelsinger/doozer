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

  #[test]
  fn decide_freezes_while_a_button_is_held() {
    // Pressed on Doozer, cursor wandered off: keep catching.
    assert!(decide(true, false, true));
    // Dragging something from another app across Doozer: stay out of the way.
    assert!(!decide(false, true, true));
  }
}
