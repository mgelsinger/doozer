// Doozer's body in the Desktop view: where it is, and the three things it can be doing
// about that. It is on the ground (standing, or walking along the line), it is being
// carried, or it is floating down after being let go.
//
// Never stuck (DESIGN_SPEC.md 6.4), in this file:
//   - There is one `mode`, and every way out of `carried` and `float` ends on the ground.
//     `settle()` puts Doozer on the line at once, whatever was going on.
//   - A walk and a float are functions of the clock (motion.ts). They end when their time
//     is up, on a timer; animation frames only make them smooth. A walk that is stopped
//     answers its caller "did not arrive", so whoever asked can tidy up.
//   - A carry has two limits of its own, on top of every way the view ends one: it cannot
//     outlast `CARRY_LIMIT_MS`, nor `CARRY_QUIET_MS` without a word from the pointer.
//   - `check()` lists anything that is not as it should be; the view's watchdog acts on it.
//
// No DOM in here: the view hands in `draw`.

import type { ExpressionName, Pose } from '../../character/expressions';
import { walkCycleMs } from '../../character/doozer';
import { floatMs, motionAt, type Motion } from './motion';
import type { NamedTimers } from './named-timers';
import type { Gait } from './pace';
import { carryAt, standAt, type Stage } from './stage';

export type BodyMode = 'ground' | 'carried' | 'float';

/** Why a carry ended. */
export type DropCause =
  | 'up' | 'cancel' | 'lost-capture' | 'released' | 'blur' | 'no-button'
  | 'limit' | 'quiet' | 'interrupted';

/** The little of the rig the body drives. `Doozer` from character/ satisfies it. */
export interface BodyRig {
  setPose(pose: Pose | null, face?: ExpressionName | null): void;
  setFacing(dir: -1 | 0 | 1): void;
  setWalkCycle(ms: number | null): void;
  squish(strength?: number): void;
}

/** Asks for one animation frame; returns the function that takes the request back. */
export type FrameSource = (callback: () => void) => () => void;

/** Called with the seconds since the last step, while something is moving. */
export type Ticker = (dt: number, now: number) => void;

export interface BodyOptions {
  rig: BodyRig;
  clock: NamedTimers;
  /** Milliseconds, monotonic. */
  now(): number;
  /** Null: no animation frames; everything still happens, on timers. */
  frame: FrameSource | null;
  stage: Stage;
  /** Where Doozer starts. */
  x: number;
  /** Put Doozer's soles at (x, y). */
  draw(x: number, y: number): void;
  /** It moved, or its mode changed: hit regions, liveliness. Not called on every frame. */
  changed(): void;
  /** It has come to rest on the ground after being carried. */
  landed(x: number): void;
  /** A carry has ended, however it ended. Called once it is already floating or down. */
  dropped(cause: DropCause): void;
  /** The face to wear while carried. */
  carriedFace(): ExpressionName | null;
  /** With motion reduced there is no float: Doozer is simply back on the line. */
  reduceMotion(): boolean;
  /** Where to count how carries ended, when the count should outlive this body. */
  drops?: Partial<Record<DropCause, number>>;
}

export interface WalkOptions {
  speed: number;
  gait: Gait;
  /** May leave the standing range (the peek goes half off the screen). */
  offstage?: boolean;
}

/** A carry ends by itself after this long, however it is being held. */
export const CARRY_LIMIT_MS = 120_000;
/** ...and after this long with no pointer event at all: the pointer is gone. */
export const CARRY_QUIET_MS = 30_000;
/** How often a move is advanced, the hit regions with it, when no frames are coming. */
export const STEP_MS = 33;
/** How long past its time a move may run before the watchdog calls it stuck. */
const OVERRUN_MS = 1500;

export class Body {
  private mode_: BodyMode = 'ground';
  private x_: number;
  private y_: number;
  private stage_: Stage;
  private motion: Motion | null = null;
  private walkDone: ((arrived: boolean) => void) | null = null;
  private grab: { dx: number; dy: number } | null = null;
  private since: number;
  private lastStep: number;
  private readonly tickers = new Set<Ticker>();
  private cancelFrame: (() => void) | null = null;
  private dead = false;
  /** How each carry ended, for the checks. */
  readonly drops: Partial<Record<DropCause, number>>;

