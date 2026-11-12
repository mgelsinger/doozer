// From the brain to Doozer's face and little scenes. Two pieces, both free of the DOM
// (they talk to small interfaces), so the "nothing gets stuck" rules are tested with a
// fake clock in presenter.test.ts:
//
//   syncDoozer    - the lasting look: mood face, glasses, hat, grime, palette.
//   StageDirector - the reactions: eat, play, wash, pet, sleep, wake, refuse, celebrate.
//
// The Card's stage uses both. A view with its own choreography (the Room walks Doozer to
// the bowl) can use syncDoozer alone and write its own scenes with SceneRunner.

import type { Brain, BrainEvents, FoodId, HatId, Limits, PaletteId, PetState, ToyId, UnlockId } from '../core/contract';
import type { ExpressionName } from '../character/expressions';
import type { PerformanceOutcome } from '../character/expression-state';
import type { PerformanceName } from '../character/performances';
import type { Pose } from '../character/expressions';
import { realTimers, type Timers } from '../character/timers';
import { SceneRunner, Scope, type Disposer, type SceneContext } from './lifecycle';

/** The part of the rig the presenter uses. `Doozer` from character/ satisfies it. */
export interface PetActor {
  setMood(name: ExpressionName): void;
  flash(name: ExpressionName, ms?: number): void;
  setPose(pose: Pose | null, face?: ExpressionName | null): void;
  lookAt(x: number, y: number): void;
  perform(name: PerformanceName, strength?: number): Promise<PerformanceOutcome>;
  squish(strength?: number): void;
  stop(): void;
  setGlasses(on: boolean): void;
  setHat(hat: HatId | null): void;
  setDirt(on: boolean): void;
  setPalette(id: PaletteId): void;
}

export type EmoteKind = 'heart' | 'sparkle' | 'z' | 'question' | 'snack' | 'bubble';

/** A thing shown beside Doozer for the length of a scene. */
export interface StageProp {
  /** Food only: how many bites are gone, 0..3. */
  bite(step: number): void;
  remove(): void;
}

/** What a stage can show around Doozer. The Card's stage implements this with DOM. */
export interface StageFx {
  emote(kind: EmoteKind, options?: { count?: number; icon?: FoodId | UnlockId }): void;
  prop(kind: 'food', item: FoodId): StageProp;
  prop(kind: 'toy', item: ToyId): StageProp;
  /** Treats just earned are on their way to the jar. Optional flourish. */
  treatsEarned?(count: number): void;
}

/** The lasting face for a state (DESIGN_SPEC.md 3.4 and 4.5). */
export function expressionFor(state: PetState, limits: Limits): ExpressionName {
  if (state.asleep) return 'asleep';
  // During a session Doozer wears its focus face; only an urgent need changes it.
  if (state.quiet && state.lowest.value >= limits.urgent) return 'focus';
  return state.mood;
}

/**
 * Keep an actor's lasting look in step with the brain. Each setter is only called when
 * its value actually changes, so a quiet brain costs nothing.
 */
export function syncDoozer(brain: Brain, actor: PetActor): Disposer {
  let face: ExpressionName | null = null;
  let glasses: boolean | null = null;
  let hat: HatId | null | undefined;
  let dirt: boolean | null = null;
  let palette: PaletteId | null = null;

  const apply = () => {
    const s = brain.state;
    const nextFace = expressionFor(s, brain.limits);
    if (nextFace !== face) { face = nextFace; actor.setMood(nextFace); }
    const nextGlasses = s.focus.status !== 'idle';
    if (nextGlasses !== glasses) { glasses = nextGlasses; actor.setGlasses(nextGlasses); }
    if (s.wearing !== hat) { hat = s.wearing; actor.setHat(s.wearing); }
    const nextDirt = s.needs.clean < brain.limits.low;
    if (nextDirt !== dirt) { dirt = nextDirt; actor.setDirt(nextDirt); }
    const nextPalette = brain.settings.palette;
    if (nextPalette !== palette) { palette = nextPalette; actor.setPalette(nextPalette); }
  };

  apply();
  const offChange = brain.on('change', apply);
  const offSettings = brain.on('settings', apply);
  return () => { offChange(); offSettings(); };
}

/**
 * Anything that is open around Doozer (the Radial) must get out of the way when Doozer
 * starts doing something: eating, falling asleep, waking, starting or finishing a session.
 * Calls `target.interrupt()` on each of those. Returns the function that stops listening.
 */
