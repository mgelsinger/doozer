//! Window shapes and the arithmetic that turns one into screen pixels.
//!
//! Pure: no Win32 in this file, so it is covered by plain unit tests.
//!
//! Units. Sizes arrive from the page in CSS pixels. Positions are physical
//! screen pixels in virtual-desktop coordinates, because that is the only
//! coordinate space that stays unambiguous across monitors with different
//! scaling. The page treats positions as opaque values it got from the shell.

use serde::{Deserialize, Serialize};

/// A rectangle in physical screen pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rect {
  pub x: i32,
  pub y: i32,
  pub w: i32,
  pub h: i32,
}

impl Rect {
  pub fn right(&self) -> i32 {
    self.x + self.w
  }
  pub fn bottom(&self) -> i32 {
    self.y + self.h
  }
}

/// What the shell needs to know about the monitor a window is going to.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Monitor {
  /// The whole monitor.
  pub full: Rect,
  /// The monitor minus the taskbar and any other docked bars.
  pub work: Rect,
  /// 1.0 at 96 dpi, 1.5 at 150 % scaling.
  pub scale: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Anchor {
  TopLeft,
  TopCenter,
  TopRight,
  BottomLeft,
  BottomCenter,
  BottomRight,
}

/// The three shapes the single window can take.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WindowMode {
  /// A small window glued to an edge of the work area (the Pill).
  #[serde(rename_all = "camelCase")]
  Docked {
    width: f64,
    height: f64,
    anchor: Anchor,
    /// Gap between the window and the work-area edge, in CSS pixels.
    #[serde(default)]
    margin: f64,
  },
  /// A small window the user can put anywhere (Room, Island).
  #[serde(rename_all = "camelCase")]
  Floating {
    width: f64,
    height: f64,
    /// Remembered top-left corner in physical screen pixels. Absent on first use.
    #[serde(default)]
    x: Option<i32>,
    #[serde(default)]
    y: Option<i32>,
    /// How far the window may hang over the top and the bottom of the work area,
    /// in CSS pixels. For a window with an empty, click-through band above and
    /// below what it draws (the Room keeps one for its Card): the drawn part can
    /// then still be put right at the edge of the screen.
    #[serde(default)]
    bleed: f64,
  },
  /// The whole work area of one monitor; click-through except hit regions (Desktop).
  Overlay,
}

impl WindowMode {
  pub fn kind(&self) -> &'static str {
    match self {
      WindowMode::Docked { .. } => "docked",
      WindowMode::Floating { .. } => "floating",
      WindowMode::Overlay => "overlay",
    }
  }

  /// The remembered position of a floating window, if it has one.
  pub fn saved_position(&self) -> Option<(i32, i32)> {
    match self {
      WindowMode::Floating { x: Some(x), y: Some(y), .. } => Some((*x, *y)),
      _ => None,
    }
  }
}

/// Where a floating window goes the first time: bottom-right, clear of the edges.
const FLOAT_MARGIN_X: f64 = 28.0;
const FLOAT_MARGIN_Y: f64 = 18.0;
/// Smallest window the shell will make, in CSS pixels. Guards against a view
/// asking for a zero-sized window it could never be clicked out of.
const MIN_SIDE: f64 = 24.0;

fn px(css: f64, scale: f64) -> i32 {
  (css * scale).round() as i32
}

