import { describe, expect, it, vi } from 'vitest';
import { ballAtRest, kickBall, restBall, stepBall, type Ball, type BallBounds } from '../../../src/views/desktop/ball';
import { floatMs, motionAt, type Motion } from '../../../src/views/desktop/motion';
import { NamedTimers } from '../../../src/views/desktop/named-timers';
import { LONGEST_PEEK_WALK_MS, PACES, SHORTEST_WALK_PX, paceFor, peekEdge, strollTarget, walkMs, within } from '../../../src/views/desktop/pace';
import type { Stage } from '../../../src/views/desktop/stage';
import { seeded } from '../../core/helpers';

const STAGE: Stage = { w: 2560, h: 1392, size: 112, ground: 1386, minX: 62, maxX: 2498, taskbar: 'bottom', monitor: 'test' };

describe('the pace levels, as numbers', () => {
  it('Calm is the spec\'s: a stroll every 45-120 s, at most 300 px, about 30 px a second, a peek about every ten minutes', () => {
    const calm = PACES.calm;
    expect(calm.strolls).toBe(true);
    expect(calm.rest).toEqual([45_000, 120_000]);
    expect(calm.strollPx[1]).toBe(300);
    expect(calm.roamPx).toBe(300);
    expect(calm.strollSpeed).toBe(30);
    expect(calm.strollGait).toBe('walk');
    expect((calm.peekEvery![0] + calm.peekEvery![1]) / 2).toBe(10 * 60_000);
    expect(calm.chasesBall).toBe(false);
    expect(calm.runsToFood).toBe(false);
  });

  it('Lively trots, at the mockup\'s speeds for the peek, the food and the chase', () => {
    const lively = PACES.lively;
    expect([lively.peekSpeed, lively.foodSpeed, lively.chaseSpeed]).toEqual([70, 95, 150]);
    // The mockup strolled at 46 px/s; the rig's trot would slide at that, so it is a little quicker.
    expect(lively.strollSpeed).toBe(56);
    expect(lively.strollGait).toBe('trot');
    expect(lively.rest[1]).toBeLessThan(5000);
    expect(lively.roamPx).toBeNull();
    expect(lively.chasesBall).toBe(true);
    expect(lively.runsToFood).toBe(true);
  });

  it('Still never moves on its own', () => {
    expect(PACES.still.strolls).toBe(false);
    expect(PACES.still.peekEvery).toBeNull();
    const random = seeded(1);
    for (let i = 0; i < 100; i++) expect(strollTarget(PACES.still, STAGE, 1000, 1000, random)).toBeNull();
    expect(peekEdge(PACES.still, STAGE, 1000)).toBeNull();
  });

  it('an unknown pace is Calm', () => {
    expect(paceFor('brisk' as never)).toBe(PACES.calm);
  });

  it('picks a value inside a range', () => {
    const random = seeded(4);
    for (let i = 0; i < 200; i++) {
      const v = within([45_000, 120_000], random);
      expect(v).toBeGreaterThanOrEqual(45_000);
      expect(v).toBeLessThan(120_000);
    }
  });
});

describe('where a stroll goes', () => {
  it('Calm: 60 to 300 px away, on the line, never further than 300 px from the spot', () => {
    const random = seeded(7);
    const home = 1200;
    let x = home;
    let farthest = 0;
    for (let i = 0; i < 2000; i++) {
      const target = strollTarget(PACES.calm, STAGE, x, home, random);
      if (target === null) continue;
      expect(Math.abs(target - x)).toBeGreaterThanOrEqual(SHORTEST_WALK_PX);
      expect(Math.abs(target - x)).toBeLessThanOrEqual(300);
      expect(Math.abs(target - home)).toBeLessThanOrEqual(300);
      farthest = Math.max(farthest, Math.abs(target - home));
      x = target;
    }
    // It uses the room it has.
    expect(farthest).toBeGreaterThan(250);
  });

  it('Calm: next to the edge of the screen it turns back', () => {
    const random = seeded(9);
    for (let i = 0; i < 200; i++) {
      const target = strollTarget(PACES.calm, STAGE, 62, 62, random);
      expect(target).not.toBeNull();
      expect(target!).toBeGreaterThan(62);
      expect(target!).toBeLessThanOrEqual(362);
    }
  });

  it('Lively: anywhere along the line', () => {
    const random = seeded(3);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < 500; i++) {
      const target = strollTarget(PACES.lively, STAGE, 1280, 1280, random);
      if (target === null) continue;
      expect(target).toBeGreaterThanOrEqual(62);
      expect(target).toBeLessThanOrEqual(2498);
      lo = Math.min(lo, target);
      hi = Math.max(hi, target);
    }
    expect(lo).toBeLessThan(200);
    expect(hi).toBeGreaterThan(2300);
  });

  it('nowhere to go on a stage with no room', () => {
    const narrow: Stage = { ...STAGE, w: 100, minX: 50, maxX: 50 };
    const random = seeded(2);
    expect(strollTarget(PACES.calm, narrow, 50, 50, random)).toBeNull();
    expect(strollTarget(PACES.lively, narrow, 50, 50, random)).toBeNull();
  });
});

