// What Doozer's face and body are doing right now, and the guarantee that anything
// temporary ends. No DOM in here: the rig (doozer.ts) is a thin driver on top, and the
// tests drive this with a fake clock.
//
// Three layers, highest priority first:
//   1. one transient - a flash (a temporary face) or a performance (a one-shot piece of
//      choreography). Starting a new one ends the old one completely. Every transient is
//      ended by a timer, so nothing can be left half-finished.
//   2. a pose override set by the view (walk, carried, read...), optionally with a face.
//   3. the mood - the lasting expression, which is what everything returns to.

import { EXPRESSIONS, isExpressionName, type ExpressionName, type Eyes, type Mouth, type Pose } from './expressions';
import { PERFORMANCES, isPerformanceName, type PerformanceName } from './performances';
import { realTimers, type Timers } from './timers';

/** Everything the rig needs to draw one moment. */
export interface Look {
  /** The expression whose face is showing. */
  readonly expression: ExpressionName;
  readonly eyes: Eyes;
  readonly mouth: Mouth;
  readonly tuft: number;
  readonly blush: boolean;
  readonly glasses: boolean;
  readonly extra: 'drool' | 'dirt' | null;
  readonly pose: Pose;
  readonly performing: PerformanceName | null;
}

export interface ExpressionDriver {
  apply(look: Look): void;
  /** Start a performance's body animation. Returns the function that stops it. */
  startPerformance?(name: PerformanceName, strength: number): (() => void) | void;
}

export type PerformanceOutcome = 'finished' | 'interrupted';

export interface ExpressionStateOptions {
  timers?: Timers;
  reduceMotion?: boolean;
}

/** A flash can be asked to last any time; it is held to this range so it always ends. */
export const FLASH_MIN_MS = 60;
export const FLASH_MAX_MS = 60_000;

type Transient =
  | { kind: 'flash'; face: ExpressionName; timers: unknown[] }
  | {
      kind: 'perform';
      name: PerformanceName;
      face: ExpressionName | null;
      pose: Pose | null;
      timers: unknown[];
      stopBody: (() => void) | null;
      resolve: (outcome: PerformanceOutcome) => void;
    };

export class ExpressionState {
  private moodName: ExpressionName = 'content';
  private poseOverride: Pose | null = null;
  private poseFace: ExpressionName | null = null;
  private transient: Transient | null = null;
  private reduceMotion: boolean;
  private destroyed = false;
  private readonly timers: Timers;

  constructor(private readonly driver: ExpressionDriver, options: ExpressionStateOptions = {}) {
    this.timers = options.timers ?? realTimers;
    this.reduceMotion = options.reduceMotion ?? false;
  }

  /** The lasting expression. */
  get mood(): ExpressionName { return this.moodName; }
  /** The expression whose face is showing this moment. */
  get showing(): ExpressionName { return this.look().expression; }
  /** True while a flash or a performance is running. */
  get busy(): boolean { return this.transient !== null; }
  get performing(): PerformanceName | null {
    return this.transient?.kind === 'perform' ? this.transient.name : null;
  }
  get pose(): Pose { return this.look().pose; }

  /** Set the lasting expression. If something temporary is showing, it takes effect when that ends. */
  setMood(name: ExpressionName): void {
    if (this.destroyed) return;
    this.moodName = isExpressionName(name) ? name : 'content';
    this.render();
  }

  /** Show a face for a while, then return to the mood. Replaces any flash or performance. */
  flash(name: ExpressionName, ms = 1200): void {
    if (this.destroyed || !isExpressionName(name)) return;
    this.endTransient('interrupted');
    const life = Number.isFinite(ms) ? Math.min(FLASH_MAX_MS, Math.max(FLASH_MIN_MS, ms)) : 1200;
    const flash: Transient = { kind: 'flash', face: name, timers: [] };
    this.transient = flash;
    flash.timers.push(this.timers.set(() => {
      if (this.transient !== flash) return;
      this.endTransient('finished');
      this.render();
    }, life));
    this.render();
  }

