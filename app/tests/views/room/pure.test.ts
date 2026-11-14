import { describe, expect, it } from 'vitest';
import type { WindowInfo } from '../../../src/shell';
import {
  BAND, CARD, FRAME, HOTSPOTS, PAD, REACH, SPOT, WALK,
  cardRegions, frameRegion, placeCard, roomGeometry, roomWindow, visibleSpan,
} from '../../../src/views/room/layout';
import { clockHands, hourOf, roomLight, skyAt, timerWedge, wallClock } from '../../../src/views/room/sky';
import { Walker } from '../../../src/views/room/walker';

const info = (y: number, height: number, scale = 1.5): WindowInfo => ({
  kind: 'floating', view: 'room', x: 300, y, width: 612, height, scale, cssWidth: 408, cssHeight: height / scale,
  monitor: { full: { x: 0, y: 0, w: 3840, h: 2160 }, work: { x: 0, y: 0, w: 3840, h: 2088 }, scale }, nativeMs: 0,
});

describe('the Room window', () => {
  it('is the 380 x 464 frame of the spec at Medium, with room for its shadow', () => {
    const g = roomGeometry('medium');
    expect([FRAME.width, FRAME.height]).toEqual([380, 464]);
    expect(g.frame).toMatchObject({ x: PAD.side, w: 380, h: 464 });
    expect(g.window.width).toBe(380 + PAD.side * 2);
  });

  it('comes in three sizes', () => {
    const [small, medium, large] = (['small', 'medium', 'large'] as const).map((size) => roomGeometry(size));
    expect(small!.frame.w).toBeLessThan(medium!.frame.w);
    expect(medium!.frame.w).toBeLessThan(large!.frame.w);
    expect(large!.frame).toMatchObject({ w: 456, h: 557 });
    // The frame's top-left corner stays put when the size changes.
    for (const g of [small!, large!]) expect([g.frame.x, g.frame.y]).toEqual([medium!.frame.x, medium!.frame.y]);
  });

  it('keeps an empty band above and below the frame, tall enough for the Card in every size', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const g = roomGeometry(size);
      expect(g.frame.y).toBe(BAND + PAD.top);
      expect(g.window.height).toBe(BAND * 2 + PAD.top + g.frame.h + PAD.bottom);
      // Hanging from under the title bar, the whole Card is inside the window.
      expect(g.card.y + CARD.room + CARD.edge).toBeLessThanOrEqual(g.window.height);
      // And centred on the frame.
      expect(g.card.x + CARD.width / 2).toBeCloseTo(g.frame.x + g.frame.w / 2, 5);
    }
  });

  it('asks the shell for a floating window that may hang over the screen by exactly that band', () => {
    expect(roomWindow('medium', null)).toEqual({ kind: 'floating', width: 408, height: roomGeometry('medium').window.height, bleed: BAND });
    // A remembered position is handed back untouched.
    expect(roomWindow('small', { x: 1234, y: -77 })).toMatchObject({ kind: 'floating', x: 1234, y: -77, bleed: BAND });
  });

  it('catches the mouse on the frame, and on the Card and its close button when one is open', () => {
    const g = roomGeometry('medium');
    expect(frameRegion(g)).toEqual({ x: 14, y: g.frame.y, w: 380, h: 464, r: 22 });
    const [card, chip] = cardRegions(g, 260, 511);
    expect(card).toEqual({ x: 44, y: 260, w: 320, h: 511, r: 26 });
    expect(chip!.x + chip!.w).toBeGreaterThan(card!.x + card!.w);
    expect(chip!.y).toBeLessThan(card!.y);
  });
});

