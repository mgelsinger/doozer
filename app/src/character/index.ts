// character/ - the Doozer rig. Phase 5 owns the 2D rig here; Phase 8 adds the 3D loader.

export { createDoozer, walkCycleMs, SMALL_SIZE_PX } from './doozer';
export type { Doozer, DoozerOptions, LineStyle } from './doozer';
export { EXPRESSIONS, EXPRESSION_NAMES, POSES, isExpressionName } from './expressions';
export type { Expression, ExpressionName, Eyes, Mouth, Pose } from './expressions';
export { ExpressionState, FLASH_MAX_MS, FLASH_MIN_MS } from './expression-state';
export type { ExpressionDriver, Look, PerformanceOutcome } from './expression-state';
export { PALETTES, PALETTE_IDS, isPaletteId } from './palettes';
export type { Palette } from './palettes';
export { PERFORMANCES, PERFORMANCE_NAMES, isPerformanceName } from './performances';
export type { Frame, PartName, PerformanceName, PerformanceSpec, Track } from './performances';
export { GROUND_Y, HAT_ANCHOR, PIVOTS, VIEW_BOX, hatMarkup, rigMarkup } from './rig-markup';
export { realTimers } from './timers';
export type { Timers } from './timers';