  constructor(private readonly options: BodyOptions) {
    this.stage_ = options.stage;
    this.drops = options.drops ?? {};
    this.x_ = standAt(options.stage, options.x);
    this.y_ = options.stage.ground;
    this.since = options.now();
    this.lastStep = this.since;
    options.draw(this.x_, this.y_);
  }

  get mode(): BodyMode { return this.mode_; }
  get x(): number { return this.x_; }
  /** The soles of the feet. */
  get y(): number { return this.y_; }
  get stage(): Stage { return this.stage_; }
  get walking(): boolean { return this.motion?.kind === 'walk'; }
  /** True while a walk, a float or anything stepped is under way. */
  get moving(): boolean { return this.motion !== null || this.tickers.size > 0; }
  /** Standing on the line (walking counts). */
  get onGround(): boolean { return this.mode_ === 'ground'; }
  /** Outside the range Doozer may stand in (half-way off the screen for a peek). */
  get offstage(): boolean { return this.x_ < this.stage_.minX - 0.5 || this.x_ > this.stage_.maxX + 0.5; }
  /** How long it has been in this mode, in ms. */
  get age(): number { return this.options.now() - this.since; }

  // ---- walking ---------------------------------------------------------------------

  /**
   * Walk along the ground to `x`. Resolves true on arrival, false if the walk was stopped
   * (picked up, another scene, the view going away) or could not start. It always settles.
   */
  walkTo(x: number, walk: WalkOptions): Promise<boolean> {
    this.endWalk(false);
    if (this.dead || this.mode_ !== 'ground' || !Number.isFinite(x)) return Promise.resolve(false);
    const stage = this.stage_;
    const to = walk.offstage
      ? Math.min(stage.w + stage.size, Math.max(-stage.size, x))
      : standAt(stage, x);
    const distance = Math.abs(to - this.x_);
    if (distance < 0.5) return Promise.resolve(true);
    const speed = Math.max(5, walk.speed);
    return new Promise<boolean>((resolve) => {
      this.walkDone = resolve;
      this.motion = { kind: 'walk', x0: this.x_, y0: this.y_, x1: to, y1: this.y_, t0: this.options.now(), ms: (distance / speed) * 1000 };
      const rig = this.options.rig;
      rig.setFacing(to > this.x_ ? 1 : -1);
      rig.setWalkCycle(walkCycleMs(stage.size, speed, walk.gait));
      rig.setPose(walk.gait);
      this.run();
      this.options.changed();
    });
  }

  /** Stop walking, here. Whoever asked for the walk is told it did not arrive. */
  stop(): void {
    if (this.motion?.kind !== 'walk') return;
    this.sync();
    this.endWalk(false);
    this.options.draw(this.x_, this.y_);
    this.options.changed();
  }

  /** Shift along the ground by `dx` (chasing the ball). Only while standing. */
  shift(dx: number): void {
    if (this.dead || this.mode_ !== 'ground' || this.motion || !Number.isFinite(dx)) return;
    this.x_ = standAt(this.stage_, this.x_ + dx);
  }

  private endWalk(arrived: boolean): void {
    if (this.motion?.kind === 'walk') {
      this.motion = null;
      const rig = this.options.rig;
      rig.setPose(null);
      rig.setFacing(0);
      rig.setWalkCycle(null);
    }
    const done = this.walkDone;
    this.walkDone = null;
    done?.(arrived);
  }

  // ---- carried, and the float down ---------------------------------------------------

  /** The pointer has taken hold at (px, py). From anything: standing, walking, floating. */
  pickUp(px: number, py: number): void {
    if (this.dead) return;
    this.sync();
    this.endWalk(false);
    this.motion = null;
    this.grab = { dx: this.x_ - px, dy: this.y_ - py };
    this.enter('carried');
    this.options.rig.setFacing(0);
    this.options.rig.setPose('carried', this.options.carriedFace());
    this.options.clock.arm('carry-limit', CARRY_LIMIT_MS, () => this.drop('limit'));
    this.carryTo(px, py);
  }