/// The physical rectangle for `mode` on `monitor`.
pub fn bounds_for(mode: &WindowMode, monitor: &Monitor) -> Rect {
  let work = monitor.work;
  let scale = monitor.scale;
  match *mode {
    WindowMode::Docked { width, height, anchor, margin } => {
      let w = px(width.max(MIN_SIDE), scale).min(work.w);
      let h = px(height.max(MIN_SIDE), scale).min(work.h);
      let m = px(margin.max(0.0), scale);
      let x = match anchor {
        Anchor::TopLeft | Anchor::BottomLeft => work.x + m,
        Anchor::TopCenter | Anchor::BottomCenter => work.x + (work.w - w) / 2,
        Anchor::TopRight | Anchor::BottomRight => work.right() - w - m,
      };
      let y = match anchor {
        Anchor::TopLeft | Anchor::TopCenter | Anchor::TopRight => work.y + m,
        Anchor::BottomLeft | Anchor::BottomCenter | Anchor::BottomRight => work.bottom() - h - m,
      };
      clamp_into(Rect { x, y, w, h }, work)
    }
    WindowMode::Floating { width, height, x, y, bleed } => {
      // The window may hang this far over the top and the bottom of the work area.
      let b = if bleed.is_finite() { px(bleed.max(0.0), scale) } else { 0 };
      let area = Rect { x: work.x, y: work.y - b, w: work.w, h: work.h + 2 * b };
      let w = px(width.max(MIN_SIDE), scale).min(area.w);
      let h = px(height.max(MIN_SIDE), scale).min(area.h);
      let rect = match (x, y) {
        (Some(x), Some(y)) => Rect { x, y, w, h },
        _ => Rect {
          x: work.right() - w - px(FLOAT_MARGIN_X, scale),
          y: area.bottom() - h - px(FLOAT_MARGIN_Y, scale),
          w,
          h,
        },
      };
      // A remembered position can be stale (monitor unplugged, resolution
      // changed). Pull the window fully back into the area it may use.
      clamp_into(rect, area)
    }
    WindowMode::Overlay => {
      let mut r = work;
      // With an auto-hidden taskbar the work area is the whole monitor. A
      // topmost window covering a whole monitor is treated by Windows as a
      // fullscreen app, which keeps the taskbar from sliding back in. Leave a
      // one-pixel strip free on the bottom edge.
      if work == monitor.full && r.h > 1 {
        r.h -= 1;
      }
      r
    }
  }
}

/// Move `rect` the smallest distance that puts it inside `area`.
pub fn clamp_into(rect: Rect, area: Rect) -> Rect {
  let w = rect.w.min(area.w);
  let h = rect.h.min(area.h);
  let x = rect.x.clamp(area.x, area.right() - w);
  let y = rect.y.clamp(area.y, area.bottom() - h);
  Rect { x, y, w, h }
}

#[cfg(test)]
mod tests {
  use super::*;

  /// The development machine: 4K at 150 %, taskbar along the bottom.
  fn uhd() -> Monitor {
    Monitor { full: Rect { x: 0, y: 0, w: 3840, h: 2160 }, work: Rect { x: 0, y: 0, w: 3840, h: 2088 }, scale: 1.5 }
  }

  #[test]
  fn docked_top_center_is_centred_on_the_work_area() {
    let mode = WindowMode::Docked { width: 214.0, height: 54.0, anchor: Anchor::TopCenter, margin: 0.0 };
    assert_eq!(bounds_for(&mode, &uhd()), Rect { x: (3840 - 321) / 2, y: 0, w: 321, h: 81 });
  }

  #[test]
  fn docked_margin_is_scaled_and_applied_on_the_anchored_edges() {
    let mode = WindowMode::Docked { width: 200.0, height: 50.0, anchor: Anchor::BottomRight, margin: 10.0 };
    assert_eq!(bounds_for(&mode, &uhd()), Rect { x: 3840 - 300 - 15, y: 2088 - 75 - 15, w: 300, h: 75 });
  }

  #[test]
  fn docked_respects_a_work_area_that_does_not_start_at_zero() {
    // Taskbar on the left, 72 px wide, on a second monitor to the right.
    let m = Monitor {
      full: Rect { x: 3840, y: 0, w: 1920, h: 1080 },
      work: Rect { x: 3912, y: 0, w: 1848, h: 1080 },
      scale: 1.0,
    };
    let mode = WindowMode::Docked { width: 214.0, height: 54.0, anchor: Anchor::TopLeft, margin: 0.0 };
    assert_eq!(bounds_for(&mode, &m), Rect { x: 3912, y: 0, w: 214, h: 54 });
  }

  #[test]
  fn floating_without_a_position_goes_bottom_right() {
    let mode = WindowMode::Floating { width: 380.0, height: 464.0, x: None, y: None, bleed: 0.0 };
    let r = bounds_for(&mode, &uhd());
    assert_eq!((r.w, r.h), (570, 696));
    assert_eq!(r.right(), 3840 - 42);
    assert_eq!(r.bottom(), 2088 - 27);
  }

  #[test]
  fn floating_keeps_a_remembered_position() {
    let mode = WindowMode::Floating { width: 380.0, height: 464.0, x: Some(100), y: Some(200), bleed: 0.0 };
    assert_eq!(bounds_for(&mode, &uhd()), Rect { x: 100, y: 200, w: 570, h: 696 });
  }

  #[test]
  fn floating_with_a_stale_position_is_pulled_back_on_screen() {
    let mode = WindowMode::Floating { width: 380.0, height: 464.0, x: Some(9000), y: Some(-500), bleed: 0.0 };
    let r = bounds_for(&mode, &uhd());
    assert_eq!((r.x, r.y), (3840 - 570, 0));
  }