describe('which edge a peek goes to', () => {
  it('the nearer one', () => {
    expect(peekEdge(PACES.calm, STAGE, 400)).toBe(-1);
    expect(peekEdge(PACES.calm, STAGE, 2200)).toBe(1);
  });

  it('none when the edge is too far to walk to', () => {
    const wide: Stage = { ...STAGE, w: 7680, maxX: 7618 };
    expect(walkMs(3840, PACES.calm.peekSpeed)).toBeGreaterThan(LONGEST_PEEK_WALK_MS);
    expect(peekEdge(PACES.calm, wide, 3840)).toBeNull();
    expect(peekEdge(PACES.calm, wide, 600)).toBe(-1);
  });
});

describe('a move, as a function of time', () => {
  const walk: Motion = { kind: 'walk', x0: 100, y0: 500, x1: 400, y1: 500, t0: 1000, ms: 10_000 };

  it('a walk goes at a steady speed and ends exactly on its target', () => {
    expect(motionAt(walk, 1000)).toEqual({ x: 100, y: 500, done: false });
    expect(motionAt(walk, 6000)).toEqual({ x: 250, y: 500, done: false });
    expect(motionAt(walk, 11_000)).toEqual({ x: 400, y: 500, done: true });
    expect(motionAt(walk, 99_000)).toEqual({ x: 400, y: 500, done: true });
    // Before it began (a clock that went backwards) it is at its start.
    expect(motionAt(walk, 0)).toEqual({ x: 100, y: 500, done: false });
  });

  it('a float drifts down gently: slow away, slow in, never back up, a little sway', () => {
    const float: Motion = { kind: 'float', x0: 800, y0: 300, x1: 800, y1: 1386, t0: 0, ms: floatMs(0, 1086) };
    let last = 300;
    let widest = 0;
    let fastest = 0;
    for (let t = 0; t <= float.ms; t += 16) {
      const at = motionAt(float, t);
      expect(at.y).toBeGreaterThanOrEqual(last - 1e-9);
      fastest = Math.max(fastest, ((at.y - last) / 16) * 1000);
      widest = Math.max(widest, Math.abs(at.x - 800));
      last = at.y;
    }
    expect(motionAt(float, float.ms)).toEqual({ x: 800, y: 1386, done: true });
    expect(widest).toBeGreaterThan(2);
    expect(widest).toBeLessThanOrEqual(7);
    // A drift, not a drop: well under a screen a second.
    expect(fastest).toBeLessThan(800);
    // It starts and ends slowly.
    expect(motionAt(float, 16).y - 300).toBeLessThan(2);
    expect(1386 - motionAt(float, float.ms - 16).y).toBeLessThan(2);
  });

  it('a float takes between half a second and two and a half, longer from higher up', () => {
    expect(floatMs(0, 0)).toBe(0);
    expect(floatMs(0, 10)).toBe(420);
    expect(floatMs(0, 300)).toBe(960);
    expect(floatMs(0, 1200)).toBe(2400);
    expect(floatMs(300, 400)).toBe(1400);
  });

  it('a move with no time, or nonsense for a clock, is simply over', () => {
    expect(motionAt({ ...walk, ms: 0 }, 1000).done).toBe(true);
    expect(motionAt(walk, Number.NaN)).toEqual({ x: 400, y: 500, done: true });
  });
});

