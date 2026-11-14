// What happens on the island, as numbers: where Doozer is and where it is hopping to, the
// ball, the snack that was dropped, crumbs and raindrops, and how far night has fallen.
// Pure: no DOM and no three.js. The stage (stage3d.ts) draws this; the director
// (director.ts) tells it what to do.
//
// Never stuck:
//   - Doozer's trip across the island is a promise that always settles: on arrival, when
//     something else replaces it, or when the director gives up on it (`arriveNow`).
//   - The ball loses speed on every bounce and is put to rest after `BALL_LIMIT_S` of
//     moving no matter what; it cannot leave the island.
//   - Crumbs and drops have a lifetime. Night eases toward one of two values.
//   - `settle()` puts everything where it was going, at once.
//   - `moving` says whether anything here still needs frames.

import type { FoodId, ToyId } from '../../core/contract';
import type { BodyMotion } from '../../character/body-motion';
import { HOME, ISLAND, groundY } from './layout';

export type PlayToy = Exclude<ToyId, 'duck'>;

export interface Snack {
  /** Goes up with every snack dropped, so the stage knows when to build a new one. */
  readonly serial: number;
  readonly food: FoodId;
  x: number; y: number; z: number;
  vy: number;
  landed: boolean;
  bounced: boolean;
  /** 0..3 bites taken. */
  bites: number;
  /** How much of it is left, as a scale. */
  size: number;
  /** A turn about the vertical, different every time. */
  readonly turn: number;
}

export interface Ball {
  toy: PlayToy;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  /** How far it has rolled about x and z, for drawing. */
  rollX: number;
  rollZ: number;
  resting: boolean;
  /** Seconds it has been moving since it was last touched. */
  movedFor: number;
}

export type ParticleKind = 'crumb' | 'star' | 'drop';

export interface Particle {
  kind: ParticleKind;
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  life: number;
  readonly span: number;
  readonly size: number;
  readonly gravity: number;
}

export interface WorldOptions {
  random?: () => number;
  /** Doozer kicked the ball. */
  onKick?(): void;
  /** Something landed: the snack or the ball, at this speed. */
  onThud?(what: 'snack' | 'ball', speed: number): void;
  /** Something here was changed from outside a frame: the view should draw again. */
  invalidate?(): void;
}

