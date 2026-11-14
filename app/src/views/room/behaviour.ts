// What Doozer does in the room: where it belongs, how it gets there, the little scenes
// it plays when something happens, and what it gets up to when left alone.
//
// No rule about the pet is decided here (WORK_PLAN.md, principle 5). The brain says
// "Doozer ate from the bowl", "Doozer fell asleep", "a session started"; this file only
// decides how that looks: walk to the bowl, go to bed, fetch the book.
//
// Never stuck, by construction:
//
//   - Where Doozer BELONGS is a function of the brain's state and nothing else
//     (`desired`): in bed while asleep, on the rug with its book while a session is on,
//     otherwise free on the floor. Where it IS (`station`) is one variable. Whenever
//     nothing is playing and the two differ, `reconcile` starts the walk that fixes it.
//     It runs after every scene, on every change of the brain and once a minute, so a
//     missed event or an interrupted scene is put right the next time anything happens.
//   - One scene at a time (`SceneRunner`): a new one ends the old one completely, and
//     every scene has a time limit. A scene that runs out of time is not retried:
//     Doozer is simply put where it belongs (`snap`).
//   - A walk is a start, an end and a duration (`Walker`), so an interrupted walk leaves
//     Doozer standing exactly where it had got to, with nothing still running.
//   - What Doozer does on its own is one timer (`act`), armed only while it is free.
//
// No DOM in this file: everything drawn goes through `RoomFx`.

import type { Brain, BrainEvents, FoodId, ToyId, UnlockId } from '../../core/contract';
import { walkCycleMs, type Doozer } from '../../character/doozer';
import type { ExpressionName } from '../../character/expressions';
import type { Timers } from '../../character/timers';
import { SceneRunner, Scope, type SceneContext, type SceneOutcome } from '../../ui/lifecycle';
import type { EmoteKind } from '../../ui/presenter';
import { PET, REACH, SPOT, WALK } from './layout';
import type { Walker } from './walker';

/** Where Doozer is settled. */
export type Station = 'free' | 'bed' | 'reading';
export type Place = 'floor' | 'bed';
export type Gait = 'walk' | 'trot';

export interface SnackProp {
  /** How many bites are gone, 0..3. */
  bite(step: number): void;
  remove(): void;
}

/** Everything the behaviour can make appear. The view implements it with elements. */
export interface RoomFx {
  /** Standing on the floor, or tucked into the bed. */
  place(place: Place): void;
  emote(kind: EmoteKind, options?: { count?: number; icon?: FoodId | UnlockId }): void;
  /** A snack in front of Doozer: handed to it, or dropped from the jar on the shelf. */
  snack(item: FoodId, from: 'hand' | 'jar', doozerX: number): SnackProp;
  duck(doozerX: number): { remove(): void };
  /** A few crumbs fly from the bowl. */
  crumbs(): void;
  /** Hold the bowl at this many servings (Doozer has not eaten the next one yet); null follows the brain. */
  bowlHold(level: number | null): void;
  /** The top book of the pile is with Doozer, or back on the pile. */
  book(held: boolean): void;
  /** Which toy is out. */
  toy(toy: Exclude<ToyId, 'duck'>): void;
  /** Where the ball is lying, or where it will land. */
  ballX(): number;
  /** Send the ball to `x`. Returns how long it is in the air, in milliseconds. */
  tossBall(x: number, kind: 'toss' | 'kick' | 'hop'): number;
  /** Treats just earned are on their way to the jar. */
  treatsEarned(count: number): void;
  /** Be lively for this long although no scene is playing (a pet, a page turned). */
  stir(ms: number): void;
  /** A scene started or ended, or Doozer settled somewhere. */
  changed(): void;
}

export interface BehaviourOptions {
  brain: Brain;
  doozer: Doozer;
  walker: Walker;
  fx: RoomFx;
  timers: Timers;
  random: () => number;
}

