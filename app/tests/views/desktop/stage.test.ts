import { describe, expect, it } from 'vitest';
import type { WindowInfo } from '../../../src/shell';
import {
  HIT, SIZE_PX, boxAt, carryAt, clipRegion, defaultSpot, hitRegion, monitorKey, panelPlace, radialAnchor, radialArc, readSpots,
  spotOn, spotsDocument, stageFor, standAt, taskbarEdge, withSpot, type Spots,
} from '../../../src/views/desktop/stage';

const info = (full: [number, number, number, number], work: [number, number, number, number], scale = 1): WindowInfo => {
  const f = { x: full[0], y: full[1], w: full[2], h: full[3] };
  const w = { x: work[0], y: work[1], w: work[2], h: work[3] };
  const hidden = f.w === w.w && f.h === w.h;
  const height = hidden ? w.h - 1 : w.h;
  return {
    kind: 'overlay', view: 'desktop', x: w.x, y: w.y, width: w.w, height, scale,
    cssWidth: w.w / scale, cssHeight: height / scale, monitor: { full: f, work: w, scale }, nativeMs: 0,
  };
};

const UHD = info([0, 0, 3840, 2160], [0, 0, 3840, 2088], 1.5);

describe('where the taskbar is', () => {
  it('is read from what the work area leaves of the monitor', () => {
    const full = { x: 0, y: 0, w: 1920, h: 1080 };
    expect(taskbarEdge(full, { x: 0, y: 0, w: 1920, h: 1032 })).toBe('bottom');
    expect(taskbarEdge(full, { x: 0, y: 48, w: 1920, h: 1032 })).toBe('top');
    expect(taskbarEdge(full, { x: 62, y: 0, w: 1858, h: 1080 })).toBe('left');
    expect(taskbarEdge(full, { x: 0, y: 0, w: 1858, h: 1080 })).toBe('right');
    expect(taskbarEdge(full, full)).toBe('hidden');
  });

  it('works on a monitor that does not start at zero', () => {
    const full = { x: -1920, y: 200, w: 1920, h: 1080 };
    expect(taskbarEdge(full, { x: -1920, y: 200, w: 1920, h: 1040 })).toBe('bottom');
    expect(taskbarEdge(full, { x: -1850, y: 200, w: 1850, h: 1080 })).toBe('left');
  });

  it('with bars on two edges the bigger one is the taskbar', () => {
    const full = { x: 0, y: 0, w: 1920, h: 1080 };
    expect(taskbarEdge(full, { x: 0, y: 30, w: 1920, h: 1002 })).toBe('bottom');
    expect(taskbarEdge(full, { x: 0, y: 60, w: 1920, h: 990 })).toBe('top');
  });
});

describe('the stage', () => {
  it('is the work area in CSS pixels, with the ground line a few pixels above its bottom edge', () => {
    const stage = stageFor(UHD, 112);
    expect(stage).toEqual({ w: 2560, h: 1392, size: 112, ground: 1386, minX: 62, maxX: 2498, taskbar: 'bottom', monitor: '3840x2160@0,0' });
    // The shadow under the feet ends inside the window.
    expect(stage.ground + 112 * (195 / 200 - 0.93)).toBeLessThanOrEqual(stage.h);
  });

  it('puts the line on the bottom of the work area wherever the taskbar is', () => {
    const full: [number, number, number, number] = [0, 0, 1920, 1080];
    for (const [work, h] of [
      [[0, 0, 1920, 1032], 1032], [[0, 48, 1920, 1032], 1032], [[62, 0, 1858, 1080], 1080], [[0, 0, 1858, 1080], 1080], [[0, 0, 1920, 1080], 1079],
    ] as [[number, number, number, number], number][]) {
      const stage = stageFor(info(full, work), 112);
      expect(stage.h).toBe(h);
      expect(stage.ground).toBe(h - 6);
    }
  });

  it('scales the line and the margins with Doozer\'s size', () => {
    expect(stageFor(UHD, SIZE_PX.small)).toMatchObject({ ground: 1387, minX: 60, maxX: 2500 });
    expect(stageFor(UHD, SIZE_PX.large)).toMatchObject({ ground: 1385, minX: 75, maxX: 2485 });
  });

  it('survives a window too narrow to walk in', () => {
    const stage = stageFor(info([0, 0, 100, 400], [0, 0, 100, 360]), 112);
    expect(stage.minX).toBe(50);
    expect(stage.maxX).toBe(50);
    expect(standAt(stage, 900)).toBe(50);
  });

  it('can be told the page\'s real size when there is no shell to say', () => {
    expect(stageFor(UHD, 112, { w: 800, h: 560 })).toMatchObject({ w: 800, h: 560, ground: 554 });
  });

  it('names a monitor by its size and place among the others', () => {
    expect(monitorKey({ x: 3840, y: -200, w: 1920, h: 1080 })).toBe('1920x1080@3840,-200');
  });
});

