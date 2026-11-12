// The kit's "nothing gets stuck" machinery. No DOM in this file, so every rule below
// is tested with a fake clock (lifecycle.test.ts):
//
//   Scope       - everything a component must undo, undone exactly once.
//   Transients  - things that must remove themselves (emotes, particles).
//   SceneRunner - one little scene at a time; a new one, a cancel or a time limit
//                 always cleans the old one up completely.
//   Disclosure  - an open/closed menu that an interruption always closes.

import { realTimers, type Timers } from '../character/timers';

export type Disposer = () => void;

function safely(fn: Disposer): void {
  try { fn(); } catch { /* one failed clean-up must not stop the others */ }
}

// ---- Scope ------------------------------------------------------------------------

export class Scope {
  private items: Disposer[] = [];
  private done = false;

  get disposed(): boolean { return this.done; }

  /** Register a clean-up. Returns a function that runs it early (and only once). */
  add(fn: Disposer): Disposer {
    if (this.done) { safely(fn); return () => {}; }
    let spent = false;
    const once = () => {
      if (spent) return;
      spent = true;
      const i = this.items.indexOf(once);
      if (i >= 0) this.items.splice(i, 1);
      safely(fn);
    };
    this.items.push(once);
    return once;
  }

  /** A timeout that is cancelled with the scope. */
  after(ms: number, fn: () => void, timers: Timers = realTimers): Disposer {
    if (this.done) return () => {};
    let cancel: Disposer = () => {};
    const handle = timers.set(() => { cancel(); if (!this.done) fn(); }, ms);
    cancel = this.add(() => timers.clear(handle));
    return cancel;
  }

  /** Newest first, each exactly once. Safe to call twice. */
  dispose(): void {
    if (this.done) return;
    this.done = true;
    const items = this.items.reverse();
    this.items = [];
    for (const fn of items) fn();
  }
}

// ---- Transients ---------------------------------------------------------------------

export interface TransientsOptions<T> {
  /** Take the thing off the page. Called exactly once per item. */
  remove(item: T): void;
  timers?: Timers;
  /** Most that may exist at once; adding another removes the oldest. */
  max?: number;
}

/** Things that must go away by themselves. Removal is by timer, never by an animation event. */
export class Transients<T> {
  private live = new Map<T, unknown>();
  private readonly timers: Timers;
  private readonly max: number;
  private dead = false;

  constructor(private readonly options: TransientsOptions<T>) {
    this.timers = options.timers ?? realTimers;
    this.max = Math.max(1, options.max ?? 16);
  }

  get size(): number { return this.live.size; }

  /** False (and the item is removed at once) if the set has been destroyed. */
  add(item: T, lifeMs: number): boolean {
    if (this.dead) { safely(() => this.options.remove(item)); return false; }
    while (this.live.size >= this.max) {
      const oldest = this.live.keys().next();
      if (oldest.done) break;
      this.drop(oldest.value);
    }
    const life = Number.isFinite(lifeMs) ? Math.min(30_000, Math.max(0, lifeMs)) : 1500;
    this.live.set(item, this.timers.set(() => this.drop(item), life));
    return true;
  }

  drop(item: T): void {
    if (!this.live.has(item)) return;
    this.timers.clear(this.live.get(item));
    this.live.delete(item);
    safely(() => this.options.remove(item));
  }

  clear(): void {
    for (const item of [...this.live.keys()]) this.drop(item);
  }

  destroy(): void {
    this.clear();
    this.dead = true;
  }
}

// ---- SceneRunner --------------------------------------------------------------------

export type SceneOutcome = 'finished' | 'interrupted' | 'timed-out' | 'failed';

export interface SceneContext {
  /** True until the scene ends. */
  readonly alive: boolean;
  /** Resolves after `ms`. If the scene has ended it never resolves: the script simply stops. */
  wait(ms: number): Promise<void>;
  /** Await something outside the scene (an animation). Never resumes a scene that has ended. */
  until<T>(promise: Promise<T>): Promise<T>;
  /** Undo this when the scene ends, however it ends. */
  cleanup(fn: Disposer): void;
}

export interface SceneRunnerOptions {
  timers?: Timers;
  /** No scene may run longer than this. */
  maxMs?: number;
  /** Called after every scene has been cleaned up. */
  onEnd?(name: string, outcome: SceneOutcome): void;
}

interface Running {
  name: string;
  scope: Scope;
  settle: (outcome: SceneOutcome) => void;
}

/**
 * Plays one scene at a time. A scene is an async script that only pauses through its
 * context, so ending it is just: run its clean-ups and never resume it. That makes
 * "interrupted at any step" the same code path as "finished".
 */