  #[test]
  fn floating_with_a_bleed_may_hang_over_the_top_and_the_bottom() {
    // 140 CSS pixels at 150 % is 210 physical pixels of empty band at each end.
    let at = |x, y| WindowMode::Floating { width: 408.0, height: 776.0, x: Some(x), y: Some(y), bleed: 140.0 };
    let (w, h) = (612, 1164);
    assert_eq!(bounds_for(&at(100, 2088 - h + 210), &uhd()), Rect { x: 100, y: 2088 - h + 210, w, h });
    assert_eq!(bounds_for(&at(100, 5000), &uhd()).bottom(), 2088 + 210);
    assert_eq!(bounds_for(&at(100, -5000), &uhd()).y, -210);
    // Never sideways: only the bands above and below are empty.
    assert_eq!(bounds_for(&at(9000, 300), &uhd()).right(), 3840);
    assert_eq!(bounds_for(&at(-9000, 300), &uhd()).x, 0);
  }

  #[test]
  fn floating_with_a_bleed_starts_with_its_drawn_part_clear_of_the_taskbar() {
    let mode = WindowMode::Floating { width: 408.0, height: 776.0, x: None, y: None, bleed: 140.0 };
    let r = bounds_for(&mode, &uhd());
    assert_eq!(r.right(), 3840 - 42);
    assert_eq!(r.bottom(), 2088 + 210 - 27);
  }

  #[test]
  fn a_bleed_that_is_not_a_sensible_number_is_no_bleed() {
    for bleed in [-50.0, f64::NAN, f64::INFINITY] {
      let mode = WindowMode::Floating { width: 380.0, height: 464.0, x: Some(100), y: Some(9000), bleed };
      assert_eq!(bounds_for(&mode, &uhd()).bottom(), 2088, "bleed {bleed}");
    }
  }

  #[test]
  fn overlay_is_exactly_the_work_area() {
    assert_eq!(bounds_for(&WindowMode::Overlay, &uhd()), uhd().work);
  }

  #[test]
  fn overlay_never_covers_a_whole_monitor() {
    let mut m = uhd();
    m.work = m.full; // auto-hidden taskbar
    let r = bounds_for(&WindowMode::Overlay, &m);
    assert_eq!(r, Rect { x: 0, y: 0, w: 3840, h: 2159 });
  }

  #[test]
  fn a_window_larger_than_the_work_area_is_shrunk_to_fit() {
    let m =
      Monitor { full: Rect { x: 0, y: 0, w: 800, h: 600 }, work: Rect { x: 0, y: 0, w: 800, h: 560 }, scale: 2.0 };
    let mode = WindowMode::Floating { width: 380.0, height: 464.0, x: None, y: None, bleed: 0.0 };
    let r = bounds_for(&mode, &m);
    assert_eq!((r.w, r.h), (760, 560));
    assert!(r.x >= 0 && r.y >= 0 && r.right() <= 800 && r.bottom() <= 560);
  }

  #[test]
  fn degenerate_sizes_are_raised_to_a_usable_minimum() {
    let mode = WindowMode::Docked { width: 0.0, height: -5.0, anchor: Anchor::TopCenter, margin: 0.0 };
    let r = bounds_for(&mode, &uhd());
    assert_eq!((r.w, r.h), (36, 36));
  }

  #[test]
  fn modes_deserialise_from_the_shapes_the_page_sends() {
    let docked: WindowMode =
      serde_json::from_str(r#"{"kind":"docked","width":214,"height":54,"anchor":"top-center"}"#).unwrap();
    assert_eq!(docked, WindowMode::Docked { width: 214.0, height: 54.0, anchor: Anchor::TopCenter, margin: 0.0 });
    let floating: WindowMode =
      serde_json::from_str(r#"{"kind":"floating","width":380,"height":450,"x":12,"y":-3}"#).unwrap();
    assert_eq!(floating.saved_position(), Some((12, -3)));
    let bled: WindowMode =
      serde_json::from_str(r#"{"kind":"floating","width":408,"height":776,"bleed":140}"#).unwrap();
    assert_eq!(bled, WindowMode::Floating { width: 408.0, height: 776.0, x: None, y: None, bleed: 140.0 });
    let overlay: WindowMode = serde_json::from_str(r#"{"kind":"overlay"}"#).unwrap();
    assert_eq!(overlay.kind(), "overlay");
  }
}
