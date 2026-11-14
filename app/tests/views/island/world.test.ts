// What happens on the island as numbers (src/views/island/world.ts), and the frame loop
// that draws it only while something moves (loop.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BodyMotion } from '../../../src/character/body-motion';
import { EXPRESSIONS } from '../../../src/character/expressions';
import { HOME, ISLAND, groundY } from '../../../src/views/island/layout';
import { FALLBACK_MS, FrameLoop } from '../../../src/views/island/loop';
import { BALL_LIMIT_S, BALL_RADIUS, World } from '../../../src/views/island/world';
import { seeded } from '../../core/helpers';

const FRAME = 1 / 60;

function setup(options: ConstructorParameters<typeof World>[0] = {}) {
  const body = new BodyMotion({ random: seeded(2) });
  body.setLook({ expression: 'content', pose: EXPRESSIONS.content.pose, tuft: 0 });
  body.setLive(false);
  body.settle();
  const world = new World({ random: seeded(4), ...options });
  const run = (seconds: number): void => { for (let t = 0; t < seconds; t += FRAME) { world.update(FRAME, body); body.update(FRAME); } };
  const rest = (limit = 20): number => {
    let t = 0;
    while ((world.moving || body.moving) && t < limit) { world.update(FRAME, body); body.update(FRAME); t += FRAME; }
    return t;
  };
  return { world, body, run, rest };
}

describe('Doozer\'s trips across the island', () => {
  it('starts at home, at rest', () => {
    const { world } = setup();
    expect(world.doozer).toEqual({ x: HOME.x, z: HOME.z });
    expect(world.moving).toBe(false);
  });

  it('gets there in hops and says so', async () => {
    const { world, body, rest } = setup();
    let arrived: boolean | null = null;
    void world.travelTo(0.8, 0.5).then((result) => { arrived = result; });
    expect(world.travelling).toBe(true);
    let hops = 0;
    let wasGrounded = true;
    let t = 0;
    while (world.travelling && t < 10) {
      world.update(FRAME, body); body.update(FRAME); t += FRAME;
      if (wasGrounded && !body.grounded) hops++;
      wasGrounded = body.grounded;
    }
    await Promise.resolve();
    expect(arrived).toBe(true);
    expect(hops).toBeGreaterThanOrEqual(2);
    expect(t).toBeLessThan(2.5);
    expect(Math.hypot(world.doozer.x - 0.8, world.doozer.z - 0.5)).toBeLessThan(0.12);
    expect(rest()).toBeLessThan(3);
    expect(body.pose.yaw).toBeCloseTo(0, 2);       // facing front again
  });

  it('faces the way it is going', () => {
    const { world, body, run } = setup();
    void world.travelTo(-1, HOME.z);
    run(0.5);
    expect(body.pose.yaw).toBeLessThan(-0.5);
  });

  it('never leaves the island, wherever it is sent', async () => {
    const { world, rest } = setup();
    void world.travelTo(40, -40);
    rest();
    expect(Math.hypot(world.doozer.x, world.doozer.z)).toBeLessThanOrEqual(ISLAND.reach + 0.12);
    void world.travelTo(Number.NaN, Number.POSITIVE_INFINITY);
    rest();
    expect(Number.isFinite(world.doozer.x) && Number.isFinite(world.doozer.z)).toBe(true);
  });

  it('a new trip settles the old one as not arrived', async () => {
    const { world, run } = setup();
    const outcomes: string[] = [];
    void world.travelTo(1, 0.5).then((arrived) => outcomes.push(`first:${arrived}`));
    run(0.3);
    void world.travelTo(-1, 0.5).then((arrived) => outcomes.push(`second:${arrived}`));
    await Promise.resolve();
    expect(outcomes).toEqual(['first:false']);
    world.stopTravel();
    await Promise.resolve();
    expect(outcomes).toEqual(['first:false', 'second:false']);
    expect(world.travelling).toBe(false);
  });

  it('can be put at the end of its trip at once', async () => {
    const { world } = setup();
    let arrived: boolean | null = null;
    void world.travelTo(0.6, 0.6).then((result) => { arrived = result; });
    world.arriveNow();
    await Promise.resolve();
    expect(arrived).toBe(true);
    expect(world.doozer).toEqual({ x: 0.6, z: 0.6 });
    world.arriveNow();                             // nothing to do, nothing thrown
  });

  it('with motion reduced it is placed rather than hopped', async () => {
    const { world, body } = setup();
    world.setReduceMotion(true);
    body.setReduceMotion(true);
    let arrived: boolean | null = null;
    void world.travelTo(0.5, 0.2).then((result) => { arrived = result; });
    await Promise.resolve();
    expect(arrived).toBe(true);
    expect(world.doozer).toEqual({ x: 0.5, z: 0.2 });
    expect(world.travelling).toBe(false);
  });
});

