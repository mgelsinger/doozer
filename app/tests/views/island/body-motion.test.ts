// The 3D Doozer's body as numbers (src/character/body-motion.ts): the squash-and-stretch
// spring, the hop, and the rule that with no new command everything comes to rest.

import { describe, expect, it } from 'vitest';
import { BodyMotion, PRESS_LIMIT_S } from '../../../src/character/body-motion';
import { EXPRESSIONS, POSES, type ExpressionName, type Pose } from '../../../src/character/expressions';
import { PERFORMANCES, PERFORMANCE_NAMES } from '../../../src/character/performances';
import { seeded } from '../../core/helpers';

const FRAME = 1 / 60;

function look(expression: ExpressionName, pose?: Pose) {
  return { expression, pose: pose ?? EXPRESSIONS[expression].pose, tuft: EXPRESSIONS[expression].tuft };
}

/** A body that is not idly breathing, so "at rest" really is rest. */
function still(): BodyMotion {
  const body = new BodyMotion({ random: seeded(3) });
  body.setLook(look('content'));
  body.setLive(false);
  body.settle();
  return body;
}

/** Run frames until the body stops, or the limit passes. Returns the seconds it took. */
function runToRest(body: BodyMotion, limitS = 12): number {
  let t = 0;
  while (body.moving && t < limitS) { body.update(FRAME); t += FRAME; }
  return t;
}

function everyNumberIsFinite(body: BodyMotion): boolean {
  return Object.values(body.pose).every((value) => Number.isFinite(value));
}

describe('at rest', () => {
  it('a settled body that is not live does not move', () => {
    const body = still();
    expect(body.moving).toBe(false);
    expect(body.pose).toMatchObject({ y: 0, stretch: 1, bulge: 1, scale: 1, yaw: 0, roll: 0, blink: 0 });
  });

  it('a live body breathes, and goes still again when it is no longer live', () => {
    const body = still();
    body.setLive(true);
    const seen = new Set<number>();
    for (let i = 0; i < 120; i++) { body.update(FRAME); seen.add(Math.round(body.pose.stretch * 1000)); }
    expect(body.moving).toBe(true);
    expect(seen.size).toBeGreaterThan(5);
    body.setLive(false);
    expect(runToRest(body)).toBeLessThan(3);
    expect(body.pose.stretch).toBeCloseTo(1, 2);
  });
});

describe('the spring', () => {
  it('a poke squashes, overshoots and comes back to rest', () => {
    const body = still();
    body.squish(1);
    let lowest = 1;
    let highest = 1;
    let t = 0;
    while (body.moving && t < 6) {
      body.update(FRAME);
      lowest = Math.min(lowest, body.pose.stretch);
      highest = Math.max(highest, body.pose.stretch);
      t += FRAME;
    }
    expect(lowest).toBeLessThan(0.88);            // it really squashes
    expect(highest).toBeGreaterThan(1.03);        // and stretches on the rebound
    expect(t).toBeLessThan(2.5);
    expect(body.pose.stretch).toBeCloseTo(1, 2);
  });

  it('keeps its volume: wider as it gets shorter', () => {
    const body = still();
    body.squish(1.5);
    for (let i = 0; i < 40; i++) {
      body.update(FRAME);
      expect(body.pose.stretch * body.pose.bulge * body.pose.bulge).toBeCloseTo(1, 5);
    }
  });

  it('never leaves its limits, however hard and often it is poked', () => {
    const body = still();
    for (let i = 0; i < 600; i++) {
      if (i % 2 === 0) body.squish(2);
      body.update(FRAME);
      expect(body.pose.stretch).toBeGreaterThanOrEqual(0.55);
      expect(body.pose.stretch).toBeLessThanOrEqual(1.4);
    }
    expect(runToRest(body)).toBeLessThan(3);
  });

  it('ears and tuft lag behind and then settle', () => {
    const body = still();
    body.squish(1);
    let ear = 0;
    let tuft = 0;
    for (let i = 0; i < 30; i++) { body.update(FRAME); ear = Math.max(ear, Math.abs(body.pose.earL)); tuft = Math.max(tuft, Math.abs(body.pose.tuft)); }
    expect(ear).toBeGreaterThan(0.03);
    expect(tuft).toBeGreaterThan(0.03);
    runToRest(body);
    expect(body.pose.earL).toBeCloseTo(0, 2);
    expect(body.pose.tuft).toBeCloseTo(0, 2);
  });
});