export function interruptOnActivity(brain: Brain, target: { interrupt(): void }): Disposer {
  const offAction = brain.on('action', () => target.interrupt());
  const offFocus = brain.on('focus', (event) => {
    if (event.type === 'start' || event.type === 'complete') target.interrupt();
  });
  return () => { offAction(); offFocus(); };
}

export interface StageDirectorOptions {
  timers?: Timers;
  /** How often a "z" drifts up while Doozer sleeps. */
  snoreMs?: number;
}

const BITE_MS = 420;
const BOUNCE_MS = 520;
const REFUSE_GAP_MS = 700;

/**
 * Plays a small scene for each thing the brain says happened. One scene at a time: a new
 * one, a refusal, falling asleep, or `setActive(false)` ends the current one completely.
 */
export class StageDirector {
  private readonly scope = new Scope();
  private readonly scenes: SceneRunner;
  private readonly timers: Timers;
  private readonly snoreMs: number;
  private snoreTimer: unknown = null;
  private refuseCooling: unknown = null;
  private active = true;

  constructor(
    private readonly brain: Brain,
    private readonly actor: PetActor,
    private readonly fx: StageFx,
    options: StageDirectorOptions = {},
  ) {
    this.timers = options.timers ?? realTimers;
    this.snoreMs = options.snoreMs ?? 2600;
    this.scenes = new SceneRunner({
      timers: this.timers,
      // A scene that did not reach its own ending leaves no borrowed face or gaze behind.
      onEnd: (_name, outcome) => {
        if (outcome !== 'finished') this.actor.stop();
        this.actor.lookAt(0, 0);
      },
    });

    this.scope.add(syncDoozer(brain, actor));
    this.scope.add(brain.on('action', (event) => { if (this.active) this.onAction(event); }));
    this.scope.add(brain.on('refuse', () => { if (this.active) this.onRefuse(); }));
    this.scope.add(brain.on('focus', (event) => { if (this.active) this.onFocus(event); }));
    this.scope.add(brain.on('change', () => this.syncSnore()));
    this.scope.add(() => this.scenes.destroy());
    this.scope.add(() => this.stopSnore());
    this.scope.add(() => {
      if (this.refuseCooling !== null) this.timers.clear(this.refuseCooling);
      this.refuseCooling = null;
    });
    this.syncSnore();
  }

  /** The name of the scene playing now, or null. */
  get scene(): string | null { return this.scenes.active; }

