// The Room view's window, and where things are in it. Pure numbers; mirrored in room.css.
//
// The room itself is a framed picture of 380 x 464 (title bar, scene, meter strip),
// scaled by the Size setting. The window is taller than that: it keeps an empty,
// click-through band above and below the frame, because the Card is taller than the
// room and has to go somewhere. Like the Pill's window, this one never changes size
// when the Card opens, so nothing can flicker and the click-through state never has to
// change around a click. The shell lets the bands hang off the screen (`bleed`), so the
// room itself can still be put right at the top or the bottom edge.

import type { SizeId } from '../../core/contract';
import type { Region, WindowInfo, WindowMode } from '../../shell';

/** The frame at Medium, in CSS pixels (DESIGN_SPEC.md 6.2: "about 380 x 464"). */
export const TITLE_H = 38;
export const SCENE = 380;
export const STRIP_H = 46;
export const FRAME = { width: SCENE, height: TITLE_H + SCENE + STRIP_H, radius: 22 } as const;

export const SIZE_SCALE: Readonly<Record<SizeId, number>> = { small: 0.86, medium: 1, large: 1.2 };

/** Room around the frame for its shadow. */
export const PAD = { top: 10, side: 14, bottom: 22 } as const;

/** The Card and the settings panel: 320 wide, and never taller than `room`. */
export const CARD = { width: 320, room: 566, gap: 6, edge: 8, radius: 26 } as const;
/** The round close button on the corner of whatever is unfolded. */
export const CHIP = { size: 28, out: 10 } as const;

const frameHeight = (size: SizeId): number => Math.round(FRAME.height * SIZE_SCALE[size]);

/** How far the Card reaches below the frame when it hangs from under the title bar. */
function overhang(size: SizeId): number {
  const title = TITLE_H * SIZE_SCALE[size];
  return Math.max(0, Math.ceil(title + CARD.gap + CARD.room + CARD.edge * 2 - (frameHeight(size) + PAD.bottom)));
}

/**
 * The empty band above and below the frame. The same in every size (the largest any of
 * them needs), so the frame's top-left corner stays where it is when the size changes.
 */
export const BAND = Math.max(overhang('small'), overhang('medium'), overhang('large'));

export interface RoomGeometry {
  /** The Size setting as a factor on the 380 x 464 frame. */
  readonly scale: number;
  readonly window: { readonly width: number; readonly height: number };
  /** The frame inside the window. */
  readonly frame: { readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly r: number };
  /** Where the Card hangs when there is room: under the title bar, centred. */
  readonly card: { readonly x: number; readonly y: number };
}

export function roomGeometry(size: SizeId): RoomGeometry {
  const scale = SIZE_SCALE[size];
  const w = Math.round(FRAME.width * scale);
  const h = frameHeight(size);
  const frame = { x: PAD.side, y: BAND + PAD.top, w, h, r: Math.round(FRAME.radius * scale) };
  return {
    scale,
    window: { width: w + PAD.side * 2, height: BAND + PAD.top + h + PAD.bottom + BAND },
    frame,
    card: { x: frame.x + (w - CARD.width) / 2, y: Math.round(frame.y + TITLE_H * scale + CARD.gap) },
  };
}

/** The window the Room asks the shell for. `position` is handed back exactly as the shell gave it. */
export function roomWindow(size: SizeId, position: { readonly x: number; readonly y: number } | null): WindowMode {
  const { window } = roomGeometry(size);
  return { kind: 'floating', width: window.width, height: window.height, bleed: BAND, ...(position ? { x: position.x, y: position.y } : {}) };
}

/** The part of the window that is inside the work area, top to bottom, in CSS pixels. */
export function visibleSpan(info: WindowInfo | null, windowHeight: number): { top: number; bottom: number } {
  const whole = { top: 0, bottom: windowHeight };
  if (!info || !(info.scale > 0)) return whole;
  const work = info.monitor?.work;
  if (!work || !(work.h > 0)) return whole;
  const top = Math.min(windowHeight, Math.max(0, (work.y - info.y) / info.scale));
  const bottom = Math.min(windowHeight, Math.max(top, (work.y + work.h - info.y) / info.scale));
  // A work area that does not meet the window at all is a window nobody can see: no use in guessing.
  return bottom - top < 80 ? whole : { top, bottom };
}

export interface CardPlacement {
  readonly top: number;
  /** The tallest the Card may be here. Past this it scrolls. */
  readonly maxHeight: number;
  readonly tight: boolean;
}

/**
 * Where the Card goes: under the title bar if all of it stays on the screen there,
 * otherwise slid up just far enough. On a screen too short for it, it scrolls.
 */
export function placeCard(geometry: RoomGeometry, span: { top: number; bottom: number }, cardHeight: number): CardPlacement {
  const room = Math.max(120, Math.floor(span.bottom - span.top - CARD.edge * 2));
  const height = Math.min(cardHeight, room);
  const lowest = span.bottom - CARD.edge - height;
  const top = Math.round(Math.max(span.top + CARD.edge, Math.min(geometry.card.y, lowest)));
  return { top, maxHeight: room, tight: cardHeight > room };
}

export function frameRegion(geometry: RoomGeometry): Region {
  const { x, y, w, h, r } = geometry.frame;
  return { x, y, w, h, r };
}

export function cardRegions(geometry: RoomGeometry, top: number, height: number): Region[] {
  const { x } = geometry.card;
  return [
    { x, y: top, w: CARD.width, h: height, r: CARD.radius },
    { x: x + CARD.width - CHIP.size + CHIP.out, y: top - CHIP.out, w: CHIP.size, h: CHIP.size, r: CHIP.size / 2 },
  ];
}

// ---- inside the scene (380 x 380 design pixels, before the Size scale) ----------------

/** Doozer in the room: its width, and how far below its top edge its soles are. */
export const PET = { size: 92, sole: 87 } as const;
/** The line Doozer's soles are on. */
export const FLOOR_Y = 340;
/** How far left and right Doozer's middle may go on its own. */
export const WALK = { min: 150, max: 318 } as const;
/** How far it may be sent (to the bed, after the ball). */
export const REACH = { min: 60, max: 330 } as const;

/** Where Doozer stands for each thing it does. `x` is its middle. */
export const SPOT = {
  start: 204,
  /** Lying in bed: its middle, and the line its soles are on. */
  bed: { x: 78, y: 322 },
  /** Standing left of the bowl, facing it. */
  bowl: 224,
  /** Under the shelf with the treat jar. */
  jar: 196,
  window: 104,
  rug: 204,
  books: 166,
} as const;

/** Where things are drawn. */
export const THING = {
  bowl: { x: 270, y: 312 },
  jar: { x: 221, y: 82 },
  /** Where a snack ends up relative to Doozer's middle: in front of it, on the floor. */
  snack: { dx: 42, y: 318 },
  ball: { r: 12, x: 150 },
  /** The glass in the window. */
  pane: { x: 42, y: 54, w: 120, h: 106 },
} as const;

/** The furniture, as rectangles in the scene: what a click lands on. */
export const HOTSPOTS = {
  bed: { x: 12, y: 280, w: 124, h: 56, r: 26 },
  bowl: { x: 242, y: 296, w: 56, h: 38, r: 14 },
  soap: { x: 255, y: 108, w: 32, h: 46, r: 10 },
  lamp: { x: 306, y: 116, w: 68, h: 80, r: 18 },
  jar: { x: 201, y: 54, w: 40, h: 46, r: 12 },
  clock: { x: 248, y: 58, w: 40, h: 42, r: 16 },
} as const;
export type FurnitureId = keyof typeof HOTSPOTS | 'ball';
