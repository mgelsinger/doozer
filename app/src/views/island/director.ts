// The Island's little scenes: what Doozer does on the island when the brain says something
// happened. A snack drops out of the sky and Doozer hops over to eat it; the ball is
// tossed and chased; a rain cloud gives it a bath; night falls when it sleeps.
//
// The view draws and forwards; this file choreographs; neither decides a rule. Every
// scene starts from a brain event and only shows what the brain already did.
//
// Never stuck, by the kit's own means (src/ui/lifecycle.ts):
//   - One scene at a time, run by a SceneRunner: a new scene, a refusal, falling asleep,
//     `interrupt()` or a time limit ends the old one, and its clean-ups always run: the
//     snack is taken away, the chase is called off, the rain stops, Doozer faces front.
//   - A scene only waits through its context, so an ended scene is never resumed.
//   - Doozer's trip across the island is waited for with a time limit; when it runs out
//     Doozer is simply put where it was going.
//   - A game of ball ends after five kicks or `PLAY_LIMIT_MS`, whichever comes first.
// No DOM and no three.js in this file.

import type { Brain, BrainEvents, FoodId, UnlockId } from '../../core/contract';
import type { BodyMotion } from '../../character/body-motion';
import { realTimers, type Timers } from '../../character/timers';
import { SceneRunner, Scope, type SceneContext } from '../../ui/lifecycle';
import { syncDoozer, type EmoteKind, type PetActor } from '../../ui/presenter';
import { HOME, ISLAND } from './layout';
import type { PlayToy, World } from './world';

/** What the director needs of the 3D Doozer. `Doozer3D` satisfies it. */
export interface IslandActor extends PetActor {
  readonly body: BodyMotion;
  readonly busy: boolean;
  blink(): void;
}

export interface IslandFx {
  emote(kind: EmoteKind, options?: { count?: number; icon?: FoodId | UnlockId }): void;
}

export interface IslandDirectorOptions {
  timers?: Timers;
  random?: () => number;
  /** How often a "z" drifts up while Doozer sleeps and someone is there. */
  snoreMs?: number;
}

