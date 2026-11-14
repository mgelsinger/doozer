// The 3D Doozer's body as numbers: the procedural squash-and-stretch spring of the Island
// view (DESIGN_SPEC.md 6.3, after mockups/v2-blob), the hop, and everything that follows
// from them (ears and tuft lagging behind, arms flying up, the slump of a low mood, the
// flattened breathing of sleep).
//
// No three.js and no DOM in here: `update(dt)` turns commands and the current look into a
// `BodyPose`, which doozer3d.ts writes onto the model's bones. That keeps the part that
// could get stuck testable on its own.
//
// What keeps it from getting stuck:
//   - Everything eases toward a target or is a damped spring, so with no new command the
//     pose always comes to rest; `moving` says when it has, and a view stops drawing then.
//   - A hop is plain ballistics and always lands. A press is a flag the view clears, and
//     it also lets go by itself after `PRESS_LIMIT_S`.
//   - One-shot performances are timed by ExpressionState's timer, not here. This file only
//     shapes the body while one runs, and forgets it the moment it is told to stop.
//   - `settle()` puts everything at rest at once (the view was hidden or tucked away).
//
// Angles are radians about the model's axes (x right, y up, z toward the viewer); lengths
// are model units, 1 = 100 pixels of the 2D rig.

import type { ExpressionName, Pose } from './expressions';
import type { Look } from './expression-state';
import { PERFORMANCES, type PerformanceName } from './performances';

export interface BodyPose {
  /** Height of the feet above the ground. */
  y: number;
  /** Squash and stretch about the feet: the body's height, and its width and depth. */
  stretch: number;
  bulge: number;
  /** The whole creature: turned about the vertical, and scaled (popping in and out). */
  yaw: number;
  scale: number;
  /** The body above the feet: nodding forward, and leaning sideways. */
  pitch: number;
  roll: number;
  /** Ears, about z. Positive tips the left ear outward; the right ear is mirrored by the caller. */
  earL: number;
  earR: number;
  /** The tuft: about z (negative droops toward the curl) and its sway about x. */
  tuft: number;
  tuftSway: number;
  /** Arms: how far each is raised, and swung forward. */
  armL: number;
  armR: number;
  armLForward: number;
  armRForward: number;
  /** Feet tucked up while in the air, 0..1. */
  tuck: number;
  /** The tail's wag, sideways. */
  tail: number;
  /** Eyes shut by a blink, 0..1. */
  blink: number;
  /** Where the face is looking, each -1..1. */
  lookX: number;
  lookY: number;
  /** The chewing mouth: 0 open .. 1 shut. */
  chew: number;
}

export interface BodyMotionOptions {
  random?: () => number;
  /** Doozer's feet have just touched down after a hop. */
  onLand?(speed: number): void;
}

