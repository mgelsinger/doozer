//! Hit regions and the rule that decides when the window catches the mouse.
//!
//! Pure: no Win32 in this file.

use serde::{Deserialize, Serialize};

/// One area of the page that should catch the mouse, in CSS pixels relative to
/// the top-left of the viewport. A rounded rectangle; `r` at least half the
/// shorter side makes it a pill or a circle.
///
/// A region may be moving: `vx`, `vy` are CSS pixels a second, and it keeps that
/// speed for `ms` milliseconds from the moment it was reported, then rests where
/// it has got to. That is how Doozer's walk along the taskbar is followed: the
/// page says once where the walk starts, how fast it goes and how long it lasts,
/// instead of reporting a new position many times a second (each report is a round
/// trip through the browser, and thirty a second cost more than drawing Doozer).
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct Region {
  pub x: f64,
  pub y: f64,
  pub w: f64,
  pub h: f64,
  #[serde(default)]
  pub r: f64,
  #[serde(default)]
  pub vx: f64,
  #[serde(default)]
  pub vy: f64,
  #[serde(default)]
  pub ms: f64,
}

impl Region {
  /// A region is usable when all its numbers are finite and it has an area.
  pub fn is_valid(&self) -> bool {
    [self.x, self.y, self.w, self.h, self.r, self.vx, self.vy, self.ms].iter().all(|v| v.is_finite())
      && self.w > 0.0
      && self.h > 0.0
  }

  /// Where the region is `elapsed_ms` after it was reported: moved on by its speed
  /// for as long as its motion lasts, and no further. A region that is not moving
  /// (or was given a negative time) is where it was reported.
  pub fn at(&self, elapsed_ms: f64) -> Region {
    let lasts = if self.ms > 0.0 { self.ms } else { 0.0 };
    let t = if elapsed_ms > 0.0 { elapsed_ms.min(lasts) } else { 0.0 } / 1000.0;
    Region { x: self.x + self.vx * t, y: self.y + self.vy * t, vx: 0.0, vy: 0.0, ms: 0.0, ..*self }
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
    let cx = nearest(px, self.x + r, self.x + self.w - r);
    let cy = nearest(py, self.y + r, self.y + self.h - r);
    let (dx, dy) = (px - cx, py - cy);
    dx * dx + dy * dy <= r * r
  }
}

/// The point of `lo..=hi` nearest to `p`.
///
/// When a radius is exactly half a side (a circle, the end of a pill) the two ends
/// are the same point, and rounding can put them a hair out of order in either
/// direction. `f64::clamp` panics on bounds that are out of order, and a panic on the
/// cursor thread takes the whole app down, so that case is answered here instead: the
/// one point they both mean.
fn nearest(p: f64, lo: f64, hi: f64) -> f64 {
  if lo <= hi { p.max(lo).min(hi) } else { (lo + hi) / 2.0 }
}

#[cfg(test)]
pub fn any_contains(regions: &[Region], px: f64, py: f64) -> bool {
  regions.iter().any(|r| r.contains(px, py))
}