describe('the ball', () => {
  const bounds: BallBounds = { left: 0, right: 2560, top: 0, ground: 1386 };
  const drop = (): Ball => ({ x: 1000, y: 900, vx: 300, vy: 0, r: 18, spin: 0 });

  it('falls, bounces lower each time, and comes to rest on the line', () => {
    const ball = drop();
    let highestAfterFirstBounce = Infinity;
    let bounced = false;
    for (let i = 0; i < 2000 && !ballAtRest(ball, bounds); i++) {
      bounced = stepBall(ball, 1 / 60, bounds) || bounced;
      if (bounced) highestAfterFirstBounce = Math.min(highestAfterFirstBounce, ball.y);
      expect(ball.y).toBeLessThanOrEqual(bounds.ground - ball.r + 1e-6);
    }
    expect(ballAtRest(ball, bounds)).toBe(true);
    expect(bounced).toBe(true);
    // It never bounces back as high as it was dropped from.
    expect(highestAfterFirstBounce).toBeGreaterThan(900);
    expect(ball.y).toBe(bounds.ground - ball.r);
  });

  it('stays on the screen however hard it is kicked', () => {
    const random = seeded(5);
    const ball = drop();
    for (let i = 0; i < 4000; i++) {
      if (i % 40 === 0) kickBall(ball, i % 80 === 0 ? 1 : -1, 1, random);
      stepBall(ball, 1 / 60, bounds);
      expect(ball.x).toBeGreaterThanOrEqual(ball.r);
      expect(ball.x).toBeLessThanOrEqual(bounds.right - ball.r);
      expect(ball.y).toBeGreaterThanOrEqual(ball.r);
      expect(ball.y).toBeLessThanOrEqual(bounds.ground - ball.r + 1e-6);
    }
  });

  it('a kick at full power is the mockup\'s: 260-520 px/s across, 620-900 up', () => {
    const random = seeded(8);
    for (let i = 0; i < 100; i++) {
      const ball = drop();
      kickBall(ball, i % 2 ? 1 : -1, 1, random);
      expect(Math.abs(ball.vx)).toBeGreaterThanOrEqual(260);
      expect(Math.abs(ball.vx)).toBeLessThanOrEqual(520);
      expect(-ball.vy).toBeGreaterThanOrEqual(620);
      expect(-ball.vy).toBeLessThanOrEqual(900);
      expect(Math.sign(ball.vx)).toBe(i % 2 ? 1 : -1);
    }
  });

  it('behaves the same in one long step as in many short ones', () => {
    const a = drop();
    const b = drop();
    stepBall(a, 0.2, bounds);
    for (let i = 0; i < 24; i++) stepBall(b, 0.2 / 24, bounds);
    expect(a.x).toBeCloseTo(b.x, 3);
    expect(a.y).toBeCloseTo(b.y, 3);
  });

  it('a stalled page or nonsense numbers cannot throw it away', () => {
    const ball = drop();
    stepBall(ball, 9999, bounds);
    expect(ball.y).toBeLessThanOrEqual(bounds.ground - ball.r + 1e-6);
    stepBall(ball, Number.NaN, bounds);
    ball.vx = Number.NaN;
    ball.x = Number.POSITIVE_INFINITY;
    stepBall(ball, 1 / 60, bounds);
    expect(ballAtRest(ball, bounds)).toBe(true);
    expect(Number.isFinite(ball.x)).toBe(true);
    restBall(ball, bounds);
    expect(ball.y).toBe(bounds.ground - ball.r);
  });
});

describe('named timers', () => {
  it('one timer per name: arming again replaces it', () => {
    vi.useFakeTimers();
    const clock = new NamedTimers({ set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) });
    const fired: string[] = [];
    clock.arm('a', 100, () => fired.push('first'));
    clock.arm('a', 200, () => fired.push('second'));
    clock.arm('b', 50, () => fired.push('b'));
    expect(clock.names().sort()).toEqual(['a', 'b']);
    vi.advanceTimersByTime(150);
    expect(fired).toEqual(['b']);
    expect(clock.has('b')).toBe(false);
    vi.advanceTimersByTime(100);
    expect(fired).toEqual(['b', 'second']);
    expect(clock.names()).toEqual([]);
    vi.useRealTimers();
  });

  it('a timer may arm its own name again; clear and dispose stop everything', () => {
    vi.useFakeTimers();
    const clock = new NamedTimers({ set: (fn, ms) => setTimeout(fn, ms), clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>) });
    let ticks = 0;
    const again = (): void => { ticks++; clock.arm('tick', 10, again); };
    clock.arm('tick', 10, again);
    vi.advanceTimersByTime(55);
    expect(ticks).toBe(5);
    clock.clear();
    vi.advanceTimersByTime(100);
    expect(ticks).toBe(5);
    clock.arm('tick', 10, again);
    clock.dispose();
    clock.arm('late', 10, () => { ticks += 100; });
    vi.advanceTimersByTime(100);
    expect(ticks).toBe(5);
    expect(clock.names()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