describe('the snack', () => {
  it('falls, bounces once and lies on the grass', () => {
    const thuds: string[] = [];
    const { world, body, rest } = setup({ onThud: (what) => thuds.push(what) });
    const snack = world.dropSnack('apple', 0.9, 0.5);
    expect(snack.y).toBeGreaterThan(3);
    expect(world.moving).toBe(true);
    expect(rest()).toBeLessThan(2);
    expect(snack.landed).toBe(true);
    expect(snack.y).toBeCloseTo(groundY(0.9, 0.5), 6);
    expect(thuds).toEqual(['snack']);
    expect(body.moving).toBe(false);
  });

  it('gets smaller with each bite and sheds crumbs that go away', () => {
    const { world, rest } = setup();
    const snack = world.dropSnack('cookie', 0.9, 0.5);
    rest();
    world.biteSnack();
    expect(snack.bites).toBe(1);
    expect(snack.size).toBeCloseTo(0.66, 6);
    expect(world.particles.length).toBe(5);
    world.biteSnack(); world.biteSnack(); world.biteSnack();
    expect(snack.bites).toBe(3);
    expect(rest()).toBeLessThan(1.5);
    expect(world.particles).toHaveLength(0);
    world.removeSnack();
    expect(world.snack).toBeNull();
    world.biteSnack();                             // nothing there: nothing happens
  });

  it('every snack is a new one, lands where there is island, and hops when tapped', () => {
    const { world, rest } = setup();
    const first = world.dropSnack('bread', 30, 30);
    expect(Math.hypot(first.x, first.z)).toBeLessThanOrEqual(ISLAND.reach + 0.11);
    const second = world.dropSnack('carrot', 0.5, 0.5);
    expect(second.serial).toBeGreaterThan(first.serial);
    world.bopSnack();                              // still in the air: ignored
    rest();
    world.bopSnack();
    expect(second.landed).toBe(false);
    expect(rest()).toBeLessThan(1.5);
    expect(second.landed).toBe(true);
  });
});