export const BALL_RADIUS = 0.24;
/** The ball is put to rest after this long without being touched. */
export const BALL_LIMIT_S = 7;
const TRAVEL_SPEED = 1.55;
const MAX_PARTICLES = 60;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class World {
  /** Where Doozer's feet are on the island. */
  readonly doozer = { x: HOME.x as number, z: HOME.z as number };
  ball: Ball | null = null;
  snack: Snack | null = null;
  readonly particles: Particle[] = [];
  /** 0 day .. 1 night. */
  night = 0;
  /** The bath duck beside Doozer, and the rain cloud over it: each 0..1. */
  duck = 0;
  rain = 0;
  /** Time for the things that only drift while someone is looking: fireflies, twinkling. */
  ambient = 0;
  /** Kicks since the count was last reset (a game of ball counts them). */
  kicks = 0;

  private readonly random: () => number;
  private readonly onKick?: () => void;
  private readonly onThud?: (what: 'snack' | 'ball', speed: number) => void;
  private readonly touch: () => void;
  private trip: { x: number; z: number; settle: (arrived: boolean) => void } | null = null;
  private chasing = false;
  private nightTarget = 0;
  private duckTarget = 0;
  private rainTarget = 0;
  private dropIn = 0;
  private kickCooldown = 0;
  private serial = 0;
  private lively = false;
  private reduce = false;

  constructor(options: WorldOptions = {}) {
    this.random = options.random ?? Math.random;
    this.onKick = options.onKick;
    this.onThud = options.onThud;
    this.touch = options.invalidate ?? (() => undefined);
  }

  private between(lo: number, hi: number): number { return lo + this.random() * (hi - lo); }

  // ---- Doozer's trips ----------------------------------------------------------------

  /**
   * Hop to a spot. Resolves true on arrival, false if another trip or `stopTravel`
   * replaced this one. With motion reduced Doozer is simply put there.
   */
  travelTo(x: number, z: number): Promise<boolean> {
    this.stopTravel();
    const to = this.onIsland(x, z, ISLAND.reach);
    if (this.reduce) {
      this.doozer.x = to.x; this.doozer.z = to.z;
      this.touch();
      return Promise.resolve(true);
    }
    this.touch();
    return new Promise((settle) => { this.trip = { x: to.x, z: to.z, settle }; });
  }

  /** Give up on the trip in progress: Doozer stays where it has got to. */
  stopTravel(): void {
    const trip = this.trip;
    this.trip = null;
    this.chasing = false;
    trip?.settle(false);
  }

  /** Put Doozer at the end of its trip now (the director's time limit ran out). */
  arriveNow(): void {
    const trip = this.trip;
    if (!trip) return;
    this.trip = null;
    this.doozer.x = trip.x; this.doozer.z = trip.z;
    this.touch();
    trip.settle(true);
  }

  get travelling(): boolean { return this.trip !== null || this.chasing; }

  /** Run after the ball (true) or stop (false). */
  chase(on: boolean): void {
    if (on) this.stopTravel();
    this.chasing = on && this.ball !== null;
    this.touch();
  }

  private onIsland(x: number, z: number, limit: number): { x: number; z: number } {
    const fx = Number.isFinite(x) ? x : HOME.x;
    const fz = Number.isFinite(z) ? z : HOME.z;
    const r = Math.hypot(fx, fz);
    return r > limit ? { x: (fx / r) * limit, z: (fz / r) * limit } : { x: fx, z: fz };
  }

  // ---- things --------------------------------------------------------------------------

  dropSnack(food: FoodId, x: number, z: number): Snack {
    const at = this.onIsland(x, z, ISLAND.reach + 0.1);
    this.snack = { serial: ++this.serial, food, x: at.x, y: 3.6, z: at.z, vy: 0, landed: false, bounced: false, bites: 0, size: 1, turn: this.between(-0.6, 0.6) };
    this.touch();
    return this.snack;
  }

  /** One bite: the snack gets smaller and sheds crumbs. */
  biteSnack(): void {
    const snack = this.snack;
    if (!snack) return;
    snack.bites = Math.min(3, snack.bites + 1);
    snack.size *= 0.66;
    this.burst('crumb', snack.x, snack.y + 0.2, snack.z, 5, { size: 0.09, up: 1.4, gravity: -6, life: 0.6, spread: 0.08, out: 0.9 });
  }

  removeSnack(): void {
    if (!this.snack) return;
    this.snack = null;
    this.touch();
  }

  /** A tap on the snack: it hops. (Doozer still eats it.) */
  bopSnack(): void {
    const snack = this.snack;
    if (!snack || !snack.landed) return;
    snack.landed = false;
    snack.bounced = true;
    snack.vy = 2.6;
    this.touch();
  }

  /** Drop the ball from the sky, or toss the one already there. */
  serveBall(toy: PlayToy): Ball {
    if (this.ball) {
      this.ball.toy = toy;
      this.bopBall();
      return this.ball;
    }
    const side = this.doozer.x > 0 ? -1 : 1;
    this.ball = {
      toy, x: clamp(this.doozer.x + side * 0.9, -1.2, 1.2), y: 3.4, z: clamp(this.doozer.z + 0.2, 0, 0.8),
      vx: side * -0.4, vy: 0, vz: 0, rollX: 0, rollZ: 0, resting: false, movedFor: 0,
    };
    this.touch();
    return this.ball;
  }

  /** A tap on the ball: up it goes. */
  bopBall(): void {
    const ball = this.ball;
    if (!ball) return;
    ball.vy = 5.2;
    ball.vx += this.between(-1, 1);
    ball.vz += this.between(-0.8, 0.8);
    ball.resting = false;
    ball.movedFor = 0;
    this.touch();
  }

  removeBall(): void {
    const ball = this.ball;
    if (!ball) return;
    this.burst('star', ball.x, ball.y, ball.z, 4, { size: 0.22, up: 0.6 });
    this.ball = null;
    this.chasing = false;
    this.touch();
  }

  burst(kind: ParticleKind, x: number, y: number, z: number, count: number,
    options: { spread?: number; up?: number; size?: number; life?: number; gravity?: number; out?: number } = {}): void {
    const { spread = 0.35, up = 1.1, size = 0.3, life = 1.2, gravity = 0, out = 0.5 } = options;
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const span = life * this.between(0.8, 1.15);
      this.particles.push({
        kind, x: x + this.between(-spread, spread), y: y + this.between(-spread, spread) * 0.6, z: z + this.between(-spread, spread) * 0.5 + 0.3,
        vx: this.between(-out, out), vy: up * this.between(0.7, 1.2), vz: this.between(-out, out) * 0.4,
        life: span, span, size: size * this.between(0.8, 1.2), gravity,
      });
    }
    if (count > 0) this.touch();
  }

  // ---- the sky, and what comes with a bath -----------------------------------------------

  setNight(on: boolean): void { this.aim('nightTarget', on); }
  setDuck(on: boolean): void { this.aim('duckTarget', on); }
  setRain(on: boolean): void { this.aim('rainTarget', on); }
  private aim(key: 'nightTarget' | 'duckTarget' | 'rainTarget', on: boolean): void {
    const value = on ? 1 : 0;
    if (this[key] === value) return;
    this[key] = value;
    this.touch();
  }
  /** True while someone is there to watch: fireflies drift and stars twinkle. */
  setLively(on: boolean): void { this.lively = on; }
  /** With motion reduced Doozer is placed rather than hopped, and nothing drifts. */
  setReduceMotion(on: boolean): void {
    this.reduce = on;
    if (on) this.settle();
  }

  /** Move the fireflies on a little without anyone watching: one still frame, now and then. */
  wink(seconds = 0.35): void {
    this.ambient += seconds;
    this.touch();
  }

  // ---- time ----------------------------------------------------------------------------

  get moving(): boolean {
    return this.trip !== null || this.chasing || (this.ball !== null && !this.ball.resting) || (this.snack !== null && !this.snack.landed)
      || this.particles.length > 0 || this.night !== this.nightTarget || this.duck !== this.duckTarget || this.rain !== this.rainTarget
      || this.rain > 0;
  }

  /** Everything where it was going, now. */
  settle(): void {
    this.arriveNow();
    this.chasing = false;
    const ball = this.ball;
    if (ball) {
      ball.vx = 0; ball.vy = 0; ball.vz = 0;
      ball.y = groundY(ball.x, ball.z) + BALL_RADIUS;
      ball.resting = true;
    }
    const snack = this.snack;
    if (snack) { snack.y = groundY(snack.x, snack.z); snack.vy = 0; snack.landed = true; }
    this.particles.length = 0;
    this.night = this.nightTarget;
    this.duck = this.duckTarget;
    this.rainTarget = 0;
    this.rain = 0;
    this.touch();
  }

  update(dt: number, body: BodyMotion): void {
    let left = Number.isFinite(dt) ? clamp(dt, 0, 2) : 0;
    while (left > 1e-6) {
      const step = Math.min(left, 0.05);
      this.step(step, body);
      left -= step;
    }
  }

  private step(dt: number, body: BodyMotion): void {
    const ease = (from: number, to: number, rate: number): number => {
      const next = from + (to - from) * (1 - Math.exp(-rate * dt));
      return Math.abs(next - to) < 0.003 ? to : next;
    };
    this.kickCooldown -= dt;
    if (this.lively && !this.reduce) this.ambient += dt;

    this.stepDoozer(dt, body);
    this.stepBall(dt, body);
    this.stepSnack(dt);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i] as Particle;
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }

    this.night = ease(this.night, this.nightTarget, 1.6);
    this.duck = ease(this.duck, this.duckTarget, 9);
    this.rain = ease(this.rain, this.rainTarget, 7);
    if (this.rain > 0.5) {
      this.dropIn -= dt;
      if (this.dropIn <= 0) {
        this.dropIn = 0.05;
        const top = groundY(this.doozer.x, this.doozer.z) + 2.1;
        this.burst('drop', this.doozer.x, top, this.doozer.z - 0.3, 1, { spread: 0.42, up: -2.6, size: 0.1, life: 0.5, gravity: -7, out: 0.05 });
      }
    }
  }

  private stepDoozer(dt: number, body: BodyMotion): void {
    const ball = this.ball;
    if (this.chasing && !ball) this.chasing = false;
    const to = this.chasing && ball ? { x: clamp(ball.x, -1.05, 1.05), z: clamp(ball.z, -0.5, 0.95) } : this.trip;
    if (!to) return;
    const dx = to.x - this.doozer.x;
    const dz = to.z - this.doozer.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.1) {
      if (!this.chasing) {
        const trip = this.trip;
        this.trip = null;
        body.setFacing(null);
        trip?.settle(true);
      }
      return;
    }
    // Doozer travels in hops: it only covers ground while it is in the air.
    if (body.grounded) body.hop(3.4);
    if (!body.grounded) {
      const stride = Math.min(distance, TRAVEL_SPEED * dt);
      this.doozer.x += (dx / distance) * stride;
      this.doozer.z += (dz / distance) * stride;
    }
    body.setFacing(clamp(Math.atan2(dx, dz), -1.05, 1.05));
  }

  private stepBall(dt: number, body: BodyMotion): void {
    const ball = this.ball;
    if (!ball || ball.resting) return;
    ball.movedFor += dt;
    ball.vy -= 14 * dt;
    ball.x += ball.vx * dt; ball.y += ball.vy * dt; ball.z += ball.vz * dt;

    const floor = groundY(ball.x, ball.z) + BALL_RADIUS;
    if (ball.y < floor) {
      ball.y = floor;
      if (ball.vy < -1.2) this.onThud?.('ball', -ball.vy);
      ball.vy = ball.vy < -0.9 ? -ball.vy * 0.6 : 0;
      // Rolling on the grass slows it down.
      const grip = Math.exp(-2.2 * dt);
      ball.vx *= grip; ball.vz *= grip;
    }
    // It cannot leave the island.
    const r = Math.hypot(ball.x, ball.z);
    if (r > ISLAND.fence) {
      const nx = ball.x / r;
      const nz = ball.z / r;
      const outward = ball.vx * nx + ball.vz * nz;
      if (outward > 0) { ball.vx -= 1.8 * outward * nx; ball.vz -= 1.8 * outward * nz; }
      ball.x = nx * ISLAND.fence; ball.z = nz * ISLAND.fence;
    }
    // Meeting Doozer: a kick while they are playing, otherwise a soft bump.
    const centreY = groundY(this.doozer.x, this.doozer.z) + body.height + 0.8;
    const dx = ball.x - this.doozer.x;
    const dy = ball.y - centreY;
    const dz = ball.z - this.doozer.z;
    const gap = Math.hypot(dx, dy, dz);
    if (gap < 1.02) {
      if (this.chasing && this.kickCooldown <= 0 && !body.asleep) {
        this.kickCooldown = 0.4;
        this.kick(ball, body);
      } else if (gap < 0.94) {
        const flat = Math.hypot(dx, dz) || 1;
        ball.x = this.doozer.x + (dx / flat) * 0.94; ball.z = this.doozer.z + (dz / flat) * 0.94;
        ball.vx = (dx / flat) * 0.5; ball.vz = (dz / flat) * 0.5;
      }
    }
    ball.rollZ -= (ball.vx * dt) / BALL_RADIUS;
    ball.rollX += (ball.vz * dt) / BALL_RADIUS;

    const slow = ball.y <= floor + 0.002 && Math.abs(ball.vy) < 0.05 && Math.hypot(ball.vx, ball.vz) < 0.06;
    if (slow || ball.movedFor > BALL_LIMIT_S) {
      ball.vx = 0; ball.vy = 0; ball.vz = 0;
      ball.y = groundY(ball.x, ball.z) + BALL_RADIUS;
      ball.resting = true;
    }
  }

  private kick(ball: Ball, body: BodyMotion): void {
    let dx = ball.x - this.doozer.x;
    let dz = ball.z - this.doozer.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d; dz /= d;
    // Never kick it off the edge: aim back toward the middle instead.
    if (Math.hypot(ball.x + dx, ball.z + dz) > ISLAND.fence) {
      dx = -ball.x; dz = -ball.z + 0.3;
      const n = Math.hypot(dx, dz) || 1;
      dx /= n; dz /= n;
    }
    const speed = this.between(1.2, 2.1);
    ball.vx = dx * speed; ball.vy = this.between(4.4, 5.6); ball.vz = dz * speed;
    ball.movedFor = 0;
    body.squish(0.64);
    this.kicks++;
    this.onKick?.();
  }

  private stepSnack(dt: number): void {
    const snack = this.snack;
    if (!snack || snack.landed) return;
    snack.vy -= 15 * dt;
    snack.y += snack.vy * dt;
    const floor = groundY(snack.x, snack.z);
    if (snack.y <= floor) {
      snack.y = floor;
      if (snack.vy < -2.5 && !snack.bounced) {
        this.onThud?.('snack', -snack.vy);
        snack.vy = -snack.vy * 0.32;
        snack.bounced = true;
      } else {
        snack.vy = 0;
        snack.landed = true;
      }
    }
  }
}