  /**
   * Hold a body pose regardless of mood (walk, carried, read...); `null` releases it.
   * `face` optionally shows an expression for as long as the pose is held.
   */
  setPose(pose: Pose | null, face: ExpressionName | null = null): void {
    if (this.destroyed) return;
    this.poseOverride = pose;
    this.poseFace = pose !== null && face !== null && isExpressionName(face) ? face : null;
    this.render();
  }

  /**
   * Play a one-shot. The promise always settles: 'finished' when it ran to its end,
   * 'interrupted' when something else replaced it or the rig was stopped or destroyed.
   */
  perform(name: PerformanceName, strength = 1): Promise<PerformanceOutcome> {
    if (this.destroyed || !isPerformanceName(name)) return Promise.resolve('interrupted');
    this.endTransient('interrupted');
    const spec = PERFORMANCES[name];
    const faces = spec.faces ?? [];

    // With motion reduced the body does not move. A performance that is only movement
    // is over at once; one with faces still shows them, because they carry meaning.
    if (this.reduceMotion && faces.length === 0) {
      this.render();
      return Promise.resolve('finished');
    }

    return new Promise<PerformanceOutcome>((resolve) => {
      const run: Transient = {
        kind: 'perform', name, face: null, pose: spec.pose, timers: [], stopBody: null, resolve,
      };
      this.transient = run;

      for (const [at, face] of faces) {
        if (at <= 0) { run.face = face; continue; }
        run.timers.push(this.timers.set(() => {
          if (this.transient !== run) return;
          run.face = face;
          this.render();
        }, at));
      }
      run.timers.push(this.timers.set(() => {
        if (this.transient !== run) return;
        this.endTransient('finished');
        this.render();
      }, spec.duration));

      this.render();
      if (!this.reduceMotion) {
        const s = Number.isFinite(strength) ? Math.min(2, Math.max(0.2, strength)) : 1;
        try {
          const stop = this.driver.startPerformance?.(name, s);
          // The driver may have been told to stop again from inside its own callback.
          if (this.transient === run) run.stopBody = stop ?? null;
          else stop?.();
        } catch {
          // A failed animation must not leave the state believing it is still mid-performance
          // for longer than the timer above allows; nothing more to do here.
        }
      }
    });
  }

  /** End whatever is temporary, now, and show the mood. */
  stop(): void {
    if (this.destroyed) return;
    this.endTransient('interrupted');
    this.render();
  }

  setReduceMotion(on: boolean): void {
    this.reduceMotion = on;
  }

  /** End everything and go silent. Safe to call twice. */
  destroy(): void {
    if (this.destroyed) return;
    this.endTransient('interrupted');
    this.destroyed = true;
  }

  /** The current look, computed from the three layers. */
  look(): Look {
    const t = this.transient;
    const face = t?.face ?? this.poseFace ?? this.moodName;
    const exp = EXPRESSIONS[face];
    const performPose = t?.kind === 'perform' ? t.pose : null;
    return {
      expression: face,
      eyes: exp.eyes,
      mouth: exp.mouth,
      tuft: exp.tuft,
      blush: exp.blush === true,
      glasses: exp.glasses === true,
      extra: exp.extra ?? null,
      pose: performPose ?? this.poseOverride ?? exp.pose,
      performing: t?.kind === 'perform' ? t.name : null,
    };
  }

  // The single way a transient ends. Clears its timers, stops its body animation and
  // settles its promise, in that order, and never throws.
  private endTransient(outcome: PerformanceOutcome): void {
    const t = this.transient;
    if (!t) return;
    this.transient = null;
    for (const handle of t.timers) this.timers.clear(handle);
    if (t.kind === 'perform') {
      try { t.stopBody?.(); } catch { /* the animation is gone either way */ }
      t.resolve(outcome);
    }
  }

  private render(): void {
    if (this.destroyed) return;
    this.driver.apply(this.look());
  }
}