describe('the hop', () => {
  it('goes up, comes down, squashes on landing and reports it once', () => {
    const landings: number[] = [];
    const body = new BodyMotion({ onLand: (speed) => landings.push(speed) });
    body.setLook(look('content'));
    body.setLive(false);
    body.settle();
    expect(body.hop(3.3)).toBe(true);
    expect(body.grounded).toBe(false);
    expect(body.hop()).toBe(false);               // not twice in the air
    let peak = 0;
    let t = 0;
    while (!body.grounded && t < 3) { body.update(FRAME); peak = Math.max(peak, body.pose.y); t += FRAME; }
    expect(peak).toBeGreaterThan(0.25);
    expect(peak).toBeLessThan(0.5);
    expect(t).toBeLessThan(0.6);
    expect(landings).toHaveLength(1);
    expect(body.pose.y).toBe(0);
    body.update(FRAME);
    body.update(FRAME);
    expect(body.pose.stretch).toBeLessThan(1);    // the landing squash
    expect(runToRest(body)).toBeLessThan(2.5);
  });

  it('raises the arms and tucks the feet while in the air', () => {
    const body = still();
    body.hop();
    for (let i = 0; i < 10; i++) body.update(FRAME);
    expect(body.pose.armL).toBeGreaterThan(0.8);
    expect(body.pose.armR).toBeGreaterThan(0.8);
    expect(body.pose.tuck).toBeGreaterThan(0.5);
    runToRest(body);
    expect(body.pose.armL).toBeCloseTo(0, 1);
    expect(body.pose.tuck).toBe(0);
  });

  it('always lands, even when frames arrive seconds apart', () => {
    const body = still();
    body.hop(5);
    body.update(1.7);
    expect(body.grounded).toBe(true);
    expect(body.pose.y).toBe(0);
    expect(everyNumberIsFinite(body)).toBe(true);
  });

  it('does not hop while asleep', () => {
    const body = still();
    body.setLook(look('asleep'));
    runToRest(body);
    expect(body.asleep).toBe(true);
    expect(body.hop()).toBe(false);
  });
});

describe('being pressed', () => {
  it('stays squashed while held and springs back when let go', () => {
    const body = still();
    body.press(true);
    for (let i = 0; i < 60; i++) body.update(FRAME);
    expect(body.pose.stretch).toBeLessThan(0.9);
    expect(body.moving).toBe(true);               // time must keep passing while held
    body.press(false);
    let highest = 0;
    let t = 0;
    while (body.moving && t < 5) { body.update(FRAME); highest = Math.max(highest, body.pose.stretch); t += FRAME; }
    expect(highest).toBeGreaterThan(1.02);
    expect(body.pose.stretch).toBeCloseTo(1, 2);
    expect(t).toBeLessThan(2.5);
  });

  it('a press nobody ends lets go by itself', () => {
    const body = still();
    body.press(true);
    let t = 0;
    while (body.isPressed && t < PRESS_LIMIT_S + 2) { body.update(FRAME); t += FRAME; }
    expect(body.isPressed).toBe(false);
    expect(t).toBeGreaterThan(PRESS_LIMIT_S - 0.1);
    expect(t).toBeLessThan(PRESS_LIMIT_S + 0.2);
    expect(runToRest(body)).toBeLessThan(2.5);
  });
});