describe('the ball', () => {
  it('drops in, bounces lower each time and comes to rest on the grass', () => {
    const { world, rest } = setup();
    const ball = world.serveBall('ball');
    expect(ball.y).toBeGreaterThan(3);
    expect(rest()).toBeLessThan(BALL_LIMIT_S + 1);
    expect(ball.resting).toBe(true);
    expect(ball.y).toBeCloseTo(groundY(ball.x, ball.z) + BALL_RADIUS, 6);
    expect(Math.hypot(ball.x, ball.z)).toBeLessThanOrEqual(ISLAND.fence + 1e-6);
  });

  it('cannot leave the island, however it is knocked about', () => {
    const { world, body } = setup();
    const ball = world.serveBall('ball');
    for (let i = 0; i < 1500; i++) {
      if (i % 40 === 0) world.bopBall();
      world.update(FRAME, body);
      expect(Math.hypot(ball.x, ball.z)).toBeLessThanOrEqual(ISLAND.fence + 1e-6);
      expect(ball.y).toBeGreaterThanOrEqual(groundY(ball.x, ball.z) + BALL_RADIUS - 1e-6);
    }
  });

  it('is put to rest after a while even if it would roll for ever', () => {
    const { world, body } = setup();
    const ball = world.serveBall('ball');
    let t = 0;
    while (!ball.resting && t < BALL_LIMIT_S + 2) {
      ball.vx = 0.4;                               // something keeps pushing it
      world.update(FRAME, body);
      t += FRAME;
    }
    expect(ball.resting).toBe(true);
    expect(t).toBeLessThan(BALL_LIMIT_S + 0.2);
  });

  it('a tap sends it up again; serving again reuses the same ball', () => {
    const { world, rest } = setup();
    const ball = world.serveBall('ball');
    rest();
    world.bopBall();
    expect(ball.resting).toBe(false);
    expect(ball.vy).toBeGreaterThan(4);
    rest();
    expect(world.serveBall('yarn')).toBe(ball);
    expect(ball.toy).toBe('yarn');
    expect(ball.resting).toBe(false);
  });

  it('Doozer chases it and kicks it, counting the kicks', () => {
    let kicks = 0;
    const { world, body, run, rest } = setup({ onKick: () => { kicks++; } });
    world.serveBall('ball');
    world.chase(true);
    expect(world.travelling).toBe(true);
    run(8);
    expect(kicks).toBeGreaterThanOrEqual(2);
    expect(world.kicks).toBe(kicks);
    world.chase(false);
    expect(world.travelling).toBe(false);
    expect(rest()).toBeLessThan(BALL_LIMIT_S + 2);
    expect(body.grounded).toBe(true);
    expect(Math.hypot(world.doozer.x, world.doozer.z)).toBeLessThan(ISLAND.fence);
  });

  it('there is nothing to chase without a ball, and taking the ball away ends the chase', () => {
    const { world, rest } = setup();
    world.chase(true);
    expect(world.travelling).toBe(false);
    world.serveBall('ball');
    world.chase(true);
    world.removeBall();
    expect(world.ball).toBeNull();
    expect(world.travelling).toBe(false);
    expect(world.particles.length).toBeGreaterThan(0);   // it goes in a puff of stars
    expect(rest()).toBeLessThan(2);
  });

  it('outside a game a ball that meets Doozer only bumps off it', () => {
    let kicks = 0;
    const { world, run } = setup({ onKick: () => { kicks++; } });
    const ball = world.serveBall('ball');
    ball.x = world.doozer.x + 0.5; ball.z = world.doozer.z; ball.y = 0.9; ball.vx = -2; ball.vy = 0;
    run(2);
    expect(kicks).toBe(0);
    expect(Math.hypot(ball.x - world.doozer.x, ball.z - world.doozer.z)).toBeGreaterThan(0.6);
  });
});

describe('night, rain and the duck', () => {
  it('night falls and lifts gradually', () => {
    const { world, run, rest } = setup();
    world.setNight(true);
    run(0.3);
    expect(world.night).toBeGreaterThan(0.2);
    expect(world.night).toBeLessThan(0.7);
    expect(rest()).toBeLessThan(5);
    expect(world.night).toBe(1);
    world.setNight(false);
    expect(rest()).toBeLessThan(5);
    expect(world.night).toBe(0);
  });

  it('rain makes drops for as long as it rains, and they stop when it stops', () => {
    const { world, run, rest } = setup();
    world.setRain(true);
    world.setDuck(true);
    run(1);
    expect(world.rain).toBe(1);
    expect(world.duck).toBe(1);
    expect(world.particles.some((p) => p.kind === 'drop')).toBe(true);
    expect(world.moving).toBe(true);
    world.setRain(false);
    world.setDuck(false);
    expect(rest()).toBeLessThan(2);
    expect(world.particles).toHaveLength(0);
    expect(world.rain).toBe(0);
    expect(world.duck).toBe(0);
  });

  it('never holds more than a few dozen particles', () => {
    const { world } = setup();
    for (let i = 0; i < 50; i++) world.burst('star', 0, 1, 0, 8);
    expect(world.particles.length).toBeLessThanOrEqual(60);
  });

  it('fireflies only drift while someone is watching, and can be moved on by hand', () => {
    const { world, run } = setup();
    run(1);
    expect(world.ambient).toBe(0);
    world.setLively(true);
    run(1);
    expect(world.ambient).toBeCloseTo(1, 1);
    world.setLively(false);
    const before = world.ambient;
    world.wink(0.4);
    expect(world.ambient).toBeCloseTo(before + 0.4, 6);
  });
});

