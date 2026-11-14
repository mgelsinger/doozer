// The Island view's window and where things sit inside it, and the world's fixed numbers
// (the island's shape, the camera). Pure: no DOM, no three.js.
//
// The window is the island's own drawing with an empty, click-through band above and
// below it: room for the Card and the settings panel, which are taller than the island.
// Those bands may hang over the top and bottom of the screen (the shell's `bleed`), so
// the island itself can still be put right at a screen edge.

import type { SizeId } from '../../core/contract';
import type { WindowMode } from '../../shell';

/** The island's own drawing at Medium, in CSS pixels (DESIGN_SPEC.md 6.3: "about 380 x 450"). */
export const SCENE = { width: 380, height: 450 } as const;

/** The Size setting scales the island. The Card, the Radial and the chip stay the same size. */
export const SIZE_SCALE: Readonly<Record<SizeId, number>> = { small: 0.8, medium: 1, large: 1.25 };

/** The Card is 320 wide; this leaves room for its shadow on both sides. */
export const MIN_WINDOW_WIDTH = 408;
/** Height kept free for the Card (about 540) or the settings panel (up to 560), with their shadow. */
export const PANEL_SPACE = 640;
/** Space kept between a panel and the edge of what is on screen. */
export const PANEL_MARGIN = 14;

export interface IslandLayout {
  readonly size: SizeId;
  readonly scale: number;
  /** The island's drawing: its size, and its top-left corner inside the window. */
  readonly sceneWidth: number;
  readonly sceneHeight: number;
  readonly sceneLeft: number;
  readonly sceneTop: number;
  readonly windowWidth: number;
  readonly windowHeight: number;
  /** The empty band above and below the drawing, which may hang off the screen. */
  readonly band: number;
}

export function islandLayout(size: SizeId): IslandLayout {
  const scale = SIZE_SCALE[size] ?? 1;
  const sceneWidth = Math.round(SCENE.width * scale);
  const sceneHeight = Math.round(SCENE.height * scale);
  const windowWidth = Math.max(sceneWidth, MIN_WINDOW_WIDTH);
  const band = Math.max(0, Math.ceil((PANEL_SPACE - sceneHeight) / 2));
  return {
    size, scale, sceneWidth, sceneHeight,
    sceneLeft: Math.round((windowWidth - sceneWidth) / 2),
    sceneTop: band,
    windowWidth,
    windowHeight: sceneHeight + band * 2,
    band,
  };
}

export function islandWindow(size: SizeId, position: { readonly x: number; readonly y: number } | null): WindowMode {
  const layout = islandLayout(size);
  return { kind: 'floating', width: layout.windowWidth, height: layout.windowHeight, bleed: layout.band, ...(position ?? {}) };
}

/**
 * Where a panel `height` tall goes: centred on the island, but kept inside the part of
 * the window that is on screen (`visibleTop`..`visibleBottom`, in window pixels).
 */
export function panelTop(layout: IslandLayout, height: number, visibleTop = 0, visibleBottom = layout.windowHeight): number {
  const top = Math.max(0, visibleTop) + PANEL_MARGIN;
  const bottom = Math.min(layout.windowHeight, visibleBottom) - PANEL_MARGIN;
  const centred = layout.sceneTop + layout.sceneHeight / 2 - height / 2;
  return Math.round(Math.max(top, Math.min(centred, bottom - height)));
}

// ---- the world -------------------------------------------------------------------------
// One unit is 100 pixels of the 2D rig, so Doozer is about 1.4 units tall. The numbers are
// the mockup's (mockups/v2-blob), which the owner saw and liked.

export const ISLAND = {
  /** Radius of the grass. */
  radius: 1.9,
  /** The grass is a flattened ball centred this far below the top of the island. */
  centreY: -0.3,
  dome: 0.304,
  /** The earth underneath: its radius at the rim and how deep it hangs. */
  earthRadius: 1.74,
  earthDepth: 1.3,
  /** How far from the middle Doozer goes by itself, and where things are dropped. */
  roam: 0.8,
  reach: 1.15,
  /** The ball bounces back from this distance. */
  fence: 1.5,
} as const;

/** The height of the grass at a point of the island. */
export function groundY(x: number, z: number): number {
  const r2 = (x * x + z * z) / (ISLAND.radius * ISLAND.radius);
  return ISLAND.centreY + ISLAND.dome * Math.sqrt(Math.max(0, 1 - r2));
}

export const CAMERA = {
  position: [0, 3.0, 9.8],
  target: [0, 0.62, 0],
  fovDeg: 30,
  near: 0.1,
  far: 60,
} as const;

/**
 * How large Doozer is drawn on the island. The model keeps the 2D rig's proportions
 * (1.28 units wide); on the island it is a fifth larger, which gives it the presence it
 * had in the mockup the owner liked, where it was a ball 1.5 units across.
 */
export const DOOZER_SCALE = 1.2;

/** Where Doozer stands when nothing has moved it. */
export const HOME = { x: 0, z: 0.3 } as const;