describe('where the Card goes', () => {
  const g = roomGeometry('medium');
  const height = g.window.height;

  it('hangs under the title bar when the whole of it is on the screen there', () => {
    const span = visibleSpan(info(400, height * 1.5), height);
    expect(span).toEqual({ top: 0, bottom: height });
    expect(placeCard(g, span, 511)).toMatchObject({ top: g.card.y, tight: false });
  });

  it('slides up just far enough when the room sits at the bottom of the screen', () => {
    // The window hangs its lower band over the bottom of the work area.
    const y = 2088 - Math.round((height - BAND) * 1.5);
    const span = visibleSpan(info(y, Math.round(height * 1.5)), height);
    expect(span.bottom).toBeCloseTo(height - BAND, 0);
    const spot = placeCard(g, span, 511);
    expect(spot.top).toBeLessThan(g.card.y);
    expect(spot.top + 511).toBeLessThanOrEqual(span.bottom - CARD.edge + 1);
    expect(spot.tight).toBe(false);
  });

  it('stays below the top of the screen when the room sits at the top', () => {
    const span = visibleSpan(info(-Math.round(BAND * 1.5), Math.round(height * 1.5)), height);
    expect(span.top).toBeCloseTo(BAND, 0);
    expect(placeCard(g, span, 511).top).toBe(g.card.y);
  });

  it('scrolls on a screen too short for it', () => {
    const spot = placeCard(g, { top: 100, bottom: 500 }, 511);
    expect(spot).toMatchObject({ top: 108, tight: true });
    expect(spot.maxHeight).toBe(384);
  });

  it('assumes the whole window is visible when it is told nothing useful', () => {
    expect(visibleSpan(null, 900)).toEqual({ top: 0, bottom: 900 });
    expect(visibleSpan({ ...info(0, 900), scale: 0 }, 900)).toEqual({ top: 0, bottom: 900 });
    // A work area the window is not on at all.
    expect(visibleSpan(info(9000, 900), 600)).toEqual({ top: 0, bottom: 600 });
  });
});

describe('places in the room', () => {
  it('keeps every spot Doozer is sent to within reach', () => {
    for (const x of [SPOT.start, SPOT.bed.x, SPOT.bowl, SPOT.jar, SPOT.window, SPOT.rug, SPOT.books]) {
      expect(x).toBeGreaterThanOrEqual(REACH.min);
      expect(x).toBeLessThanOrEqual(REACH.max);
    }
    // Where it wanders on its own does not include standing on the bed.
    expect(WALK.min).toBeGreaterThan(HOTSPOTS.bed.x + HOTSPOTS.bed.w);
  });

  it('gives every piece of furniture a target inside the 380 x 380 scene', () => {
    for (const box of Object.values(HOTSPOTS)) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.w).toBeLessThanOrEqual(380);
      expect(box.y + box.h).toBeLessThanOrEqual(380);
      expect(Math.min(box.w, box.h)).toBeGreaterThanOrEqual(30);
    }
  });
});

describe('the sky', () => {
  it('has a sun by day and a moon and stars by night', () => {
    const noon = skyAt(12);
    expect(noon).toMatchObject({ light: 1, stars: 0, phase: 'day' });
    expect(noon.sun.visible).toBe(true);
    expect(noon.moon.opacity).toBe(0);

    const night = skyAt(23.5);
    expect(night).toMatchObject({ light: 0, stars: 1, phase: 'night' });
    expect(night.sun.visible).toBe(false);
    expect(night.moon.opacity).toBe(1);
  });

  it('passes through dawn and dusk', () => {
    expect(skyAt(6.2).phase).toBe('dawn');
    expect(skyAt(17.9).phase).toBe('dusk');
    expect(skyAt(6.2).light).toBeGreaterThan(0);
    expect(skyAt(6.2).light).toBeLessThan(1);
    // Dusk is warm, night is dark blue, noon is light blue.
    expect(skyAt(18.5).top).toBe('rgb(255,154,118)');
    expect(skyAt(0).top).toBe('rgb(12,18,48)');
    expect(skyAt(12).top).not.toBe(skyAt(0).top);
  });

  it('carries the sun across the pane and highest at noon', () => {
    expect(skyAt(8).sun.x).toBeLessThan(skyAt(12).sun.x);
    expect(skyAt(12).sun.x).toBeLessThan(skyAt(16).sun.x);
    expect(skyAt(12).sun.y).toBeLessThan(skyAt(8).sun.y);
    expect(skyAt(12).sun.y).toBeLessThan(skyAt(16).sun.y);
  });

  it('copes with any hour it is handed', () => {
    for (const hour of [-3, 24, 49.5, Number.NaN, Infinity]) {
      const sky = skyAt(hour);
      expect(sky.light).toBeGreaterThanOrEqual(0);
      expect(sky.light).toBeLessThanOrEqual(1);
      expect(sky.top).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    }
    expect(skyAt(24).top).toBe(skyAt(0).top);
  });

  it('moves the clouds a few pixels a minute at most', () => {
    for (let minute = 0; minute < 24 * 60; minute += 7) {
      const a = skyAt(minute / 60).drift;
      const b = skyAt((minute + 1) / 60).drift;
      for (const i of [0, 1] as const) {
        const step = Math.abs(b[i] - a[i]);
        // Either a small step, or the cloud going round to start again.
        expect(step < 6 || step > 200).toBe(true);
      }
    }
  });

  it('reads the hour off a date', () => {
    expect(hourOf(new Date(2026, 10, 13, 18, 30, 0))).toBe(18.5);
    expect(wallClock(new Date(2026, 10, 13, 0, 5))).toBe('12:05 AM');
    expect(wallClock(new Date(2026, 10, 13, 15, 42))).toBe('3:42 PM');
    expect(clockHands(new Date(2026, 10, 13, 15, 30))).toEqual({ hour: 105, minute: 180 });
  });
});

