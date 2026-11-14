import { describe, expect, it } from 'vitest';
import { PAD, PILL, SIZE_SCALE, WINDOW_HEIGHT, WINDOW_WIDTH, pillWindow, unfoldMaxHeight } from '../../../src/views/pill/layout';

describe('the pill window', () => {
  it('is one fixed size, docked where the setting says', () => {
    for (const dock of ['top-center', 'top-left', 'top-right', 'bottom-right'] as const) {
      expect(pillWindow(dock)).toEqual({ kind: 'docked', width: WINDOW_WIDTH, height: WINDOW_HEIGHT, anchor: dock, margin: 0 });
    }
  });

  it('is wide enough for the Card and tall enough for the pill plus a 560 px Card, at every size', () => {
    expect(WINDOW_WIDTH).toBeGreaterThanOrEqual(320 + 2 * PAD.side);
    for (const size of ['small', 'medium', 'large'] as const) {
      expect(unfoldMaxHeight(WINDOW_HEIGHT, 'top-center', size)).toBeGreaterThanOrEqual(560);
      expect(unfoldMaxHeight(WINDOW_HEIGHT, 'bottom-right', size)).toBeGreaterThanOrEqual(560);
    }
  });

  it('gives the Card whatever a short screen leaves, and never less than something usable', () => {
    expect(unfoldMaxHeight(600, 'top-center', 'medium')).toBe(600 - PAD.top - PILL.height - PAD.gap - PAD.shadow);
    expect(unfoldMaxHeight(100, 'top-center', 'large')).toBe(160);
  });

  it('scales the pill, small to large', () => {
    expect(SIZE_SCALE.small).toBeLessThan(SIZE_SCALE.medium);
    expect(SIZE_SCALE.medium).toBe(1);
    expect(SIZE_SCALE.large).toBeGreaterThan(SIZE_SCALE.medium);
  });
});