const BITE_MS = 560;
/** Longest Doozer is given to hop anywhere on the island. Across the whole of it takes about 2.5 s. */
export const TRAVEL_LIMIT_MS = 3600;
/** A game of ball ends after this long even if Doozer never reached the ball. */
export const PLAY_LIMIT_MS = 9000;
const REFUSE_GAP_MS = 700;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class IslandDirector {
  private readonly scope = new Scope();
  private readonly scenes: SceneRunner;
  private readonly timers: Timers;
  private readonly random: () => number;
  private readonly snoreMs: number;
  private snoreTimer: unknown = null;
  private refuseCooling: unknown = null;
  private lively = false;
  private active = true;

  constructor(
    private readonly brain: Brain,
    private readonly actor: IslandActor,
    private readonly world: World,
    private readonly fx: IslandFx,
    options: IslandDirectorOptions = {},
  ) {
    this.timers = options.timers ?? realTimers;
    this.random = options.random ?? Math.random;
    this.snoreMs = options.snoreMs ?? 2600;
    this.scenes = new SceneRunner({
      timers: this.timers,
      // A scene that did not reach its own ending leaves no borrowed face behind.
      onEnd: (_name, outcome) => { if (outcome !== 'finished') this.actor.stop(); },
    });

    this.scope.add(syncDoozer(brain, actor));
    this.scope.add(brain.on('action', (event) => { if (this.active) this.onAction(event); }));
    this.scope.add(brain.on('refuse', () => { if (this.active) this.onRefuse(); }));
    this.scope.add(brain.on('focus', (event) => { if (this.active) this.onFocus(event); }));
    this.scope.add(brain.on('away', () => { if (this.active) this.onAway(); }));
    this.scope.add(brain.on('change', () => this.follow()));
    this.scope.add(() => this.scenes.destroy());
    this.scope.add(() => this.stopSnore());
    this.scope.add(() => {
      if (this.refuseCooling !== null) this.timers.clear(this.refuseCooling);
      this.refuseCooling = null;
    });
    this.follow();
  }

  /** The name of the scene playing now, or null. */
  get scene(): string | null { return this.scenes.active; }

  /** Someone is there to watch (true) or not: only then do the z's of a sleeping Doozer rise. */
  setLively(on: boolean): void {
    this.lively = on;
    this.syncSnore();
  }

  /** End the current scene now, cleaning up after it. The view calls this when Doozer is touched or the view goes away. */
  interrupt(): void {
    this.scenes.cancel();
  }

  /**
   * False while the view is tucked away: whatever was playing is over and tidied away,
   * and nothing new is played (no scene, no face, no timer) until it is true again.
   * Doozer's lasting look still follows the brain, so it is right on coming back.
   */
  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    if (!on) {
      this.scenes.cancel();
      this.actor.stop();
      this.world.stopTravel();
      this.actor.body.setFacing(null);
      if (this.refuseCooling !== null) this.timers.clear(this.refuseCooling);
      this.refuseCooling = null;
    }
    this.syncSnore();
  }

  destroy(): void {
    this.scope.dispose();
  }

  // ---- things Doozer does by itself, when the view says it may ------------------------------

  /** True when Doozer is free to do something of its own accord. */
  get idle(): boolean {
    const s = this.brain.state;
    return this.active && !s.asleep && !s.quiet && this.scenes.active === null && !this.actor.busy && this.actor.body.grounded && !this.actor.body.isPressed && !this.world.travelling;
  }

  /** While someone is watching: wander to another spot, or have a little moment where it stands. */
  wander(): void {
    if (!this.idle) return;
    const mood = this.brain.state.mood;
    if (this.random() < 0.6) {
      const a = this.random() * Math.PI * 2;
      const r = this.random() * ISLAND.roam;
      const x = Math.cos(a) * r;
      const z = clamp(Math.sin(a) * r * 0.7 + 0.25, -0.35, 0.8);
      void this.scenes.play('wander', (scene) => this.travel(scene, x, z), TRAVEL_LIMIT_MS + 500);
    } else if (mood === 'joyful') {
      this.actor.body.hop(3);
    } else if (mood === 'sleepy') {
      void this.actor.perform('yawn');
    } else {
      this.actor.blink();
    }
  }

  /** With nobody watching: one small sign of life. */
  stir(): void {
    if (!this.idle) return;
    if (this.brain.state.mood === 'joyful' && this.random() < 0.5) this.actor.body.hop(2.6);
    else this.actor.squish(-0.22);
    this.actor.blink();
  }

  // ---- reactions -----------------------------------------------------------------------

  private get quiet(): boolean { return this.brain.state.quiet; }

  /** Emotes are Doozer talking, so a focus session silences them, except the "?" of a refusal and the bath's bubbles. */
  private emote(kind: EmoteKind, options?: { count?: number; icon?: FoodId | UnlockId }): void {
    if (this.quiet && kind !== 'question' && kind !== 'bubble') return;
    this.fx.emote(kind, options);
  }

  /** What follows the brain's state rather than an event: night, and the snoring. */
  private follow(): void {
    this.world.setNight(this.brain.state.asleep);
    this.syncSnore();
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
        this.world.stopTravel();
        this.actor.body.setFacing(null);
        this.actor.lookAt(0, 0);
        void this.actor.perform('fall-asleep');
        break;
      case 'wake':
        this.scenes.cancel();
        void this.actor.perform('wake');
        break;
    }
    this.follow();
  }

  private onRefuse(): void {
    // Hammering a refused button gets one emote per head-shake, not a cloud of them.
    const first = this.refuseCooling === null;
    if (first) this.refuseCooling = this.timers.set(() => { this.refuseCooling = null; }, REFUSE_GAP_MS);
    if (this.brain.state.asleep) {
      // Asleep: it does not wake to say no. A small stir and a "z".
      if (first) { void this.actor.perform('stir'); this.fx.emote('z'); }
      return;
    }
    this.scenes.cancel();
    this.actor.flash('no', 900);
    if (first) this.emote('question');
  }

  private onFocus(event: BrainEvents['focus']): void {
    if (event.type === 'start') {
      // Glasses on, a nod, and back to the middle of the island to settle (spec 4.5).
      void this.scenes.play('settle', async (scene) => {
        void this.actor.perform('nod');
        await scene.wait(460);
        await this.travel(scene, HOME.x, HOME.z);
      }, TRAVEL_LIMIT_MS + 1500);
    } else if (event.type === 'complete') {
      const { treats, unlocked } = event;
      void this.scenes.play('focus-complete', async (scene) => {
        this.fx.emote('sparkle', { count: 6 });
        this.fx.emote('snack', { count: Math.min(3, Math.max(1, treats)), icon: 'biscuit' });
        await scene.until(this.actor.perform('celebrate'));
        for (const id of unlocked) {
          this.fx.emote('snack', { icon: id });
          this.fx.emote('sparkle', { count: 2 });
          await scene.wait(520);
        }
        this.actor.flash('love', 900);
        await scene.wait(900);
      });
    }
    // pause, resume and stop: no comment from Doozer. No scolding.
  }

  private onAway(): void {
    // Back after a while: a small hello, unless asleep or focusing.
    if (this.brain.state.asleep || this.quiet || this.scenes.active) return;
    void this.actor.perform('wave');
  }

  /** Hop to a spot, and be there when the time limit runs out whether or not the hops got there. */
  private async travel(scene: SceneContext, x: number, z: number): Promise<void> {
    let arrived = false;
    scene.cleanup(() => { if (!arrived) this.world.stopTravel(); this.actor.body.setFacing(null); });
    const trip = this.world.travelTo(x, z).then(() => { arrived = true; });
    const limit = scene.wait(TRAVEL_LIMIT_MS).then(() => { if (!arrived) this.world.arriveNow(); });
    await scene.until(Promise.race([trip, limit]));
    this.actor.body.setFacing(null);
  }

  private eat(food: FoodId, hearts: number, favourite: boolean): void {
    void this.scenes.play('eat', async (scene) => {
      const { actor, world } = this;
      // During a focus session Doozer stays where it is and eats quietly.
      const quiet = this.quiet;
      const at = world.doozer;
      // The snack lands beside Doozer, on the side with more island.
      const side = at.x > 0.25 ? -1 : at.x < -0.25 ? 1 : this.random() < 0.5 ? -1 : 1;
      const x = clamp(at.x + side * (quiet ? 0.86 : 1.0), -ISLAND.reach, ISLAND.reach);
      const z = clamp(at.z + 0.2, 0.15, 0.85);
      world.dropSnack(food, x, z);
      scene.cleanup(() => { world.removeSnack(); actor.body.setFacing(null); actor.lookAt(0, 0); });
      actor.lookAt(side * 0.8, 0.9);
      if (!quiet) actor.flash('wow', 760);
      await scene.wait(820);
      if (!quiet) await this.travel(scene, x - side * 0.84, z - 0.05);
      actor.body.setFacing(side * 0.95);
      actor.lookAt(side * 0.5, -0.4);
      actor.flash('eat', BITE_MS * 3 + 150);
      for (let bite = 1; bite <= 3; bite++) {
        await scene.wait(260);
        world.biteSnack();
        actor.squish(0.48);
        await scene.wait(BITE_MS - 260);
      }
      world.removeSnack();
      actor.body.setFacing(null);
      actor.lookAt(0, 0);
      if (quiet) return;
      if (favourite) {
        this.emote('sparkle', { count: 4 });
        this.emote('heart', { count: 4 });
        await scene.until(actor.perform('celebrate'));
      } else {
        this.emote('heart', { count: hearts });
        // The cheering face hops on the spot for as long as it shows.
        actor.flash('cheer', 1250);
        await scene.wait(1250);
      }
    }, 10_000);
  }

  private play(toy: PlayToy): void {
    void this.scenes.play('play', async (scene) => {
      const { actor, world } = this;
      world.kicks = 0;
      world.serveBall(toy);
      actor.setPose('idle', 'cheer');
      world.chase(true);
      scene.cleanup(() => { world.chase(false); actor.setPose(null); actor.body.setFacing(null); });
      for (let waited = 0; world.kicks < 5 && waited < PLAY_LIMIT_MS; waited += 150) {
        const before = world.kicks;
        await scene.wait(150);
        if (world.kicks > before && world.kicks % 2 === 0) this.emote('heart');
      }
      world.chase(false);
      actor.setPose(null);
      actor.body.setFacing(null);
      if (this.quiet) return;
      this.emote('heart', { count: 3 });
      actor.flash('cheer', 1300);
      await scene.wait(1300);
    }, PLAY_LIMIT_MS + 3000);
  }

  private wash(duck: boolean): void {
    void this.scenes.play('wash', async (scene) => {
      const { actor, world } = this;
      world.stopTravel();
      actor.body.setFacing(null);
      // A small rain cloud arrives overhead, and the duck if there is one.
      world.setRain(true);
      if (duck) world.setDuck(true);
      scene.cleanup(() => { world.setRain(false); world.setDuck(false); });
      actor.flash('shake', 2000);
      for (let i = 0; i < 4; i++) {
        this.fx.emote('bubble', { count: 5 });
        await scene.wait(470);
      }
      world.setRain(false);
      this.emote('sparkle', { count: 5 });
      await scene.until(actor.perform('shake-off'));
      world.setDuck(false);
      if (this.quiet) return;
      actor.flash('cheer', 800);
      await scene.wait(800);
    });
  }

  private pet(): void {
    this.actor.squish(0.7);
    this.emote('heart');
    // Mid-scene the face belongs to the scene; otherwise a happy flash.
    if (!this.scenes.active) this.actor.flash('love', 1000);
  }

  // ---- snoring -------------------------------------------------------------------------
  // The timer exists only while its cause does: asleep, watched, not in a focus session.

  private syncSnore(): void {
    const want = this.active && this.lively && !this.scope.disposed && this.brain.state.asleep && !this.brain.state.quiet;
    if (want && this.snoreTimer === null) this.armSnore();
    else if (!want) this.stopSnore();
  }

  private armSnore(): void {
    this.snoreTimer = this.timers.set(() => {
      this.snoreTimer = null;
      if (!this.active || !this.lively || this.scope.disposed || !this.brain.state.asleep || this.brain.state.quiet) return;
      this.fx.emote('z');
      this.armSnore();
    }, this.snoreMs);
  }

  private stopSnore(): void {
    if (this.snoreTimer !== null) this.timers.clear(this.snoreTimer);
    this.snoreTimer = null;
  }
}