describe('standing and being carried', () => {
  const stage = stageFor(UHD, 112);

  it('keeps Doozer where it may stand, and gives the default spot for nonsense', () => {
    expect(standAt(stage, -50)).toBe(62);
    expect(standAt(stage, 99_999)).toBe(2498);
    expect(standAt(stage, 1000.5)).toBe(1000.5);
    expect(standAt(stage, Number.NaN)).toBe(defaultSpot(stage));
    expect(defaultSpot(stage)).toBe(1843);
  });

  it('lets Doozer be carried anywhere it stays whole on the screen, never below the line', () => {
    expect(carryAt(stage, 1000, 500)).toEqual({ x: 1000, y: 500 });
    expect(carryAt(stage, -900, -900).x).toBeCloseTo(112 * 0.36);
    expect(carryAt(stage, -900, -900).y).toBeCloseTo(112 * 0.81 + 2);
    expect(carryAt(stage, 99_999, 99_999)).toEqual({ x: 2560 - 112 * 0.36, y: 1386 });
    expect(carryAt(stage, Number.NaN, Number.POSITIVE_INFINITY)).toEqual({ x: defaultSpot(stage), y: 1386 });
  });

  it('even carried to the top corner, all of the hit area is on the screen', () => {
    for (const [x, y] of [[-9999, -9999], [9999, -9999], [-9999, 9999], [9999, 9999]] as const) {
      const at = carryAt(stage, x, y);
      const region = hitRegion(112, at.x, at.y);
      expect(region.x).toBeGreaterThanOrEqual(0);
      expect(region.y).toBeGreaterThanOrEqual(0);
      expect(region.x + region.w).toBeLessThanOrEqual(stage.w);
      expect(region.y + region.h).toBeLessThanOrEqual(stage.h);
    }
  });
});

describe('what catches the mouse', () => {
  it('is the body, ears and tuft: 70 % by 84 % of the sprite, with rounded corners', () => {
    const region = hitRegion(112, 1000, 1386);
    const box = boxAt(112, 1000, 1386);
    expect(box).toEqual({ left: 944, top: 1386 - 112 * 0.93 });
    expect(region.x).toBeCloseTo(944 + 112 * HIT.left);
    expect(region.y).toBeCloseTo(box.top + 112 * HIT.top);
    expect(region.w).toBeCloseTo(78.4);
    expect(region.h).toBeCloseTo(94.08);
    expect(region.r).toBeCloseTo(35.84);
    // It ends a few pixels below the soles and inside a window whose bottom is 6 px below them.
    expect(region.y + region.h - 1386).toBeCloseTo(3.36);
  });

  it('is clipped to the window, and gone when none of it is inside', () => {
    const whole = { x: 100, y: 100, w: 80, h: 90, r: 30 };
    expect(clipRegion(whole, 2560, 1392)).toBe(whole);
    expect(clipRegion({ x: -40, y: 100, w: 80, h: 90, r: 30 }, 2560, 1392)).toEqual({ x: 0, y: 100, w: 40, h: 90, r: 20 });
    expect(clipRegion({ x: 2520, y: 1350, w: 80, h: 90, r: 30 }, 2560, 1392)).toEqual({ x: 2520, y: 1350, w: 40, h: 42, r: 20 });
    expect(clipRegion({ x: -200, y: 100, w: 80, h: 90, r: 30 }, 2560, 1392)).toBeNull();
    expect(clipRegion({ x: 2559.6, y: 100, w: 80, h: 90 }, 2560, 1392)).toBeNull();
  });

  it('puts the Radial at the middle of Doozer', () => {
    expect(radialAnchor(112, 1000, 1386)).toEqual({ x: 1000, y: 1386 - 112 * 0.93 + 112 * 0.52 });
  });
});

describe('the Radial near the edges of the screen', () => {
  const stage = stageFor(UHD, 112);

  it('opens straight up in the open, and leans away from a near edge', () => {
    expect(radialArc(stage, 1280)).toEqual({ center: -90, span: 200 });
    expect(radialArc(stage, 62)).toEqual({ center: -50, span: 100 });
    expect(radialArc(stage, 2498)).toEqual({ center: -130, span: 100 });
    expect(radialArc(stage, 140)).toEqual({ center: -90, span: 200 });
  });

  it('keeps every button on the screen wherever Doozer may stand', () => {
    for (const each of [stage, stageFor(UHD, SIZE_PX.small), stageFor(UHD, SIZE_PX.large), stageFor(info([0, 0, 800, 600], [0, 0, 800, 560]), 112)]) {
      for (let x = each.minX; x <= each.maxX; x += 7) {
        const arc = radialArc(each, x);
        const anchor = radialAnchor(each.size, x, each.ground);
        const step = arc.span / 5;
        // The kit widens the radius when a narrow arc would make the buttons touch (kit.css).
        const radius = Math.max(94, (50 + 8) / (2 * Math.sin((step * Math.PI) / 360)));
        for (let i = 0; i < 6; i++) {
          const angle = ((arc.center - arc.span / 2 + step * i) * Math.PI) / 180;
          const cx = anchor.x + Math.cos(angle) * radius;
          const cy = anchor.y + Math.sin(angle) * radius;
          expect(cx - 25, `x ${x}, button ${i}`).toBeGreaterThanOrEqual(0);
          expect(cx + 25, `x ${x}, button ${i}`).toBeLessThanOrEqual(each.w);
          expect(cy - 25, `x ${x}, button ${i}`).toBeGreaterThanOrEqual(0);
          expect(cy + 25, `x ${x}, button ${i}`).toBeLessThanOrEqual(each.h);
        }
      }
    }
  });
});