export interface Behaviour {
  readonly station: Station;
  /** Where the brain's state says Doozer belongs. */
  readonly desired: Station;
  /** The scene playing now, or null. */
  readonly scene: string | null;
  /** The behaviour's own timers that are armed. */
  timers(): string[];
  /** Tucked away (false): everything stops. Back (true): Doozer is put where it belongs. */
  setAwake(awake: boolean): void;
  /** Somebody is there (the pointer is in the room): Doozer does things sooner. */
  setAttended(attended: boolean): void;
  setReduceMotion(on: boolean): void;
  /** Stop and play nothing (Doozer has popped out for a window change), or carry on. */
  hold(on: boolean): void;
  /** Look whether Doozer is where it belongs, and send it there if not. */
  check(): void;
  /** Put Doozer where it belongs now, without walking. */
  snap(): void;
  /** The party for a finished session that could not be thrown at the time. */
  celebrate(treats: number, unlocked: readonly UnlockId[]): void;
  /** A new Doozer says hello. `done` is called only if the whole hello was shown. */
  welcome(done: () => void): void;
  destroy(): void;
}

// How long before Doozer does something by itself. Left alone it mostly rests: each
// little outing costs a few seconds of animation, and the room has to stay cheap to
// leave open all day (docs/room-checks.md). With somebody watching it is livelier.
export const ALONE_MS: readonly [number, number] = [80_000, 200_000];
export const ATTENDED_MS: readonly [number, number] = [5_000, 11_000];
/** While reading: how often it stirs to turn a page, and for how long. */
export const PAGE_MS: readonly [number, number] = [60_000, 120_000];
const PAGE_TURN_MS = 2600;

/** Pixels a second. */
const SPEED = { stroll: 38, walk: 55, bed: 50, run: 96, chase: 108 } as const;
const BITE_MS = 420;
const REFUSE_GAP_MS = 700;
/** No scene may run longer than this. The longest honest one (a game of ball) is about 8 s. */
export const SCENE_LIMIT_MS = 16_000;