  /** A hidden stage (a closed Card) plays nothing and drops what it was playing. */
  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    if (!on) {
      this.scenes.cancel();
      this.actor.stop();
    }
    this.syncSnore();
  }

  /** End the current scene now. Views call this when Doozer is picked up or moved. */
  interrupt(): void {
    this.scenes.cancel();
  }

  destroy(): void {
    this.scope.dispose();
  }

  // ---- reactions -----------------------------------------------------------------

  private get quiet(): boolean { return this.brain.state.quiet; }

  /** Emotes are Doozer talking, so a focus session silences them - except the refusal "?". */
  private emote(kind: EmoteKind, options?: { count?: number; icon?: FoodId | UnlockId }): void {
    if (!this.active) return;
    if (this.quiet && kind !== 'question' && kind !== 'bubble') return;
    this.fx.emote(kind, options);
  }

  private onAction(event: BrainEvents['action']): void {
    switch (event.type) {
      case 'feed': this.eat(event.food, 2, false); break;
      case 'auto-eat': this.eat(event.food, 1, false); break;
      case 'treat': this.eat(event.food, 3, event.favourite); break;
      case 'play': this.play(event.toy); break;
      case 'wash': this.wash(event.duck); break;
      case 'pet': this.pet(); break;
      case 'fill-bowl':
        if (!this.scenes.active && !this.quiet) this.actor.flash('wow', 650);
        break;
      case 'sleep':
        this.scenes.cancel();
        void this.actor.perform('fall-asleep');
        break;
      case 'wake':
        this.scenes.cancel();
        void this.actor.perform('wake');
        break;
    }
    this.syncSnore();
  }

  private onRefuse(): void {
    // Hammering a refused button gets one emote per head-shake, not a cloud of them.
    const first = this.refuseCooling === null;
    if (first) this.refuseCooling = this.timers.set(() => { this.refuseCooling = null; }, REFUSE_GAP_MS);
    if (this.brain.state.asleep) {
      // Asleep: it does not wake to say no. A small stir and a "z".
      if (first) { void this.actor.perform('stir'); this.emote('z'); }
      return;
    }
    this.scenes.cancel();
    this.actor.flash('no', 900);
    if (first) this.emote('question');
  }

  private onFocus(event: BrainEvents['focus']): void {
    if (event.type === 'start') {
      this.scenes.cancel();
      void this.actor.perform('nod');
    } else if (event.type === 'complete') {
      const { treats, unlocked } = event;
      void this.scenes.play('focus-complete', async (scene) => {
        this.emote('sparkle', { count: 6 });
        this.fx.treatsEarned?.(treats);
        await scene.until(this.actor.perform('celebrate'));
        for (const id of unlocked) {
          this.emote('snack', { icon: id });
          this.emote('sparkle', { count: 2 });
          await scene.wait(520);
        }
        this.actor.flash('love', 900);
      });
    }
    // pause, resume and stop: no comment from Doozer. No scolding.
  }

  private eat(food: FoodId, hearts: number, favourite: boolean): void {
    void this.scenes.play('eat', async (scene) => {
      const prop = this.fx.prop('food', food);
      scene.cleanup(() => prop.remove());
      this.actor.lookAt(0.8, 0.45);
      await scene.wait(300);
      this.actor.flash('eat', BITE_MS * 3 + 150);
      for (let bite = 1; bite <= 3; bite++) {
        prop.bite(bite);
        await scene.wait(BITE_MS);
      }
      prop.remove();
      this.actor.lookAt(0, 0);
      if (this.quiet) return;
      if (favourite) {
        this.emote('sparkle', { count: 4 });
        this.emote('heart', { count: 4 });
        await scene.until(this.actor.perform('celebrate'));
      } else {
        this.emote('heart', { count: hearts });
        this.actor.flash('love', 900);
        await scene.wait(900);
      }
    });
  }

  private play(toy: ToyId): void {
    void this.scenes.play('play', async (scene) => {
      const prop = this.fx.prop('toy', toy);
      scene.cleanup(() => prop.remove());
      this.actor.setPose('play', 'cheer');
      scene.cleanup(() => this.actor.setPose(null));
      this.actor.lookAt(0, -0.9);
      await scene.wait(BOUNCE_MS * 4);
      prop.remove();
      this.actor.setPose(null);
      this.actor.lookAt(0, 0);
      if (this.quiet) return;
      this.emote('heart', { count: 3 });
      this.actor.flash('love', 800);
      await scene.wait(800);
    });
  }

  private wash(duck: boolean): void {
    void this.scenes.play('wash', async (scene) => {
      const prop = duck ? this.fx.prop('toy', 'duck') : null;
      if (prop) scene.cleanup(() => prop.remove());
      this.actor.flash('shake', 1500);
      for (let i = 0; i < 3; i++) {
        this.emote('bubble', { count: 5 });
        await scene.wait(470);
      }
      prop?.remove();
      this.emote('sparkle', { count: 5 });
      await scene.until(this.actor.perform('shake-off'));
      if (this.quiet) return;
      this.actor.flash('cheer', 800);
      await scene.wait(800);
    });
  }

  private pet(): void {
    this.actor.squish(0.7);
    this.emote('heart');
    // Mid-scene the face belongs to the scene; otherwise a happy flash.
    if (!this.scenes.active) this.actor.flash('love', 1000);
  }

  // ---- snoring -------------------------------------------------------------------
  // The timer exists only while its cause does: asleep, active, not in a focus session.

  private syncSnore(): void {
    const want = this.active && !this.scope.disposed && this.brain.state.asleep && !this.brain.state.quiet;
    if (want && this.snoreTimer === null) this.armSnore();
    else if (!want) this.stopSnore();
  }

  private armSnore(): void {
    this.snoreTimer = this.timers.set(() => {
      this.snoreTimer = null;
      if (!this.active || this.scope.disposed || !this.brain.state.asleep || this.brain.state.quiet) return;
      this.fx.emote('z');
      this.armSnore();
    }, this.snoreMs);
  }

  private stopSnore(): void {
    if (this.snoreTimer !== null) this.timers.clear(this.snoreTimer);
    this.snoreTimer = null;
  }
}

export type { SceneContext };