  /** The pointer moved while carrying. */
  carryTo(px: number, py: number): void {
    if (this.mode_ !== 'carried' || !this.grab) return;
    const at = carryAt(this.stage_, px + this.grab.dx, py + this.grab.dy);
    this.x_ = at.x;
    this.y_ = at.y;
    this.options.clock.arm('carry-quiet', CARRY_QUIET_MS, () => this.drop('quiet'));
    this.options.draw(this.x_, this.y_);
    this.options.changed();
  }

  /** The face worn while carried may have changed (Doozer fell asleep in the hand). */
  refreshCarriedFace(): void {
    if (this.mode_ === 'carried') this.options.rig.setPose('carried', this.options.carriedFace());
  }

  /** Let go. In mid-air Doozer floats gently down to the line; on it, it is simply down. */
  drop(cause: DropCause): void {
    if (this.mode_ !== 'carried') return;
    this.drops[cause] = (this.drops[cause] ?? 0) + 1;
    this.grab = null;
    this.options.clock.disarm('carry-limit');
    this.options.clock.disarm('carry-quiet');
    const stage = this.stage_;
    const toX = standAt(stage, this.x_);
    const dx = toX - this.x_;
    const dy = stage.ground - this.y_;
    if (this.dead || this.options.reduceMotion() || (Math.abs(dx) < 2 && Math.abs(dy) < 2)) {
      this.land();
    } else {
      this.motion = { kind: 'float', x0: this.x_, y0: this.y_, x1: toX, y1: stage.ground, t0: this.options.now(), ms: floatMs(dx, dy) };
      this.enter('float');
      // Still off the ground: the dangling pose, with whatever face the mood gives.
      this.options.rig.setPose('carried', null);
      this.run();
      this.options.changed();
    }
    this.options.dropped(cause);
  }

  private land(): void {
    this.motion = null;
    this.x_ = standAt(this.stage_, this.x_);
    this.y_ = this.stage_.ground;
    this.enter('ground');
    const rig = this.options.rig;
    rig.setPose(null);
    rig.setFacing(0);
    rig.squish(0.8);
    this.options.draw(this.x_, this.y_);
    this.options.changed();
    this.options.landed(this.x_);
  }

  /**
   * Whatever was going on, Doozer is now standing on the line, at a place it may stand.
   * No animation. This is the way back that always works.
   */
  settle(): void {
    this.endWalk(false);
    this.motion = null;
    this.grab = null;
    this.options.clock.disarm('carry-limit');
    this.options.clock.disarm('carry-quiet');
    this.x_ = standAt(this.stage_, this.x_);
    this.y_ = this.stage_.ground;
    if (this.mode_ !== 'ground') this.enter('ground');
    const rig = this.options.rig;
    rig.setPose(null);
    rig.setFacing(0);
    rig.setWalkCycle(null);
    this.options.draw(this.x_, this.y_);
    this.options.changed();
  }

  /** Stand at `x`, now (the remembered spot on a monitor). Only while standing still. */
  standAt(x: number): void {
    if (this.mode_ !== 'ground' || this.motion) return;
    this.x_ = standAt(this.stage_, x);
    this.y_ = this.stage_.ground;
    this.options.draw(this.x_, this.y_);
    this.options.changed();
  }

  /** The screen, the taskbar or Doozer's size changed. */
  setStage(stage: Stage): void {
    this.sync();
    this.stage_ = stage;
    if (this.mode_ === 'ground') {
      // A walk was measured against the old screen: end it where it is.
      this.endWalk(false);
      this.motion = null;
      this.y_ = stage.ground;
      if (!Number.isFinite(this.x_)) this.x_ = standAt(stage, this.x_);
    } else if (this.mode_ === 'float' && this.motion) {
      const at = carryAt(stage, this.x_, this.y_);
      this.x_ = at.x;
      this.y_ = at.y;
      const toX = standAt(stage, this.x_);
      this.motion = { kind: 'float', x0: this.x_, y0: this.y_, x1: toX, y1: stage.ground, t0: this.options.now(), ms: floatMs(toX - this.x_, stage.ground - this.y_) };
    } else {
      const at = carryAt(stage, this.x_, this.y_);
      this.x_ = at.x;
      this.y_ = at.y;
    }
    this.options.draw(this.x_, this.y_);
    this.options.changed();
  }