export function createBehaviour(options: BehaviourOptions): Behaviour {
  const { brain, doozer, walker, fx, timers, random } = options;
  const scope = new Scope();

  let station: Station = 'free';
  let awake = true;
  let held = false;
  let attended = false;
  let reduce = false;
  /** The station whose resting pose has been put on. Null whenever a scene has touched Doozer. */
  let rested: Station | null = null;
  /** Above zero while a scene is being swapped for another: the old one's ending must not start a third. */
  let swapping = 0;
  let refuseCooling = false;

  const armed = new Map<string, unknown>();
  const disarm = (name: string): void => {
    if (armed.has(name)) timers.clear(armed.get(name));
    armed.delete(name);
  };
  const arm = (name: string, ms: number, fn: () => void): void => {
    disarm(name);
    if (scope.disposed) return;
    armed.set(name, timers.set(() => { armed.delete(name); fn(); }, ms));
  };
  scope.add(() => { for (const name of [...armed.keys()]) disarm(name); });

  const between = (lo: number, hi: number): number => lo + random() * (hi - lo);
  const quiet = (): boolean => brain.state.quiet;
  const canPlay = (): boolean => awake && !held && !scope.disposed;

  /** Emotes are Doozer talking, so a session silences them, except a refusal's "?" and the bath's bubbles. */
  const emote = (kind: EmoteKind, emoteOptions?: { count?: number; icon?: FoodId | UnlockId }): void => {
    if (quiet() && kind !== 'question' && kind !== 'bubble') return;
    fx.emote(kind, emoteOptions);
  };

  function desired(): Station {
    const s = brain.state;
    if (s.asleep) return 'bed';
    return s.focus.status === 'idle' ? 'free' : 'reading';
  }

  // ---- scenes ----------------------------------------------------------------------

  const scenes = new SceneRunner({
    timers,
    maxMs: SCENE_LIMIT_MS,
    onEnd: (_name, outcome) => afterScene(outcome),
  });
  scope.add(() => { swapping++; scenes.destroy(); });

  function afterScene(outcome: SceneOutcome): void {
    rested = null;
    if (swapping > 0 || scope.disposed) return;
    fx.changed();
    // A scene that ran out of time or broke is not tried again: put Doozer where it belongs.
    if (outcome === 'timed-out' || outcome === 'failed') snap();
    else reconcile();
  }

  /** Play a scene. Whatever was playing ends first, completely. */
  function play(name: string, script: (scene: SceneContext) => Promise<void> | void, limit = SCENE_LIMIT_MS): void {
    if (!canPlay()) return;
    disarm('act');
    swapping++;
    try {
      void scenes.play(name, (scene) => {
        rested = null;
        // However the scene ends, Doozer stands still where it has got to and looks ahead.
        scene.cleanup(() => {
          walker.stop();
          doozer.setPose(null);
          doozer.setFacing(0);
          doozer.setWalkCycle(null);
          doozer.lookAt(0, 0);
        });
        return script(scene);
      }, limit);
    } finally {
      swapping--;
    }
    fx.changed();
  }

  /** End the scene that is playing without letting its ending start another. */
  function cancelQuietly(): void {
    swapping++;
    try { scenes.cancel(); } finally { swapping--; }
  }

  /** Walk to `x`. Resolves on arrival; never resumes a scene that has ended. */
  async function walk(scene: SceneContext, x: number, speed: number, gait: Gait = 'walk', face: ExpressionName | null = null, atLeastMs = 0): Promise<void> {
    const from = walker.x;
    const to = Math.min(REACH.max, Math.max(REACH.min, x));
    if (reduce || Math.abs(to - from) < 2) {
      walker.place(to);
      if (atLeastMs > 0) await scene.wait(atLeastMs);
      return;
    }
    doozer.setFacing(to > from ? 1 : -1);
    doozer.setWalkCycle(walkCycleMs(PET.size, speed, gait));
    doozer.setPose(gait, face);
    const ms = walker.walkTo(to, speed);
    await scene.wait(Math.max(ms, atLeastMs));
    walker.place(to);
    doozer.setPose(null);
    doozer.setFacing(0);
  }

  /** On its feet on the floor, whatever it was doing: out of bed, book put down. */
  function afoot(): void {
    if (station === 'bed') {
      fx.place('floor');
      walker.place(SPOT.bed.x);
    }
    if (station === 'reading') fx.book(false);
    station = 'free';
  }

  // ---- where Doozer belongs --------------------------------------------------------

  function reconcile(): void {
    if (!canPlay() || scenes.active !== null) return;
    const want = desired();
    if (station !== want) {
      if (station === 'bed') { getUp(); return; }
      if (station === 'reading') afoot();
      if (want === 'bed') { goToBed(); return; }
      if (want === 'reading') { fetchBook(); return; }
    }
    rest();
  }

  /** Put the resting pose of the current station on (once), and wait for the next thing to do. */
  function rest(): void {
    if (rested !== station) {
      rested = station;
      walker.stop();
      doozer.setFacing(0);
      doozer.setWalkCycle(null);
      doozer.lookAt(0, 0);
      if (station === 'bed') {
        fx.place('bed');
        walker.place(SPOT.bed.x);
        doozer.setPose(null);
        fx.book(false);
      } else if (station === 'reading') {
        fx.place('floor');
        walker.place(SPOT.rug);
        doozer.setPose('read');
        fx.book(true);
      } else {
        fx.place('floor');
        doozer.setPose(null);
        fx.book(false);
      }
      fx.bowlHold(null);
      fx.changed();
    }
    armAct();
  }

  function snap(): void {
    cancelQuietly();
    disarm('act');
    const want = desired();
    // Out of the bed, it stands somewhere it could have walked to.
    if (want === 'free' && (station !== 'free' || walker.x < WALK.min || walker.x > WALK.max)) walker.place(SPOT.start);
    station = want;
    rested = null;
    if (canPlay()) rest();
  }

  function goToBed(): void {
    play('to-bed', async (scene) => {
      await walk(scene, SPOT.bed.x, SPEED.bed, 'walk', 'sleepy');
      fx.place('bed');
      station = 'bed';
      doozer.squish(0.8);
    });
  }

  function getUp(): void {
    play('get-up', async (scene) => {
      await scene.until(doozer.perform('wake'));
      afoot();
      doozer.squish(0.7);
      await walk(scene, WALK.min + 14, SPEED.stroll);
    });
  }

  function fetchBook(): void {
    play('fetch-book', async (scene) => {
      await walk(scene, SPOT.books, SPEED.walk);
      fx.book(true);
      doozer.squish(0.5);
      await scene.wait(reduce ? 0 : 320);
      await walk(scene, SPOT.rug, SPEED.walk);
      station = 'reading';
    });
  }

  // ---- what Doozer does on its own -------------------------------------------------

  function armAct(): void {
    if (armed.has('act') || !canPlay()) return;
    if (station === 'reading') {
      arm('act', between(PAGE_MS[0], PAGE_MS[1]), turnPage);
    } else if (station === 'free') {
      const [lo, hi] = attended ? ATTENDED_MS : ALONE_MS;
      arm('act', between(lo, hi), act);
    }
    // Asleep in bed: nothing, until the brain says it has woken.
  }

  function turnPage(): void {
    if (canPlay() && scenes.active === null && station === 'reading' && desired() === 'reading') fx.stir(PAGE_TURN_MS);
    reconcile();
  }

  function act(): void {
    if (!canPlay() || scenes.active !== null || station !== 'free' || desired() !== 'free') { reconcile(); return; }
    const sleepy = brain.state.mood === 'sleepy';
    const roll = random();
    if (roll < 0.2) lookOut();
    else if (roll < (sleepy ? 0.45 : 0.62)) wander();
    else if (roll < 0.74 && !sleepy) nudgeBall();
    else fidget(sleepy);
  }

  function wander(): void {
    play('wander', async (scene) => {
      const from = walker.x;
      let to = between(WALK.min, WALK.max);
      // A stroll worth taking: at least a few steps.
      if (Math.abs(to - from) < 40) to = from < (WALK.min + WALK.max) / 2 ? from + between(50, 110) : from - between(50, 110);
      await walk(scene, Math.min(WALK.max, Math.max(WALK.min, to)), SPEED.stroll);
    });
  }

  function lookOut(): void {
    play('look-out', async (scene) => {
      await walk(scene, SPOT.window, SPEED.stroll);
      doozer.lookAt(-0.15, -1);
      await scene.wait(between(2600, 4200));
      doozer.lookAt(0, 0);
      await scene.wait(500);
      // It does not stay standing in front of the bed.
      await walk(scene, WALK.min + between(0, 40), SPEED.stroll);
    });
  }

  function nudgeBall(): void {
    play('nudge-ball', async (scene) => {
      const ball = fx.ballX();
      const side = walker.x <= ball ? -1 : 1;
      await walk(scene, ball + side * 30, SPEED.walk);
      doozer.squish(0.8);
      doozer.flash('cheer', 480);
      const air = fx.tossBall(ball - side * between(60, 130), 'kick');
      doozer.lookAt(-side * 0.8, -0.3);
      await scene.wait(air + 200);
    });
  }

  function fidget(sleepy: boolean): void {
    play('fidget', async (scene) => {
      if (sleepy) {
        await scene.until(doozer.perform('yawn'));
      } else if (attended) {
        await scene.until(doozer.perform('wave'));
      } else {
        doozer.lookAt(-0.8, -0.1);
        await scene.wait(1000);
        doozer.lookAt(0.8, -0.1);
        await scene.wait(1000);
      }
    });
  }

  // ---- what happens when the brain says something happened --------------------------

  /** A snack in front of Doozer, eaten in three bites. */
  async function munch(scene: SceneContext, food: FoodId, from: 'hand' | 'jar'): Promise<void> {
    const prop = fx.snack(food, from, walker.x);
    scene.cleanup(() => prop.remove());
    doozer.lookAt(0.8, from === 'jar' ? -0.7 : 0.45);
    await scene.wait(from === 'jar' ? 460 : 300);
    doozer.lookAt(0.8, 0.45);
    doozer.flash('eat', BITE_MS * 3 + 150);
    for (let bite = 1; bite <= 3; bite++) {
      prop.bite(bite);
      await scene.wait(BITE_MS);
    }
    prop.remove();
    doozer.lookAt(0, 0);
  }

  function eatHere(food: FoodId): void {
    play('eat', async (scene) => {
      afoot();
      await munch(scene, food, 'hand');
      if (quiet()) return;
      emote('heart', { count: 2 });
      doozer.flash('love', 900);
      await scene.wait(900);
    });
  }

  function eatFromBowl(): void {
    // The serving is already eaten as far as the brain is concerned. Not free to walk
    // over (reading, in bed) or in a session: the bowl simply goes down.
    if (!canPlay() || station !== 'free' || quiet() || scenes.active === 'play' || scenes.active === 'treat') {
      fx.bowlHold(null);
      if (canPlay() && station !== 'bed' && scenes.active === null) doozer.flash('eat', 900);
      return;
    }
    play('eat-bowl', async (scene) => {
      // It stays in the bowl until Doozer has walked over.
      fx.bowlHold(Math.min(brain.limits.bowl, brain.state.bowl + 1));
      scene.cleanup(() => fx.bowlHold(null));
      await walk(scene, SPOT.bowl, SPEED.walk);
      doozer.lookAt(0.9, 0.7);
      doozer.flash('eat', BITE_MS * 3 + 150);
      for (let bite = 1; bite <= 3; bite++) {
        fx.crumbs();
        await scene.wait(BITE_MS);
      }
      fx.bowlHold(null);
      doozer.lookAt(0, 0);
      emote('heart');
      doozer.flash('love', 800);
      await scene.wait(800);
    });
  }

  function treat(food: FoodId, favourite: boolean): void {
    play('treat', async (scene) => {
      afoot();
      // It comes running (DESIGN_SPEC.md 6.2).
      await walk(scene, SPOT.jar, SPEED.run, 'trot');
      await munch(scene, food, 'jar');
      if (quiet()) return;
      if (favourite) {
        emote('sparkle', { count: 4 });
        emote('heart', { count: 4 });
        await scene.until(doozer.perform('celebrate'));
      } else {
        emote('heart', { count: 3 });
        doozer.flash('love', 900);
        await scene.wait(900);
      }
    });
  }

  function playBall(toy: Exclude<ToyId, 'duck'>): void {
    play('play', async (scene) => {
      afoot();
      fx.toy(toy);
      for (let kick = 0; kick < 3; kick++) {
        // Tossed, then kicked back and forth: always toward the roomier side.
        const ball = fx.ballX();
        const to = ball < (REACH.min + REACH.max) / 2 ? ball + between(90, 150) : ball - between(90, 150);
        const air = fx.tossBall(to, kick === 0 ? 'toss' : 'kick');
        const landing = fx.ballX();
        const side = walker.x <= landing ? -1 : 1;
        doozer.lookAt(-side * 0.85, -0.5);
        await walk(scene, landing + side * 30, SPEED.chase, 'trot', null, Math.max(0, air - 160));
        doozer.squish(1);
        doozer.flash('cheer', 420);
        await scene.wait(280);
      }
      fx.tossBall(fx.ballX() + (walker.x <= fx.ballX() ? 34 : -34), 'hop');
      if (quiet()) return;
      emote('heart', { count: 3 });
      doozer.flash('love', 800);
      await scene.wait(800);
    });
  }

  function wash(duck: boolean): void {
    play('wash', async (scene) => {
      // Scrubbed where it stands.
      afoot();
      const prop = duck ? fx.duck(walker.x) : null;
      if (prop) scene.cleanup(() => prop.remove());
      doozer.flash('shake', 1500);
      for (let i = 0; i < 3; i++) {
        emote('bubble', { count: 5 });
        await scene.wait(470);
      }
      prop?.remove();
      emote('sparkle', { count: 5 });
      await scene.until(doozer.perform('shake-off'));
      if (quiet()) return;
      doozer.flash('cheer', 800);
      await scene.wait(800);
    });
  }

  function celebrate(treats: number, unlocked: readonly UnlockId[]): void {
    play('celebrate', async (scene) => {
      afoot();
      emote('sparkle', { count: 6 });
      fx.treatsEarned(treats);
      await scene.until(doozer.perform('celebrate'));
      for (const id of unlocked) {
        emote('snack', { icon: id });
        emote('sparkle', { count: 2 });
        await scene.wait(520);
      }
      doozer.flash('love', 900);
      await scene.wait(900);
    });
  }

  function onAction(event: BrainEvents['action']): void {
    switch (event.type) {
      case 'feed': eatHere(event.food); break;
      case 'auto-eat': eatFromBowl(); break;
      case 'treat': treat(event.food, event.favourite); break;
      case 'play': playBall(event.toy); break;
      case 'wash': wash(event.duck); break;
      case 'pet':
        doozer.squish(0.7);
        emote('heart');
        if (scenes.active === null && !brain.state.asleep && canPlay()) doozer.flash('love', 1000);
        fx.stir(1600);
        break;
      case 'fill-bowl':
        fx.bowlHold(null);
        fx.crumbs();
        if (scenes.active === null && station === 'free' && !quiet() && canPlay()) doozer.flash('wow', 650);
        fx.stir(1200);
        break;
      case 'sleep':
      case 'wake':
        // Whatever it was doing, it stops, and goes where it now belongs.
        scenes.cancel();
        reconcile();
        break;
    }
  }

  function onRefuse(): void {
    // Hammering something Doozer says no to gets one "?" per head-shake, not a cloud of them.
    const first = !refuseCooling;
    if (first) {
      refuseCooling = true;
      arm('refuse', REFUSE_GAP_MS, () => { refuseCooling = false; });
    }
    fx.stir(1600);
    if (!canPlay()) return;
    if (brain.state.asleep) {
      // Asleep: it does not wake to say no. A small stir and a "z".
      if (first) { void doozer.perform('stir'); emote('z'); }
      return;
    }
    doozer.flash('no', 900);
    if (first) emote('question');
  }

  function onFocus(event: BrainEvents['focus']): void {
    if (event.type === 'start') {
      scenes.cancel();
      if (canPlay()) void doozer.perform('nod');
      reconcile();
    } else if (event.type === 'complete') {
      celebrate(event.treats, event.unlocked);
    } else {
      // Paused, resumed, stopped: no comment from Doozer. If it no longer belongs on the rug it gets up.
      reconcile();
    }
  }

  scope.add(brain.on('action', onAction));
  scope.add(brain.on('refuse', onRefuse));
  scope.add(brain.on('focus', onFocus));
  scope.add(brain.on('change', reconcile));
  scope.add(brain.on('away', () => {
    const s = brain.state;
    if (!canPlay() || scenes.active !== null || station !== 'free' || s.asleep || s.quiet) return;
    play('hello', async (scene) => { await scene.until(doozer.perform('wave')); });
  }));

  // Where it belongs to begin with, without a walk.
  walker.place(SPOT.start);
  snap();

  return {
    get station() { return station; },
    get desired() { return desired(); },
    get scene() { return scenes.active; },
    timers: () => [...armed.keys()],

    setAwake(next) {
      if (awake === next || scope.disposed) return;
      awake = next;
      if (!awake) {
        cancelQuietly();
        for (const name of [...armed.keys()]) disarm(name);
        refuseCooling = false;
        doozer.stop();
        fx.bowlHold(null);
        fx.changed();
      } else {
        // An hour may have passed behind a fullscreen app: no walking, just be there.
        snap();
      }
    },

    setAttended(next) {
      if (attended === next) return;
      attended = next;
      // Somebody arrived: do not make them wait out the long, lonely interval.
      if (attended && armed.has('act') && station === 'free') {
        disarm('act');
        armAct();
      }
    },

    setReduceMotion(on) { reduce = on; },

    hold(on) {
      if (held === on || scope.disposed) return;
      held = on;
      if (held) {
        cancelQuietly();
        disarm('act');
        fx.changed();
      } else {
        rested = null;
        reconcile();
      }
    },

    check: reconcile,
    snap,
    celebrate,

    welcome(done) {
      play('welcome', async (scene) => {
        afoot();
        fx.emote('sparkle', { count: 4 });
        await scene.until(doozer.perform('pop-in'));
        doozer.flash('wow', 700);
        await scene.wait(700);
        await scene.until(doozer.perform('wave'));
        // It picks its favourite snack (DESIGN_SPEC.md 3.2). Shown once.
        fx.emote('snack', { icon: brain.state.favourite });
        fx.emote('heart', { count: 2 });
        doozer.flash('love', 1500);
        await scene.wait(1500);
        done();
      });
    },

    destroy() { scope.dispose(); },
  };
}