describe('poses', () => {
  it('sleep lies flat and wide; waking stands up again', () => {
    const body = still();
    body.setLook(look('asleep'));
    runToRest(body);
    expect(body.pose.stretch).toBeCloseTo(0.82, 2);
    expect(body.pose.bulge).toBeGreaterThan(1.08);
    expect(body.pose.tuft).toBeLessThan(-0.9);    // the tuft droops: it is the mood meter
    body.setLook(look('content'));
    runToRest(body);
    expect(body.pose.stretch).toBeCloseTo(1, 2);
    expect(body.pose.tuft).toBeCloseTo(0, 2);
  });

  it('a low mood slumps and droops the ears', () => {
    const body = still();
    body.setLook(look('hungry'));
    runToRest(body);
    expect(body.pose.stretch).toBeLessThan(0.97);
    expect(body.pose.earL).toBeGreaterThan(0.15);
    expect(body.pose.earR).toBeGreaterThan(0.15);
  });

  it('every pose keeps every number finite, and every pose that loops is one a face can end', () => {
    for (const pose of POSES) {
      const body = still();
      body.setLive(true);
      body.setLook(look('content', pose));
      for (let i = 0; i < 240; i++) body.update(FRAME);
      expect(everyNumberIsFinite(body), pose).toBe(true);
      // Back to the mood: it must come to rest again.
      body.setLook(look('content'));
      body.setLive(false);
      expect(runToRest(body), pose).toBeLessThan(4);
      expect(body.pose.stretch, pose).toBeCloseTo(1, 2);
      expect(body.pose.y, pose).toBe(0);
    }
  });

  it('the head-shake and the wash shake turn the body from side to side', () => {
    for (const pose of ['no', 'shake'] as const) {
      const body = still();
      body.setLook(look('content', pose));
      let left = 0;
      let right = 0;
      for (let i = 0; i < 60; i++) { body.update(FRAME); left = Math.min(left, body.pose.yaw); right = Math.max(right, body.pose.yaw); }
      expect(left, pose).toBeLessThan(-0.1);
      expect(right, pose).toBeGreaterThan(0.1);
    }
  });
});

describe('looking and facing', () => {
  it('turns a little toward what it looks at, and squarely toward where it is told to face', () => {
    const body = still();
    body.lookAt(1, 0.5);
    runToRest(body);
    expect(body.pose.lookX).toBeCloseTo(1, 2);
    expect(body.pose.yaw).toBeCloseTo(0.3, 2);
    body.setFacing(-0.9);
    runToRest(body);
    expect(body.pose.yaw).toBeCloseTo(-0.9, 2);
    body.setFacing(null);
    body.lookAt(0, 0);
    runToRest(body);
    expect(body.pose.yaw).toBeCloseTo(0, 2);
  });

  it('ignores a look that is not a number', () => {
    const body = still();
    body.lookAt(Number.NaN, Number.POSITIVE_INFINITY);
    runToRest(body);
    expect(everyNumberIsFinite(body)).toBe(true);
    expect(body.pose.lookX).toBe(0);
  });

  it('a blink shuts the eyes and opens them again', () => {
    const body = still();
    body.blink();
    let shut = 0;
    let t = 0;
    while (body.moving && t < 2) { body.update(FRAME); shut = Math.max(shut, body.pose.blink); t += FRAME; }
    expect(shut).toBeGreaterThan(0.8);
    expect(body.pose.blink).toBe(0);
    expect(t).toBeLessThan(0.5);
  });
});

describe('the cheap blink', () => {
  it('shuts and opens the eyes at once, without counting as movement', () => {
    const body = still();
    body.holdEyes(true);
    body.update(0);
    expect(body.pose.blink).toBe(1);
    expect(body.moving).toBe(false);
    body.holdEyes(false);
    body.update(0);
    expect(body.pose.blink).toBe(0);
    body.holdEyes(true);
    body.settle();
    expect(body.pose.blink).toBe(0);
  });
});