describe('where the Card goes', () => {
  const stage = stageFor(UHD, 112);
  const card = { w: 320, h: 540 };

  it('sits over Doozer\'s head, centred on it', () => {
    const place = panelPlace(stage, 1000, stage.ground, card);
    expect(place.left).toBe(840);
    expect(place.top + 540).toBeLessThan(stage.ground - 112 * 0.8);
    expect(place.top + 540).toBeGreaterThan(stage.ground - 112 * 0.81 - 20);
    expect(place.origin).toBe('160px calc(100% + 20px)');
  });

  it('stays on the screen near a side', () => {
    expect(panelPlace(stage, 62, stage.ground, card).left).toBe(10);
    expect(panelPlace(stage, 2498, stage.ground, card).left).toBe(2560 - 320 - 10);
  });

  it('goes beside Doozer on a screen too short to fit it above', () => {
    const short = stageFor(info([0, 0, 1366, 620], [0, 0, 1366, 580]), 112);
    const place = panelPlace(short, 600, short.ground, card);
    expect(place.top).toBeGreaterThanOrEqual(10);
    expect(place.top + 540).toBeLessThanOrEqual(580);
    // To the right, clear of Doozer.
    expect(place.left).toBeGreaterThanOrEqual(600 + 112 * 0.35);
    // On the left when the right has no room.
    const leftward = panelPlace(short, 1250, short.ground, card);
    expect(leftward.left + 320).toBeLessThanOrEqual(1250 - 112 * 0.35);
  });

  it('never lets the Card be taller than the screen', () => {
    const tiny = stageFor(info([0, 0, 800, 420], [0, 0, 800, 380]), 112);
    const place = panelPlace(tiny, 400, tiny.ground, card);
    expect(place.maxHeight).toBe(360);
    expect(place.top).toBe(10);
  });
});

describe('the spot remembered on each monitor', () => {
  const stage = stageFor(UHD, 112);

  it('is kept as how far across the screen Doozer stood', () => {
    const spots = withSpot({}, stage, 640, 1000);
    expect(spots).toEqual({ '3840x2160@0,0': { f: 0.25, t: 1000 } });
    expect(spotOn(spots, stage)).toBe(640);
    // The same monitor at another scaling: the same place across it.
    expect(spotOn(spots, stageFor(info([0, 0, 3840, 2160], [0, 0, 3840, 2088], 1), 112))).toBe(960);
  });

  it('gives the default spot on a monitor never seen before', () => {
    const other = stageFor(info([3840, 0, 1920, 1080], [3840, 0, 1920, 1040]), 112);
    expect(spotOn(withSpot({}, stage, 640, 1), other)).toBe(defaultSpot(other));
  });

  it('goes through the save and back', () => {
    const spots = withSpot(withSpot({}, stage, 640, 1), stageFor(info([3840, 0, 1920, 1080], [3840, 0, 1920, 1040]), 112), 1500, 2);
    expect(readSpots(JSON.parse(JSON.stringify(spotsDocument(spots))))).toEqual(spots);
  });

  it('drops anything unusable, and never throws', () => {
    for (const raw of [undefined, null, 3, 'spots', [], { spots: null }, { spots: [1] }, { spots: { a: null, b: 4, c: { f: 'x' }, d: { f: -0.1 }, e: { f: 1.5 }, g: { f: Number.NaN } } }]) {
      expect(readSpots(raw)).toEqual({});
    }
    expect(readSpots({ spots: { a: { f: 0.5 }, b: { f: 0, t: 'soon' } } })).toEqual({ a: { f: 0.5, t: 0 }, b: { f: 0, t: 0 } });
  });

  it('remembers the eight monitors seen most recently, and no more', () => {
    let spots: Spots = {};
    for (let i = 0; i < 12; i++) spots = withSpot(spots, stageFor(info([i * 1920, 0, 1920, 1080], [i * 1920, 0, 1920, 1040]), 112), 500 + i, i);
    expect(Object.keys(spots)).toHaveLength(8);
    expect(spots['1920x1080@0,0']).toBeUndefined();
    expect(spots['1920x1080@21120,0']).toEqual({ f: Math.round((511 / 1920) * 10_000) / 10_000, t: 11 });
  });
});