describe('the light in the room', () => {
  it('follows the sky and the lamp', () => {
    expect(roomLight(1, true)).toEqual({ dark: 0, glow: 0.18 });
    const night = roomLight(0, true);
    expect(night.dark).toBeGreaterThan(0);
    expect(night.glow).toBeGreaterThan(0.5);
    // Lamp off: no glow, and dim even at noon.
    expect(roomLight(1, false)).toEqual({ dark: 0.3, glow: 0 });
    expect(roomLight(0, false).dark).toBeGreaterThan(night.dark);
  });
});

describe('the clock as a timer', () => {
  it('shows the time left as a slice of an hour', () => {
    expect(timerWedge(25 * 60_000, 100, 100, 10).degrees).toBe(150);
    expect(timerWedge(15 * 60_000, 100, 100, 10)).toEqual({ degrees: 90, d: 'M100 100V90A10 10 0 0 1 110 100Z' });
    expect(timerWedge(50 * 60_000, 100, 100, 10).d).toContain('A10 10 0 1 1');
    expect(timerWedge(0, 100, 100, 10)).toEqual({ degrees: 0, d: '' });
    expect(timerWedge(90 * 60_000, 100, 100, 10).degrees).toBe(360);
  });
});

describe('walking', () => {
  function rig(x = 100) {
    let t = 0;
    const drawn: [number, number][] = [];
    const walker = new Walker({ x, now: () => t, apply: (at, ms) => drawn.push([at, ms]), min: 60, max: 330 });
    return { walker, drawn, pass: (ms: number) => { t += ms; } };
  }

  it('is somewhere between here and there while a walk is on', () => {
    const r = rig(100);
    expect(r.walker.walkTo(200, 50)).toBe(2000);
    expect(r.walker.moving).toBe(true);
    r.pass(500);
    expect(r.walker.x).toBe(125);
    r.pass(1500);
    expect(r.walker.x).toBe(200);
    expect(r.walker.moving).toBe(false);
    r.pass(60_000);
    expect(r.walker.x).toBe(200);
  });

  it('draws a walk as one move from where Doozer is', () => {
    const r = rig(100);
    r.drawn.length = 0;
    r.walker.walkTo(200, 50);
    expect(r.drawn).toEqual([[100, 0], [200, 2000]]);
  });

  it('stops exactly where it has got to', () => {
    const r = rig(100);
    r.walker.walkTo(300, 100);
    r.pass(700);
    r.walker.stop();
    expect(r.walker.x).toBe(170);
    expect(r.walker.moving).toBe(false);
    expect(r.drawn.at(-1)).toEqual([170, 0]);
    r.pass(5000);
    expect(r.walker.x).toBe(170);
  });

  it('starts a new walk from the middle of an old one', () => {
    const r = rig(100);
    r.walker.walkTo(300, 100);
    r.pass(1000);
    expect(r.walker.walkTo(100, 100)).toBe(1000);
    r.pass(500);
    expect(r.walker.x).toBe(150);
  });

  it('never leaves the room', () => {
    const r = rig(100);
    r.walker.walkTo(9000, 100);
    expect(r.walker.target).toBe(330);
    r.walker.place(-50);
    expect(r.walker.x).toBe(60);
    r.walker.place(Number.NaN);
    expect(r.walker.x).toBe(60);
    expect(r.walker.walkTo(200, 0)).toBe(0);
    expect(r.walker.x).toBe(200);
  });
});