describe('settling, and telling the view', () => {
  it('settle puts everything where it was going, at once', async () => {
    const { world } = setup();
    let arrived: boolean | null = null;
    void world.travelTo(0.7, 0.4).then((result) => { arrived = result; });
    const ball = world.serveBall('ball');
    const snack = world.dropSnack('donut', -0.9, 0.4);
    world.setNight(true);
    world.setRain(true);
    world.burst('crumb', 0, 1, 0, 6);
    world.settle();
    await Promise.resolve();
    expect(arrived).toBe(true);
    expect(world.moving).toBe(false);
    expect(ball.resting).toBe(true);
    expect(snack.landed).toBe(true);
    expect(world.night).toBe(1);
    expect(world.rain).toBe(0);
    expect(world.particles).toHaveLength(0);
  });

  it('says so whenever something is changed from outside a frame', () => {
    let asked = 0;
    const { world } = setup({ invalidate: () => { asked++; } });
    const expectAsked = (what: string, fn: () => void): void => { asked = 0; fn(); expect(asked, what).toBeGreaterThan(0); };
    expectAsked('travelTo', () => void world.travelTo(0.5, 0.5));
    expectAsked('arriveNow', () => world.arriveNow());
    expectAsked('dropSnack', () => void world.dropSnack('apple', 0.5, 0.5));
    expectAsked('biteSnack', () => world.biteSnack());
    expectAsked('removeSnack', () => world.removeSnack());
    expectAsked('serveBall', () => void world.serveBall('ball'));
    expectAsked('bopBall', () => world.bopBall());
    expectAsked('chase', () => world.chase(true));
    expectAsked('removeBall', () => world.removeBall());
    expectAsked('setNight', () => world.setNight(true));
    expectAsked('setRain', () => world.setRain(true));
    expectAsked('setDuck', () => world.setDuck(true));
    expectAsked('wink', () => world.wink());
    asked = 0;
    world.setNight(true);                          // already night: nothing changed
    expect(asked).toBe(0);
  });

  it('survives a frame that never came, a negative one and one that is not a number', () => {
    const { world, body } = setup();
    world.serveBall('ball');
    void world.travelTo(0.8, 0.2);
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 30]) {
      world.update(dt, body);
      expect(Number.isFinite(world.doozer.x) && Number.isFinite(world.ball?.y ?? 0)).toBe(true);
    }
  });
});