export class SceneRunner {
  private current: Running | null = null;
  private dead = false;
  private readonly timers: Timers;
  private readonly maxMs: number;

  constructor(private readonly options: SceneRunnerOptions = {}) {
    this.timers = options.timers ?? realTimers;
    this.maxMs = options.maxMs ?? 8000;
  }

  /** The name of the scene that is playing, or null. */
  get active(): string | null { return this.current?.name ?? null; }

  play(name: string, script: (scene: SceneContext) => Promise<void> | void, maxMs = this.maxMs): Promise<SceneOutcome> {
    this.cancel();
    if (this.dead) return Promise.resolve('interrupted');

    return new Promise<SceneOutcome>((settle) => {
      const scope = new Scope();
      const running: Running = { name, scope, settle };
      this.current = running;
      const timers = this.timers;
      const never = <T>() => new Promise<T>(() => {});

      const context: SceneContext = {
        get alive() { return !scope.disposed; },
        wait: (ms) => (scope.disposed ? never<void>() : new Promise<void>((resolve) => { scope.after(Math.max(0, ms), resolve, timers); })),
        until: (promise) => new Promise((resolve, reject) => {
          promise.then(
            (value) => { if (!scope.disposed) resolve(value); },
            (error) => { if (!scope.disposed) reject(error); },
          );
        }),
        cleanup: (fn) => { scope.add(fn); },
      };

      scope.after(maxMs, () => this.end(running, 'timed-out'), timers);

      let result: Promise<void> | void;
      try { result = script(context); } catch { this.end(running, 'failed'); return; }
      Promise.resolve(result).then(
        () => this.end(running, 'finished'),
        () => this.end(running, 'failed'),
      );
    });
  }

  /** End the current scene now, cleaning up everything it registered. */
  cancel(): void {
    if (this.current) this.end(this.current, 'interrupted');
  }

  destroy(): void {
    this.cancel();
    this.dead = true;
  }

  private end(running: Running, outcome: SceneOutcome): void {
    if (this.current !== running) return;   // already ended some other way
    this.current = null;
    running.scope.dispose();
    try { this.options.onEnd?.(running.name, outcome); } catch { /* reporting only */ }
    running.settle(outcome);
  }
}

// ---- Disclosure ---------------------------------------------------------------------

export type CloseReason = 'api' | 'choice' | 'escape' | 'outside' | 'interrupt' | 'idle' | 'destroy';

export interface DisclosureOptions {
  onChange(open: boolean, reason: CloseReason | 'open'): void;
  /** Close by itself after this long with nobody hovering or focused inside. null = never. */
  idleMs?: number | null;
  timers?: Timers;
}

/**
 * Open/closed state for a menu. The visual state is whatever `onChange` last said, so
 * there is no "opening" or "closing" phase to get stuck in: rapid toggles just flip it.
 */
export class Disclosure {
  private open_ = false;
  private held = false;
  private idleTimer: unknown = null;
  private dead = false;
  private readonly timers: Timers;
  private readonly idleMs: number | null;

  constructor(private readonly options: DisclosureOptions) {
    this.timers = options.timers ?? realTimers;
    this.idleMs = options.idleMs === undefined ? 9000 : options.idleMs;
  }

  get isOpen(): boolean { return this.open_; }

  open(): void {
    if (this.dead || this.open_) { this.touch(); return; }
    this.open_ = true;
    this.armIdle();
    this.options.onChange(true, 'open');
  }

  close(reason: CloseReason = 'api'): void {
    if (!this.open_) return;
    this.open_ = false;
    this.held = false;
    this.disarmIdle();
    this.options.onChange(false, reason);
  }

  toggle(): void {
    if (this.open_) this.close('api'); else this.open();
  }

  /** Doozer was picked up, started doing something, fell asleep, or the view is going away. */
  interrupt(): void { this.close('interrupt'); }

  /** Something happened inside the menu: start the idle countdown again. */
  touch(): void {
    if (this.open_ && !this.held) this.armIdle();
  }

  /** While held (pointer over the menu, or keyboard focus inside) the menu does not idle out. */
  hold(on: boolean): void {
    if (!this.open_) return;
    this.held = on;
    if (on) this.disarmIdle(); else this.armIdle();
  }

  destroy(): void {
    this.close('destroy');
    this.dead = true;
  }

  private armIdle(): void {
    this.disarmIdle();
    if (this.idleMs === null) return;
    this.idleTimer = this.timers.set(() => { this.idleTimer = null; this.close('idle'); }, this.idleMs);
  }

  private disarmIdle(): void {
    if (this.idleTimer !== null) this.timers.clear(this.idleTimer);
    this.idleTimer = null;
  }
}
