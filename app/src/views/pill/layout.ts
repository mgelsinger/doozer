// The Pill view's window, and where things sit inside it. Pure numbers.
//
// The window is always the same size: tall enough for the pill with the Card unfolded
// beneath it (or above it, for the bottom dock). It is transparent and click-through
// everywhere except the hit regions, so the unused part costs nothing and opening the
// Card never has to resize the window (which could flicker, and would change the
// click-through state mid-click).

import type { Settings, SizeId } from '../../core/contract';
import type { WindowMode } from '../../shell';

/** The pill itself at Medium, in CSS pixels (DESIGN_SPEC.md 6.1). */
export const PILL = { width: 214, height: 54 } as const;

/** The Size setting scales the pill's face. The Card is the same in every view and size. */
export const SIZE_SCALE: Readonly<Record<SizeId, number>> = { small: 0.86, medium: 1, large: 1.18 };

/** Wide enough for the 320 px Card and its shadow. */
export const WINDOW_WIDTH = 400;
/** The pill, the gap, the tallest thing that unfolds, and room for its shadow. */
export const WINDOW_HEIGHT = 744;

/** Space the layout keeps around the pill and the Card, by dock. Mirrors pill.css. */
export const PAD = {
  /** Above the pill on a top dock: its ears poke over the top, and emotes rise there. */
  top: 30,
  /** Below the pill on the bottom dock. */
  bottom: 16,
  /** Between the pill and the screen edge on a corner dock. */
  side: 20,
  /** Between the pill and what unfolds from it. */
  gap: 12,
  /** On the bottom dock the Card sits above the pill and has to clear Doozer's ears. */
  gapAbove: 28,
  /** Kept free past the far end of the Card for its shadow. */
  shadow: 52,
} as const;

export type PillDock = Settings['pillDock'];

export function pillWindow(dock: PillDock): WindowMode {
  return { kind: 'docked', width: WINDOW_WIDTH, height: WINDOW_HEIGHT, anchor: dock, margin: 0 };
}

/**
 * The tallest the unfolded Card or settings panel may be in a window `windowHeight`
 * tall (the shell shrinks the window on a small screen). Past this it scrolls.
 */
export function unfoldMaxHeight(windowHeight: number, dock: PillDock, size: SizeId): number {
  const pill = Math.ceil(PILL.height * SIZE_SCALE[size]);
  const used = dock === 'bottom-right'
    ? PAD.bottom + pill + PAD.gapAbove + PAD.shadow / 2
    : PAD.top + pill + PAD.gap + PAD.shadow;
  return Math.max(160, Math.floor(windowHeight - used));
}