describe('the frame loop', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  /** A screen that offers a frame every `hz`-th of a second, for as long as one has been asked for. */
  function rig(options: { hz?: number; fps?: number; frames?: boolean } = {}) {
    const hz = options.hz ?? 120;
    let pending: (() => void) | null = null;
    let work = 0;
    const steps: { seconds: number; draw: boolean }[] = [];
    const loop = new FrameLoop({
      step: (seconds, draw) => { steps.push({ seconds, draw }); return --work > 0; },
      fps: () => options.fps ?? 60,
      requestFrame: (callback) => { pending = callback; return 1; },
      cancelFrame: () => { pending = null; },
      now: () => Date.now(),
    });
    const screen = options.frames === false ? null : setInterval(() => { const frame = pending; pending = null; frame?.(); }, 1000 / hz);
    return { loop, steps, setWork: (n: number) => { work = n; }, stop: () => { if (screen) clearInterval(screen); } };
  }

  it('asks for nothing while asleep, and stops by itself when there is nothing left to do', () => {
    const r = rig();
    r.stop();
    expect(vi.getTimerCount()).toBe(0);
    const again = rig();
    again.setWork(3);
    again.loop.wake();
    vi.advanceTimersByTime(500);
    expect(again.steps).toHaveLength(3);
    expect(again.loop.running).toBe(false);
    again.stop();
    expect(vi.getTimerCount()).toBe(0);            // no timer of its own left behind
  });

  it('caps the frame rate below what the screen offers', () => {
    for (const [hz, fps] of [[125, 60], [125, 30], [50, 30], [200, 60], [100, 60]] as const) {
      const r = rig({ hz, fps });
      r.setWork(100_000);
      r.loop.wake();
      vi.advanceTimersByTime(2000);
      const perSecond = r.steps.length / 2;
      // A screen only offers whole frames, so the cap lands on the nearest rate the screen can do.
      expect(perSecond, `${fps} fps on a ${hz} Hz screen`).toBeLessThanOrEqual(fps * 1.05);
      expect(perSecond, `${fps} fps on a ${hz} Hz screen`).toBeGreaterThan(fps * 0.55);
      r.loop.destroy();
      r.stop();
    }
  });

  it('gives each step the time that really passed', () => {
    const r = rig({ hz: 60, fps: 60 });
    r.setWork(30);
    r.loop.wake();
    vi.advanceTimersByTime(1000);
    const total = r.steps.reduce((sum, step) => sum + step.seconds, 0);
    expect(total).toBeGreaterThan(0.4);
    expect(total).toBeLessThan(0.6);
    expect(r.steps.every((step) => step.draw)).toBe(true);
    r.stop();
  });

  it('when frames do not come, time still passes, without drawing', () => {
    const r = rig({ frames: false });
    r.setWork(4);
    r.loop.wake();
    vi.advanceTimersByTime(FALLBACK_MS * 4 + 50);
    expect(r.steps).toHaveLength(4);
    expect(r.steps.every((step) => !step.draw)).toBe(true);
    expect(r.steps.every((step) => step.seconds <= 0.25 + 1e-9)).toBe(true);
    expect(r.loop.running).toBe(false);
    expect(r.loop.undrawn).toBe(4);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('waking twice is the same as waking once; sleep and destroy stop it at once', () => {
    const r = rig();
    r.setWork(1000);
    r.loop.wake();
    r.loop.wake();
    vi.advanceTimersByTime(100);
    const soFar = r.steps.length;
    expect(soFar).toBeLessThanOrEqual(7);
    r.loop.sleep();
    vi.advanceTimersByTime(500);
    expect(r.steps.length).toBe(soFar);
    r.loop.wake();
    vi.advanceTimersByTime(100);
    expect(r.steps.length).toBeGreaterThan(soFar);
    r.loop.destroy();
    const after = r.steps.length;
    r.loop.wake();
    vi.advanceTimersByTime(500);
    expect(r.steps.length).toBe(after);
    r.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a step that throws does not leave the loop believing it is running', () => {
    let pending: (() => void) | null = null;
    let fail = true;
    let steps = 0;
    const loop = new FrameLoop({
      step: () => { steps++; if (fail) throw new Error('boom'); return false; },
      fps: () => 60,
      requestFrame: (callback) => { pending = callback; return 1; },
      cancelFrame: () => { pending = null; },
      now: () => Date.now(),
    });
    loop.wake();
    expect(() => (pending as (() => void) | null)?.()).toThrow('boom');
    expect(loop.running).toBe(false);
    fail = false;
    loop.wake();
    (pending as (() => void) | null)?.();
    expect(steps).toBe(2);
    expect(loop.running).toBe(false);
    loop.destroy();
    expect(vi.getTimerCount()).toBe(0);
  });
});