/// The same, `elapsed_ms` after the regions were reported: moving ones have moved on.
pub fn any_contains_at(regions: &[Region], px: f64, py: f64, elapsed_ms: f64) -> bool {
  regions.iter().any(|r| r.at(elapsed_ms).contains(px, py))
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
    let r = Region { x: 10.0, y: 20.0, w: 100.0, h: 50.0, r: 0.0, ..Region::default() };
    assert!(r.contains(10.0, 20.0));
    assert!(r.contains(109.9, 69.9));
    assert!(!r.contains(110.0, 70.0));
    assert!(!r.contains(9.9, 30.0));
  }

  #[test]
  fn rounded_corners_are_outside() {
    let r = Region { x: 0.0, y: 0.0, w: 100.0, h: 100.0, r: 20.0, ..Region::default() };
    assert!(!r.contains(1.0, 1.0));
    assert!(!r.contains(99.0, 99.0));
    assert!(r.contains(20.0, 20.0));
    assert!(!r.contains(5.0, 5.0)); // 15 px from the arc centre on each axis: 21.2 px away
    assert!(r.contains(6.0, 6.0)); // 14 px on each axis: 19.8 px away, inside the 20 px arc
    assert!(r.contains(50.0, 0.5));
  }

  #[test]
  fn an_oversized_radius_makes_a_pill() {
    let pill = Region { x: 0.0, y: 0.0, w: 214.0, h: 54.0, r: 999.0, ..Region::default() };
    assert!(pill.contains(107.0, 27.0));
    assert!(pill.contains(1.0, 27.0));
    assert!(!pill.contains(3.0, 3.0));
    assert!(!pill.contains(211.0, 51.0));
  }

  #[test]
  fn a_circle() {
    let c = Region { x: 100.0, y: 100.0, w: 60.0, h: 60.0, r: 30.0, ..Region::default() };
    assert!(c.contains(130.0, 130.0));
    assert!(c.contains(130.0, 101.0));
    assert!(!c.contains(104.0, 104.0));
  }

  #[test]
  fn a_moving_region_is_followed_for_as_long_as_its_motion_lasts() {
    // Doozer strolling right at 30 px a second for four seconds, then standing.
    let walk = Region { x: 100.0, y: 500.0, w: 80.0, h: 90.0, r: 0.0, vx: 30.0, vy: 0.0, ms: 4000.0 };
    assert!(walk.is_valid());
    assert_eq!(walk.at(0.0).x, 100.0);
    assert_eq!(walk.at(2000.0).x, 160.0);
    assert_eq!(walk.at(4000.0).x, 220.0);
    // Past the end of the walk it stays where the walk ended, however long nobody says anything.
    assert_eq!(walk.at(60_000.0).x, 220.0);
    // A clock that seems to run backwards moves nothing.
    assert_eq!(walk.at(-50.0).x, 100.0);
    // Where it was is let through again; where it is now is caught.
    let regions = [walk];
    assert!(any_contains_at(&regions, 110.0, 540.0, 0.0));
    assert!(!any_contains_at(&regions, 110.0, 540.0, 4000.0));
    assert!(any_contains_at(&regions, 290.0, 540.0, 4000.0));
    assert!(!any_contains_at(&regions, 290.0, 540.0, 0.0));
  }

  #[test]
  fn a_region_that_is_not_moving_never_moves() {
    let still = Region { x: 10.0, y: 20.0, w: 30.0, h: 40.0, r: 5.0, ..Region::default() };
    assert_eq!(still.at(123_456.0), still);
    // A speed with no time to keep it is no motion at all, and nor is a nonsense time.
    let no_time = Region { vx: 500.0, vy: -500.0, ms: 0.0, ..still };
    assert_eq!(no_time.at(5000.0).x, 10.0);
    let negative = Region { vx: 500.0, ms: -100.0, ..still };
    assert_eq!(negative.at(5000.0).x, 10.0);
    assert!(!Region { vx: f64::NAN, ..still }.is_valid());
    assert!(!Region { ms: f64::INFINITY, ..still }.is_valid());
  }

  #[test]
  fn a_region_reported_the_old_way_reads_as_not_moving() {
    let r: Region = serde_json::from_str(r#"{"x":1,"y":2,"w":3,"h":4,"r":5}"#).unwrap();
    assert_eq!((r.vx, r.vy, r.ms), (0.0, 0.0, 0.0));
    let moving: Region = serde_json::from_str(r#"{"x":1,"y":2,"w":3,"h":4,"vx":30,"ms":2500}"#).unwrap();
    assert_eq!((moving.vx, moving.vy, moving.ms, moving.r), (30.0, 0.0, 2500.0, 0.0));
  }

  #[test]
  fn no_circle_or_pill_can_make_the_test_panic() {
    // Found by the Island view, whose regions for Doozer and the ball are round: with a
    // radius of exactly half the width, `x + r` and `x + w - r` are the same point, but
    // rounding can leave the first a hair above the second (204.0 against
    // 203.99999999999997), and `f64::clamp` panics on bounds that are out of order.
    // Every tenth of a pixel of position against every tenth of a pixel of radius:
    let mut out_of_order = 0;
    for xi in 0..400 {
      for ri in 5..600 {
        let (x, r) = (xi as f64 * 0.1 + 0.07, ri as f64 * 0.1);
        let circle = Region { x, y: x * 1.3, w: r * 2.0, h: r * 2.0, r, ..Region::default() };
        if circle.x + circle.r > circle.x + circle.w - circle.r {
          out_of_order += 1;
        }
        assert!(circle.contains(x + r, x * 1.3 + r), "the middle of a circle at {x} with radius {r}");
        assert!(!circle.contains(x + r * 0.05, x * 1.3 + r * 0.05), "the corner of its box");
        let pill = Region { x, y: 3.0, w: r * 2.0 + 40.0, h: r * 2.0, r: 999.0, ..Region::default() };
        assert!(pill.contains(x + r + 20.0, 3.0 + r));
      }
    }
    assert!(out_of_order > 0, "the grid has to include the case this test is about");
  }

  #[test]
  fn nearest_answers_bounds_that_are_out_of_order_with_the_point_they_both_mean() {
    assert_eq!(nearest(5.0, 1.0, 9.0), 5.0);
    assert_eq!(nearest(-5.0, 1.0, 9.0), 1.0);
    assert_eq!(nearest(50.0, 1.0, 9.0), 9.0);
    let (lo, hi) = (204.0, 203.99999999999997);
    assert!((nearest(100.0, lo, hi) - 204.0).abs() < 1e-9);
    assert!((nearest(300.0, lo, hi) - 204.0).abs() < 1e-9);
  }

  #[test]
  fn invalid_regions_are_detected() {
    assert!(!Region { x: 0.0, y: 0.0, w: 0.0, h: 10.0, r: 0.0, ..Region::default() }.is_valid());
    assert!(!Region { x: f64::NAN, y: 0.0, w: 10.0, h: 10.0, r: 0.0, ..Region::default() }.is_valid());
    assert!(!Region { x: 0.0, y: 0.0, w: f64::INFINITY, h: 10.0, r: 0.0, ..Region::default() }.is_valid());
    assert!(Region { x: -5.0, y: -5.0, w: 10.0, h: 10.0, r: 0.0, ..Region::default() }.is_valid());
  }

  #[test]
  fn regions_deserialise_without_a_radius() {
    let r: Region = serde_json::from_str(r#"{"x":1,"y":2,"w":3,"h":4}"#).unwrap();
    assert_eq!(r, Region { x: 1.0, y: 2.0, w: 3.0, h: 4.0, r: 0.0, ..Region::default() });
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