  // ---- stepping ----------------------------------------------------------------------

  /** Run `ticker` on every step until the returned function is called. */
  addTicker(ticker: Ticker): () => void {
    if (this.dead) return () => {};
    this.tickers.add(ticker);
    this.run();
    return () => { this.tickers.delete(ticker); };
  }

  private enter(mode: BodyMode): void {
    this.mode_ = mode;
    this.since = this.options.now();
  }

  /** Bring x and y up to the clock. */
  private sync(): void {
    if (!this.motion) return;
    const at = motionAt(this.motion, this.options.now());
    this.x_ = at.x;
    this.y_ = at.y;
  }

  private run(): void {
    if (this.dead) return;
    this.lastStep = this.options.now();
    if (!this.options.clock.has('step')) this.options.clock.arm('step', STEP_MS, this.onStep);
    this.wantFrame();
  }

  private readonly onStep = (): void => {
    this.advance();
    if (this.dead) return;
    this.options.changed();
    if (this.moving) this.options.clock.arm('step', STEP_MS, this.onStep);
  };

  private wantFrame(): void {
    const frame = this.options.frame;
    if (!frame || this.cancelFrame || this.dead) return;
    this.cancelFrame = frame(() => {
      this.cancelFrame = null;
      if (this.dead || !this.moving) return;
      this.advance();
      this.wantFrame();
    });
  }

  /** Move everything on to the present moment and draw it. */
  private advance(): void {
    if (this.dead) return;
    const now = this.options.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastStep) / 1000));
    this.lastStep = now;
    const motion = this.motion;
    if (motion) {
      const at = motionAt(motion, now);
      this.x_ = at.x;
      this.y_ = at.y;
      if (at.done) {
        if (motion.kind === 'walk') this.endWalk(true);
        else this.land();
      }
    }
    for (const ticker of [...this.tickers]) {
      try { ticker(dt, now); } catch { this.tickers.delete(ticker); }
    }
    this.options.draw(this.x_, this.y_);
  }

  // ---- the watchdog's questions ------------------------------------------------------

  /** Everything about the body that is not as it should be. Empty when all is well. */
  check(): string[] {
    const problems: string[] = [];
    const stage = this.stage_;
    const now = this.options.now();
    if (!Number.isFinite(this.x_) || !Number.isFinite(this.y_)) problems.push('position is not a number');
    if (this.y_ > stage.ground + 0.5) problems.push('below the taskbar line');
    if (this.x_ < -stage.size * 1.5 || this.x_ > stage.w + stage.size * 1.5) problems.push('far off the screen');
    const motion = this.motion;
    if (motion && now - motion.t0 > motion.ms + OVERRUN_MS) problems.push(`a ${motion.kind} ran past its time`);
    if (motion && !this.options.clock.has('step')) problems.push(`a ${motion.kind} with nothing stepping it`);
    if (this.mode_ === 'ground') {
      if (Math.abs(this.y_ - stage.ground) > 0.5) problems.push('on the ground but not on the line');
      if (motion && motion.kind !== 'walk') problems.push('floating while on the ground');
      if (this.grab) problems.push('held while on the ground');
    } else if (this.mode_ === 'carried') {
      if (!this.grab) problems.push('carried by nothing');
      if (motion) problems.push('moving by itself while carried');
      if (now - this.since > CARRY_LIMIT_MS + OVERRUN_MS) problems.push('carried past the limit');
      if (!this.options.clock.has('carry-limit')) problems.push('carried with no limit running');
    } else {
      if (motion?.kind !== 'float') problems.push('in the air with no way down');
      if (this.grab) problems.push('held while floating');
    }
    if (this.walkDone && this.motion?.kind !== 'walk') problems.push('someone is waiting on a walk that is not happening');
    return problems;
  }

  /** Stop for good. Anyone waiting on a walk is told it did not arrive. */
  dispose(): void {
    if (this.dead) return;
    this.endWalk(false);
    this.dead = true;
    this.motion = null;
    this.grab = null;
    this.tickers.clear();
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.options.clock.disarm('step');
    this.options.clock.disarm('carry-limit');
    this.options.clock.disarm('carry-quiet');
  }
}
