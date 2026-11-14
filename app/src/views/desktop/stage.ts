// Where things are in the Desktop view: the ground line, how far Doozer may walk, the
// area that catches the mouse, where the Radial and the Card go, and which monitor this
// is. Pure numbers; nothing here touches the page.
//
// The window is an overlay over one monitor's work area (DESIGN_SPEC.md 6.4), so the
// page's viewport *is* the work area, in CSS pixels. Its bottom edge is the top edge of
// a taskbar that sits along the bottom of the screen, and that is the line Doozer stands
// on. With the taskbar on another edge, or auto-hidden, the bottom of the work area is
// the bottom of the screen and Doozer stands there.

import type { SizeId } from '../../core/contract';
import { GROUND_Y, VIEW_BOX } from '../../character/rig-markup';
import type { Region, ScreenRect, WindowInfo } from '../../shell';

/** Doozer's width by the Size setting. The rig is square; medium is "about 110 px tall". */
export const SIZE_PX: Readonly<Record<SizeId, number>> = { small: 92, medium: 112, large: 136 };

/** Where the soles of the feet are, as a fraction of the rig's height. */
export const FOOT = GROUND_Y / VIEW_BOX;
/** The bottom of the shadow under the feet, as a fraction of the rig's height. */
const SHADOW_BOTTOM = 195 / VIEW_BOX;

/**
 * The part of the rig that catches the mouse, as fractions of its box: the body, the ears
 * and the tuft, without the empty corners. `radius` is a fraction of the width. desktop.css
 * draws the same shape, so what the window catches and what the page answers to agree.
 */
export const HIT = { left: 0.15, top: 0.12, width: 0.7, height: 0.84, radius: 0.32 } as const;

/** The middle of the Radial, as a fraction of the rig's box. */
export const RADIAL_AT = { x: 0.5, y: 0.52 } as const;

export type TaskbarEdge = 'bottom' | 'top' | 'left' | 'right' | 'hidden';

export interface Stage {
  /** The viewport: the monitor's work area in CSS pixels. */
  readonly w: number;
  readonly h: number;
  /** Doozer's width and height. */
  readonly size: number;
  /** The line the soles of Doozer's feet rest on. */
  readonly ground: number;
  /** The leftmost and rightmost places Doozer's middle may stand. */
  readonly minX: number;
  readonly maxX: number;
  readonly taskbar: TaskbarEdge;
  /** Which monitor this is, for remembering Doozer's spot on it. */
  readonly monitor: string;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Which edge of the monitor the taskbar takes up. `hidden`: it takes none (auto-hide). */
export function taskbarEdge(full: ScreenRect, work: ScreenRect): TaskbarEdge {
  const gaps: [TaskbarEdge, number][] = [
    ['bottom', full.y + full.h - (work.y + work.h)],
    ['top', work.y - full.y],
    ['left', work.x - full.x],
    ['right', full.x + full.w - (work.x + work.w)],
  ];
  let best: [TaskbarEdge, number] = ['hidden', 0];
  for (const gap of gaps) if (gap[1] > best[1]) best = gap;
  return best[0];
}

/** A name for a monitor that survives a restart: its size and where it sits among the others. */
export function monitorKey(full: ScreenRect): string {
  return `${full.w}x${full.h}@${full.x},${full.y}`;
}

/** Everything about the place Doozer lives in, from what the shell says about the window. */
export function stageFor(info: WindowInfo, size: number, viewport?: { w: number; h: number }): Stage {
  const w = Math.max(1, viewport?.w ?? info.cssWidth);
  const h = Math.max(1, viewport?.h ?? info.cssHeight);
  // The shadow under the feet ends one pixel inside the window, so nothing is cut off and
  // the feet look planted on the edge below.
  const ground = Math.round(h - 1 - size * (SHADOW_BOTTOM - FOOT));
  const margin = Math.max(60, Math.round(size * 0.55));
  const [minX, maxX] = w >= margin * 2 ? [margin, w - margin] : [w / 2, w / 2];
  return {
    w, h, size, ground, minX, maxX,
    taskbar: taskbarEdge(info.monitor.full, info.monitor.work),
    monitor: monitorKey(info.monitor.full),
  };
}

/** A place Doozer may stand. Anything unusable gives the default spot. */
export function standAt(stage: Stage, x: number): number {
  return finite(x) ? clamp(x, stage.minX, stage.maxX) : defaultSpot(stage);
}

/** Where Doozer stands the first time on a monitor: right of the middle, clear of the corner. */
export function defaultSpot(stage: Stage): number {
  return clamp(Math.round(stage.w * 0.72), stage.minX, stage.maxX);
}

/** How far Doozer may be carried: anywhere it stays whole on the screen. `y` is the soles. */
export function carryAt(stage: Stage, x: number, y: number): { x: number; y: number } {
  const half = stage.size * (HIT.width / 2 + 0.01);
  const top = stage.size * (FOOT - HIT.top) + 2;
  return {
    x: finite(x) ? clamp(x, Math.min(half, stage.w / 2), Math.max(stage.w - half, stage.w / 2)) : defaultSpot(stage),
    y: finite(y) ? clamp(y, Math.min(top, stage.ground), stage.ground) : stage.ground,
  };
}

/** The top-left corner of the rig's box when the soles are at (x, y). */
export function boxAt(size: number, x: number, y: number): { left: number; top: number } {
  return { left: x - size / 2, top: y - size * FOOT };
}

/** The area of Doozer that catches the mouse when the soles are at (x, y). */
export function hitRegion(size: number, x: number, y: number): Region {
  const box = boxAt(size, x, y);
  return {
    x: box.left + size * HIT.left,
    y: box.top + size * HIT.top,
    w: size * HIT.width,
    h: size * HIT.height,
    r: size * HIT.radius,
  };
}

/** The middle of the Radial when the soles are at (x, y). */
export function radialAnchor(size: number, x: number, y: number): { x: number; y: number } {
  const box = boxAt(size, x, y);
  return { x: box.left + size * RADIAL_AT.x, y: box.top + size * RADIAL_AT.y };
}

/**
 * The part of a region that is inside the window, or null if none of it is. A region that
 * hung over the edge would count the pointer as "on Doozer" while it was on the taskbar
 * or on the next monitor.
 */
export function clipRegion(region: Region, w: number, h: number): Region | null {
  if (region.x >= 0 && region.y >= 0 && region.x + region.w <= w && region.y + region.h <= h) {
    return region.w >= 1 && region.h >= 1 ? region : null;
  }
  const x0 = Math.max(0, region.x);
  const y0 = Math.max(0, region.y);
  const x1 = Math.min(w, region.x + region.w);
  const y1 = Math.min(h, region.y + region.h);
  if (!(x1 - x0 >= 1) || !(y1 - y0 >= 1)) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0, r: Math.max(0, Math.min(region.r ?? 0, (x1 - x0) / 2, (y1 - y0) / 2)) };
}