describe('performances', () => {
  it('each one shapes the body, and leaves it at rest when it is told to stop', () => {
    for (const name of PERFORMANCE_NAMES) {
      const body = still();
      const stop = body.startPerformance(name, 1);
      const duration = PERFORMANCES[name].duration / 1000;
      let moved = false;
      for (let t = 0; t < duration; t += FRAME) {
        body.update(FRAME);
        const p = body.pose;
        if (Math.abs(p.stretch - 1) > 0.01 || p.y > 0.01 || Math.abs(p.roll) > 0.005 || Math.abs(p.scale - 1) > 0.01 || p.armR > 0.2 || Math.abs(p.yaw) > 0.02) moved = true;
        expect(everyNumberIsFinite(body), name).toBe(true);
      }
      expect(moved, name).toBe(true);
      expect(body.moving, name).toBe(true);       // until it is told to stop
      stop();
      expect(runToRest(body), name).toBeLessThan(3);
      expect(body.pose.scale, name).toBeCloseTo(1, 2);
      expect(body.pose.roll, name).toBeCloseTo(0, 2);
      expect(body.pose.y, name).toBe(0);
    }
  });

  it('one that is cut short at any moment still comes to rest', () => {
    for (const name of PERFORMANCE_NAMES) {
      const duration = PERFORMANCES[name].duration / 1000;
      for (const cut of [0, 0.1, 0.33, 0.5, 0.8]) {
        const body = still();
        const stop = body.startPerformance(name, 1);
        for (let t = 0; t < duration * cut; t += FRAME) body.update(FRAME);
        stop();
        expect(runToRest(body), `${name} cut at ${cut}`).toBeLessThan(3);
        expect(body.pose.scale, `${name} cut at ${cut}`).toBeCloseTo(1, 2);
        expect(body.pose.y, `${name} cut at ${cut}`).toBe(0);
      }
    }
  });

  it('a newer performance replaces an older one, and the older one cannot stop the newer', () => {
    const body = still();
    const stopFirst = body.startPerformance('wave');
    const stopSecond = body.startPerformance('yawn');
    stopFirst();
    body.update(FRAME);
    expect(body.moving).toBe(true);
    stopSecond();
    expect(runToRest(body)).toBeLessThan(3);
  });

  it('pop-out shrinks Doozer away and pop-in brings it back', () => {
    const body = still();
    let stop = body.startPerformance('pop-out');
    for (let t = 0; t < 0.24; t += FRAME) body.update(FRAME);
    expect(body.pose.scale).toBeLessThan(0.35);
    stop();
    stop = body.startPerformance('pop-in');
    body.update(FRAME);
    expect(body.pose.scale).toBeLessThan(0.4);    // it starts small, wherever it was
    for (let t = 0; t < 0.3; t += FRAME) body.update(FRAME);
    stop();
    runToRest(body);
    expect(body.pose.scale).toBe(1);
  });
});

describe('settling and reduced motion', () => {
  it('settle puts everything at rest at once, whatever was going on', () => {
    const body = still();
    body.setLook(look('asleep'));
    body.hop(4);
    body.squish(2);
    body.press(true);
    body.startPerformance('celebrate');
    body.update(0.2);
    body.setLook(look('content'));
    body.settle();
    expect(body.moving).toBe(false);
    expect(body.pose).toMatchObject({ y: 0, scale: 1, roll: 0 });
    expect(body.pose.stretch).toBeCloseTo(1, 5);
    expect(body.isPressed).toBe(false);
  });

  it('with motion reduced nothing springs, hops or loops, but poses keep their form', () => {
    const body = still();
    body.setLive(true);
    body.setReduceMotion(true);
    body.squish(2);
    expect(body.hop()).toBe(false);
    body.startPerformance('celebrate');
    for (let i = 0; i < 30; i++) body.update(FRAME);
    expect(body.pose.y).toBe(0);
    expect(body.pose.stretch).toBeCloseTo(1, 5);
    body.setLook(look('asleep'));
    body.update(FRAME);
    expect(body.pose.stretch).toBeCloseTo(0.82, 2);   // asleep still looks asleep
  });

  it('survives a frame that never came, a negative one and one that is not a number', () => {
    const body = still();
    body.squish(1);
    for (const dt of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, 30]) {
      body.update(dt);
      expect(everyNumberIsFinite(body)).toBe(true);
    }
    expect(runToRest(body)).toBeLessThan(3);
  });
});