const STIFFNESS = 220;
const DAMPING = 13;
const GRAVITY = 16;
/** No single step is longer than this, however long the frame took. */
const MAX_STEP_S = 0.05;
/** A press that nobody ends is let go after this long. */
export const PRESS_LIMIT_S = 8;
const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const smooth = (edge0: number, edge1: number, x: number): number => {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** 0 outside [a, d], 1 inside [b, c], eased between. */
const bell = (a: number, b: number, c: number, d: number, x: number): number => smooth(a, b, x) * (1 - smooth(c, d, x));

/** What a performance adds to the body while it runs. All zero is "nothing". */
interface Extra {
  y: number;
  stretch: number;
  roll: number;
  /** Scale of the whole creature, as a difference from 1. */
  scale: number;
  armL: number;
  armR: number;
  armLForward: number;
  earL: number;
  earR: number;
  /** Shaking dry: 0..1. */
  shake: number;
  /** Waving with the right paw: 0..1. */
  wave: number;
  /** Lying down for sleep: 0..1 (added to the sleep pose's own). */
  sleep: number;
}

const NO_EXTRA: Readonly<Extra> = { y: 0, stretch: 0, roll: 0, scale: 0, armL: 0, armR: 0, armLForward: 0, earL: 0, earR: 0, shake: 0, wave: 0, sleep: 0 };
const EXTRA_KEYS = Object.keys(NO_EXTRA) as (keyof Extra)[];

/** Poses that keep the body moving for as long as they are held. They are always temporary. */
const ACTIVE_POSES: ReadonlySet<Pose> = new Set<Pose>(['hop', 'play', 'eat', 'shake', 'no', 'wave', 'walk', 'trot', 'carried']);
const HAPPY: ReadonlySet<ExpressionName> = new Set<ExpressionName>(['joyful', 'love', 'cheer']);

interface Running { name: PerformanceName; strength: number; at: number; cue: number }

export class BodyMotion {
  /** The pose as of the last `update`. The same object every time. */
  readonly pose: BodyPose = {
    y: 0, stretch: 1, bulge: 1, yaw: 0, scale: 1, pitch: 0, roll: 0, earL: 0, earR: 0, tuft: 0, tuftSway: 0,
    armL: 0, armR: 0, armLForward: 0, armRForward: 0, tuck: 0, tail: 0, blink: 0, lookX: 0, lookY: 0, chew: 0,
  };

  private readonly random: () => number;
  private readonly onLand?: (speed: number) => void;

  private time = 0;
  // the spring
  private sq = 0;
  private sqV = 0;
  // the hop
  private y = 0;
  private vy = 0;
  private air = false;
  private hopCooldown = 0;
  // what the view asked for
  private pressed = false;
  private pressedFor = 0;
  private pressK = 0;
  private lookTX = 0;
  private lookTY = 0;
  private facing: number | null = null;
  private liveTarget = true;
  private reduce = false;
  // what the face says
  private poseName: Pose = 'idle';
  private expression: ExpressionName = 'content';
  private tuftTarget = 0;
  // eased
  private live = 1;
  private lookX = 0;
  private lookY = 0;
  private yaw = 0;
  private sleepK = 0;
  private slumpK = 0;
  private drowsyK = 0;
  private armK = 0;
  private waveK = 0;
  private playK = 0;
  private eatK = 0;
  private noK = 0;
  private shakeK = 0;
  private wagK = 0;
  private blinkLeft = 0;
  private blinkK = 0;
  private eyesHeld = false;
  private tuft = 0;
  private tuftV = 0;
  private earL = 0;
  private earR = 0;
  // the performance
  private running: Running | null = null;
  private readonly extra: Extra = { ...NO_EXTRA };
  private readonly want: Extra = { ...NO_EXTRA };

  constructor(options: BodyMotionOptions = {}) {
    this.random = options.random ?? Math.random;
    this.onLand = options.onLand;
  }

  // ---- commands --------------------------------------------------------------------

  /** The face and pose that are showing now (from ExpressionState). */
  setLook(look: Pick<Look, 'pose' | 'expression' | 'tuft'>): void {
    this.poseName = look.pose;
    this.expression = look.expression;
    this.tuftTarget = -look.tuft * DEG;
  }

  /** False stops the idle loops (breathing, swaying, wagging): nothing then moves without a reason. */
  setLive(on: boolean): void { this.liveTarget = on; }

  /** With motion reduced nothing springs, hops or loops; poses keep their static form. */
  setReduceMotion(on: boolean): void {
    this.reduce = on;
    if (on) this.settle();
  }

  /** Glance toward a point: x and y each -1..1. */
  lookAt(x: number, y: number): void {
    this.lookTX = Number.isFinite(x) ? clamp(x, -1, 1) : 0;
    this.lookTY = Number.isFinite(y) ? clamp(y, -1, 1) : 0;
  }

  /** Turn to face a direction (radians about the vertical), or `null` to follow the gaze again. */
  setFacing(yaw: number | null): void {
    this.facing = yaw === null || !Number.isFinite(yaw) ? null : clamp(yaw, -1.2, 1.2);
  }

  /** Jump. False if Doozer is already in the air, lying asleep, or motion is reduced. */
  hop(speed = 3.3): boolean {
    if (this.air || this.reduce || this.sleepK > 0.5 || this.hopCooldown > 0) return false;
    this.vy = clamp(Number.isFinite(speed) ? speed : 3.3, 0.5, 5);
    this.air = true;
    this.sqV += 2.3;
    return true;
  }

  /** A poke, a bite, a nudge: a kick to the spring. Positive `strength` squashes downward. */
  squish(strength = 1): void {
    if (this.reduce) return;
    const s = Number.isFinite(strength) ? clamp(strength, -2, 2) : 1;
    this.sqV = clamp(this.sqV - 5 * s, -14, 14);
  }

  /** Held down under a finger (true) or let go (false): it springs back when released. */
  press(on: boolean): void {
    if (this.pressed === on) return;
    this.pressed = on;
    this.pressedFor = 0;
    if (!on && !this.reduce) this.sqV += 3.2;
  }

  get isPressed(): boolean { return this.pressed; }

  blink(): void {
    if (this.reduce) return;
    this.blinkLeft = 0.13;
  }

  /**
   * Eyes shut (true) or open again (false) at once, with nothing in between: the cheap
   * blink of a Doozer nobody is watching. It costs two redraws and is not "moving".
   */
  holdEyes(shut: boolean): void { this.eyesHeld = shut && !this.reduce; }

  /** Shape the body for a one-shot. Returns the function that ends it (ExpressionState calls it). */
  startPerformance(name: PerformanceName, strength = 1): () => void {
    const run: Running = { name, strength, at: 0, cue: 0 };
    this.running = run;
    return () => { if (this.running === run) this.running = null; };
  }

  /** Everything at rest, now: on the ground, unsprung, every eased value at its target. */
  settle(): void {
    this.running = null;
    this.pressed = false;
    this.sq = 0; this.sqV = 0;
    this.y = 0; this.vy = 0; this.air = false; this.hopCooldown = 0;
    this.blinkLeft = 0;
    this.eyesHeld = false;
    for (const key of EXTRA_KEYS) { this.extra[key] = 0; this.want[key] = 0; }
    // Run the easing to its end.
    this.step(0, true);
    this.write();
  }

  // ---- reading ---------------------------------------------------------------------

  get grounded(): boolean { return !this.air; }
  get height(): number { return this.y; }
  get asleep(): boolean { return this.sleepK > 0.5; }

  /** True while anything is still on its way somewhere. False means: stop drawing. */
  get moving(): boolean {
    return this.live > 0 || this.live !== this.targets().live || this.active;
  }

  /** Like `moving`, but not counting the idle loops: something is happening that deserves a smooth frame rate. */
  get active(): boolean {
    // While held the body is still, but time has to keep passing for the press to let go by itself.
    if (this.air || this.running !== null || this.pressed) return true;
    if (this.blinkLeft > 0 || this.blinkK > 0) return true;
    if (ACTIVE_POSES.has(this.poseName)) return true;
    if (Math.abs(this.sq - this.springTarget()) > 0.0015 || Math.abs(this.sqV) > 0.012) return true;
    if (Math.abs(this.tuft - this.tuftTarget) > 0.004 || Math.abs(this.tuftV) > 0.03) return true;
    for (const key of EXTRA_KEYS) if (this.extra[key] !== 0) return true;
    return !this.easedAtTargets();
  }

  // ---- time ------------------------------------------------------------------------

  /** Advance by `dt` seconds (any length: it is taken in small steps) and refresh `pose`. */
  update(dt: number): BodyPose {
    let left = Number.isFinite(dt) ? clamp(dt, 0, 2) : 0;
    while (left > 1e-6) {
      const step = Math.min(left, MAX_STEP_S);
      this.step(step, false);
      left -= step;
    }
    this.write();
    return this.pose;
  }

  private springTarget(): number {
    return -0.15 * this.pressK;
  }

  private targets() {
    const pose = this.poseName;
    const asleep = pose === 'sleep' || this.want.sleep > 0.5;
    return {
      live: this.liveTarget && !this.reduce ? 1 : 0,
      sleep: asleep ? 1 : 0,
      slump: pose === 'sulk' || pose === 'drowsy' ? 1 : 0,
      drowsy: pose === 'drowsy' ? 1 : 0,
      arm: this.air || pose === 'hop' ? 1 : 0,
      wave: pose === 'wave' || this.want.wave > 0.5 ? 1 : 0,
      play: pose === 'play' ? 1 : 0,
      eat: pose === 'eat' ? 1 : 0,
      no: pose === 'no' ? 1 : 0,
      shake: pose === 'shake' ? 1 : this.want.shake,
      wag: HAPPY.has(this.expression) && !asleep ? 1 : 0,
      press: this.pressed ? 1 : 0,
      lookX: asleep ? 0 : this.lookTX,
      lookY: asleep ? 0 : this.lookTY,
      yaw: asleep ? 0 : this.facing ?? this.lookTX * 0.3,
    };
  }

  private easedAtTargets(): boolean {
    const t = this.targets();
    // `ease` lands exactly on its target, so equality is the test.
    const near = (a: number, b: number): boolean => a === b;
    return near(this.sleepK, t.sleep) && near(this.slumpK, t.slump) && near(this.drowsyK, t.drowsy)
      && near(this.armK, t.arm) && near(this.waveK, t.wave) && near(this.playK, t.play) && near(this.eatK, t.eat)
      && near(this.noK, t.no) && near(this.shakeK, t.shake) && near(this.wagK, t.wag) && near(this.pressK, t.press)
      && near(this.lookX, t.lookX) && near(this.lookY, t.lookY) && near(this.yaw, t.yaw);
  }

  private step(dt: number, toRest: boolean): void {
    this.time += dt;
    const t = this.targets();
    // Ease `from` toward `to`; within a hair of it, land on it exactly, so that "at rest" is reachable.
    const ease = (from: number, to: number, rate: number): number => {
      if (toRest || this.reduce) return to;
      const next = from + (to - from) * (1 - Math.exp(-rate * dt));
      return Math.abs(next - to) < 0.002 ? to : next;
    };

    // A press nobody ended lets go by itself.
    if (this.pressed) {
      this.pressedFor += dt;
      if (this.pressedFor > PRESS_LIMIT_S) this.press(false);
    }

    this.live = ease(this.live, t.live, 5);
    this.sleepK = ease(this.sleepK, t.sleep, 3);
    this.slumpK = ease(this.slumpK, t.slump, 3.5);
    this.drowsyK = ease(this.drowsyK, t.drowsy, 3);
    this.armK = ease(this.armK, t.arm, 12);
    this.waveK = ease(this.waveK, t.wave, 10);
    this.playK = ease(this.playK, t.play, 9);
    this.eatK = ease(this.eatK, t.eat, 12);
    this.noK = ease(this.noK, t.no, 14);
    this.shakeK = ease(this.shakeK, t.shake, 14);
    this.wagK = ease(this.wagK, t.wag, 5);
    this.pressK = ease(this.pressK, t.press, 22);
    this.lookX = ease(this.lookX, t.lookX, 7);
    this.lookY = ease(this.lookY, t.lookY, 7);
    this.yaw = ease(this.yaw, t.yaw, 8);

    if (toRest) {
      this.tuft = this.tuftTarget; this.tuftV = 0;
      this.earL = 0; this.earR = 0;
      this.blinkK = 0;
      return;
    }

    this.hopCooldown = Math.max(0, this.hopCooldown - dt);
    this.runPerformance(dt);
    for (const key of EXTRA_KEYS) this.extra[key] = ease(this.extra[key], this.want[key], 20);

    // Poses that hop on the spot.
    if (!this.air && this.hopCooldown <= 0 && !this.reduce) {
      if (this.poseName === 'hop') this.hop(3.2);
      else if (this.poseName === 'play') this.hop(2.1);
    }

    // The hop.
    if (this.air) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= 0) {
        const speed = -this.vy;
        this.y = 0; this.vy = 0; this.air = false;
        this.hopCooldown = 0.1;
        this.sqV -= clamp(1 + speed * 0.72, 1, 3.6);
        this.onLand?.(speed);
      }
    }

    // The spring.
    if (this.reduce) { this.sq = 0; this.sqV = 0; }
    else {
      this.sqV += (-STIFFNESS * (this.sq - this.springTarget()) - DAMPING * this.sqV) * dt;
      this.sq += this.sqV * dt;
      if (!Number.isFinite(this.sq) || !Number.isFinite(this.sqV)) { this.sq = 0; this.sqV = 0; }
    }

    // The tuft: a looser spring, so it bounces after the body has stopped.
    const tuftTo = this.tuftTarget + clamp(this.sqV * 0.05, -0.5, 0.5);
    if (this.reduce) { this.tuft = this.tuftTarget; this.tuftV = 0; }
    else {
      this.tuftV += (-90 * (this.tuft - tuftTo) - 8.5 * this.tuftV) * dt;
      this.tuft += this.tuftV * dt;
    }

    // Ears lag behind the body: they flop outward as it shoots up and pinch in as it drops.
    const lag = clamp(this.sqV * 0.045, -0.35, 0.35);
    this.earL = ease(this.earL, lag, 30);
    this.earR = ease(this.earR, lag, 30);

    // Blinking.
    if (this.blinkLeft > 0) this.blinkLeft = Math.max(0, this.blinkLeft - dt);
    this.blinkK = ease(this.blinkK, this.blinkLeft > 0 ? 1 : 0, this.blinkLeft > 0 ? 60 : 32);
  }

  /** Cues and shapes of the one-shot that is running (durations are PERFORMANCES'). */
  private runPerformance(dt: number): void {
    const want = this.want;
    for (const key of EXTRA_KEYS) want[key] = 0;
    const run = this.running;
    if (!run || this.reduce) return;
    const duration = PERFORMANCES[run.name].duration / 1000;
    const before = run.at;
    run.at += dt;
    const u = clamp(run.at / duration, 0, 1);
    /** True once, when the performance passes `at` (a fraction of its length). */
    const cue = (at: number): boolean => before <= at * duration && run.at > at * duration;
    const first = before === 0;

    switch (run.name) {
      case 'squish':
        if (first) this.squish(run.strength);
        break;
      case 'nod':
        if (first) this.squish(0.36);
        break;
      case 'hop':
        if (first) { this.hopCooldown = 0; this.hop(3.3); }
        break;
      case 'celebrate':
        if (first) { this.hopCooldown = 0; this.hop(3.3); }
        if (cue(0.47)) { this.hopCooldown = 0; this.hop(3.6); }
        want.armL = want.armR = 1.35 * (1 - smooth(0.86, 1, u));
        want.roll = (u < 0.44 ? -4 : 5) * DEG * Math.sin(Math.PI * clamp(u < 0.44 ? u / 0.4 : (u - 0.48) / 0.42, 0, 1));
        break;
      case 'wave':
        want.wave = u > 0.04 && u < 0.9 ? 1 : 0;
        want.roll = 2.5 * DEG * bell(0, 0.18, 0.84, 1, u);
        break;
      case 'yawn': {
        const k = bell(0, 0.32, 0.68, 1, u);
        want.stretch = 0.05 * k;
        want.armL = 0.6 * k; want.armLForward = 0.5 * k;
        want.earL = 9 * DEG * k; want.earR = 9 * DEG * k;
        break;
      }
      case 'fall-asleep':
        // A wobble, a last stretch, then down into the sleeping squash.
        want.roll = (3 * bell(0.04, 0.14, 0.16, 0.24, u) - 2.5 * bell(0.2, 0.28, 0.3, 0.42, u)) * DEG;
        want.stretch = 0.045 * bell(0.36, 0.5, 0.62, 0.74, u);
        want.sleep = u > 0.62 ? 1 : 0;
        break;
      case 'wake': {
        // Still lying down, then a big stretch with both paws up, then settled.
        want.sleep = u < 0.18 ? 1 : 0;
        const k = bell(0.2, 0.46, 0.6, 0.82, u);
        want.stretch = 0.12 * k;
        want.armL = want.armR = 2.1 * k;
        break;
      }
      case 'shake-off':
        want.shake = Math.pow(1 - u, 0.7);
        break;
      case 'stir':
        want.roll = 3 * DEG * Math.sin(u * TAU * 1.25) * (1 - u);
        break;
      case 'pop-out':
        // A little hop, then gone.
        want.y = u < 0.4 ? 0.16 * (u / 0.4) : 0.16 - 0.1 * ((u - 0.4) / 0.6);
        want.scale = u < 0.35 ? 0.06 * (u / 0.35) : 0.06 - 1.02 * Math.pow(Math.min(1, (u - 0.35) / 0.4), 1.4);
        break;
      case 'pop-in':
        want.scale = u < 0.55 ? -0.9 + 1.02 * (u / 0.55) : u < 0.8 ? 0.12 - 0.15 * ((u - 0.55) / 0.25) : -0.03 * (1 - (u - 0.8) / 0.2);
        if (first) { for (const key of EXTRA_KEYS) this.extra[key] = 0; this.extra.scale = -0.9; }
        break;
    }
  }

  private write(): void {
    const p = this.pose;
    const e = this.extra;
    const t = this.time;
    const live = this.live;
    const awake = 1 - this.sleepK;

    // Breathing: quick and shallow awake, slow and deep asleep.
    const breathe = (0.018 * Math.sin(t * 2.3) * awake + 0.04 * Math.sin(t * 1.25) * this.sleepK) * live;
    const chewing = this.eatK * 0.03 * Math.sin(t * TAU / 0.3);
    const drowse = this.drowsyK * live * smooth(0.5, 0.68, (t / 4.2) % 1) * (1 - smooth(0.74, 0.86, (t / 4.2) % 1));
    const flight = this.air ? clamp(this.vy * 0.02, -0.05, 0.08) : 0;
    const lying = 1 - 0.18 * this.sleepK;
    const slump = 1 - 0.045 * this.slumpK - 0.06 * drowse;
    p.stretch = clamp((1 + this.sq + breathe + chewing + flight + e.stretch) * lying * slump, 0.55, 1.4);
    p.bulge = 1 / Math.sqrt(p.stretch);
    p.y = this.y + e.y;
    p.scale = clamp(1 + e.scale, 0.02, 1.3);

    const shake = Math.sin(t * 40) * 0.32 * this.shakeK;
    const no = Math.sin(t * TAU / 0.3) * 0.2 * this.noK;
    p.yaw = this.yaw + shake + no;
    p.pitch = -this.lookY * 0.1 * awake + 0.05 * this.sleepK + 0.12 * drowse + 0.03 * this.slumpK;
    p.roll = e.roll + this.slumpK * live * Math.sin(t * TAU / 4) * 1.5 * DEG;

    const droop = (11 * this.slumpK + 8 * this.sleepK * (1 - this.slumpK)) * DEG;
    const wiggle = this.wagK * live * Math.sin(t * 9) * 0.05;
    const flap = this.shakeK * Math.sin(t * 40) * 0.2;
    p.earL = this.earL + droop + wiggle + flap + e.earL;
    p.earR = this.earR + droop + wiggle - flap + e.earR;

    p.tuft = this.tuft;
    p.tuftSway = Math.sin(t * 1.7) * 0.06 * live;

    const bat = Math.sin(t * TAU / 1.04);
    const wave = Math.sin(t * TAU / 0.4);
    const raise = 0.1 * this.slumpK * -1 + this.armK * 1.5;
    p.armL = Math.max(raise, this.playK * (1.33 + 0.49 * bat)) + e.armL;
    p.armR = Math.max(raise, this.playK * (1.33 - 0.49 * bat), this.waveK * (2.5 + 0.35 * wave)) + e.armR;
    p.armLForward = e.armLForward;
    p.armRForward = 0;
    p.tuck = this.air ? smooth(0, 0.12, this.y) : 0;
    p.tail = this.wagK * live * Math.sin(t * 13) * 0.07;
    p.blink = this.eyesHeld ? 1 : this.blinkK;
    p.lookX = this.lookX;
    p.lookY = this.lookY;
    p.chew = this.eatK > 0 ? 0.5 + 0.5 * Math.sin(t * TAU / 0.3) : 0;
  }

  /** For the view's idle blink: when the next one is due, in seconds. */
  nextBlinkIn(lively: boolean): number {
    return lively ? 1.8 + this.random() * 3.7 : 4 + this.random() * 5;
  }
}