/**
 * Which way the Radial opens. Straight up and wide in the open; near a side of the screen
 * it leans away from the edge and narrows, so that no button lands off screen.
 */
export function radialArc(stage: Stage, x: number): { center: number; span: number } {
  const reach = 132;
  // The leaning arc ends level with Doozer's middle, so its last button clears the bottom edge.
  if (x < reach && x <= stage.w / 2) return { center: -50, span: 100 };
  if (x > stage.w - reach) return { center: -130, span: 100 };
  return { center: -90, span: 200 };
}

export interface PanelPlace {
  left: number;
  top: number;
  /** The tallest the panel may be here; past that it scrolls. */
  maxHeight: number;
  /** Where it unfolds from, relative to its own box: Doozer. */
  origin: string;
}

/**
 * Where the Card (or the settings panel) goes when Doozer's soles are at (x, y): above its
 * head, kept on screen. On a screen too short for that it goes beside Doozer instead.
 */
export function panelPlace(stage: Stage, x: number, y: number, panel: { w: number; h: number }): PanelPlace {
  const edge = 10;
  const gap = 12;
  const maxHeight = Math.max(160, Math.floor(stage.h - edge * 2));
  const height = Math.min(panel.h, maxHeight);
  const headTop = y - stage.size * (FOOT - HIT.top);
  const above = headTop - gap - height;
  if (above >= edge) {
    const left = clamp(x - panel.w / 2, edge, Math.max(edge, stage.w - panel.w - edge));
    return { left, top: above, maxHeight, origin: `${Math.round(x - left)}px calc(100% + ${gap + 8}px)` };
  }
  // Beside Doozer, on the side with more room.
  const reach = stage.size * (HIT.width / 2) + gap;
  const right = x + reach;
  const leftSide = x - reach - panel.w;
  const left = stage.w - right - panel.w >= edge || leftSide < edge
    ? clamp(right, edge, Math.max(edge, stage.w - panel.w - edge))
    : leftSide;
  const top = clamp(stage.ground - height, edge, Math.max(edge, stage.h - height - edge));
  return { left, top, maxHeight, origin: `${left > x ? -gap : panel.w + gap}px ${Math.round(clamp(y - stage.size / 2 - top, 0, height))}px` };
}

// ---- remembering the spot, per monitor -------------------------------------------

/** Where Doozer was left on each monitor: how far across (0..1), and when. */
export type Spots = Record<string, { f: number; t: number }>;

const MAX_MONITORS = 8;

/** Read what the view remembered. Anything unusable is dropped; it never throws. */
export function readSpots(raw: unknown): Spots {
  const spots: Spots = {};
  if (typeof raw !== 'object' || raw === null) return spots;
  const bag = (raw as { spots?: unknown }).spots;
  if (typeof bag !== 'object' || bag === null || Array.isArray(bag)) return spots;
  for (const [key, value] of Object.entries(bag as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null) continue;
    const { f, t } = value as { f?: unknown; t?: unknown };
    if (finite(f) && f >= 0 && f <= 1) spots[key] = { f, t: finite(t) ? t : 0 };
  }
  return keepNewest(spots);
}

function keepNewest(spots: Spots): Spots {
  const entries = Object.entries(spots);
  if (entries.length <= MAX_MONITORS) return spots;
  return Object.fromEntries(entries.sort((a, b) => b[1].t - a[1].t).slice(0, MAX_MONITORS));
}

/** `spots` with Doozer's place on this monitor set to `x`. */
export function withSpot(spots: Spots, stage: Stage, x: number, at: number): Spots {
  const f = Math.round(clamp(standAt(stage, x) / stage.w, 0, 1) * 10_000) / 10_000;
  return keepNewest({ ...spots, [stage.monitor]: { f, t: at } });
}

/** Where Doozer was left on this monitor, or the default spot. */
export function spotOn(spots: Spots, stage: Stage): number {
  const spot = spots[stage.monitor];
  return spot ? standAt(stage, spot.f * stage.w) : defaultSpot(stage);
}

/** What goes in the save. */
export function spotsDocument(spots: Spots): { v: 1; spots: Spots } {
  return { v: 1, spots };
}
