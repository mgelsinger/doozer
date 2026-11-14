// What Doozer does in the Desktop view: the things it does of its own accord (a stroll,
// peekaboo, a glance, a yawn) and the little scenes it plays when the brain says something
// happened (eating, the ball, a wash, a celebration).
//
// Never stuck (DESIGN_SPEC.md 6.4), in this file:
//   - Everything Doozer *does* is one scene in one `SceneRunner`. A new scene, a refusal,
//     being picked up, falling asleep, a session starting, the view going away or a time
//     limit all end the scene the same way: its clean-ups run, it is never resumed, and
//     `sceneEnded` leaves Doozer standing with nothing in its paws and nothing beside it.
//   - Every scene has a time limit, given where it is started.
//   - A walk is a step of a scene, and it answers "did not arrive" when it is stopped. A
//     scene whose walk did not arrive ends there. (The mockup's stuck scenes were walks
//     that were interrupted and never answered.)
//   - What Doozer does by itself is started by timers that exist only while it may wander,
//     and `check()` says so if one of them has gone missing.
//
// No rule about the pet is decided here: the brain says what happened, this shows it.

import type { Brain, BrainEvents, FoodId, ToyId, UnlockId } from '../../core/contract';
import { walkCycleMs, type Doozer } from '../../character/doozer';
import type { Timers } from '../../character/timers';
import { SceneRunner, Scope, type SceneContext, type SceneOutcome } from '../../ui/lifecycle';
import { syncDoozer, type EmoteKind } from '../../ui/presenter';
import { stepBall, type BallBounds } from './ball';
import type { Body } from './body';
import type { NamedTimers } from './named-timers';
import { paceFor, peekEdge, strollTarget, walkMs, within, type Pace } from './pace';
import type { Props } from './props';

export interface DirectorOptions {
  brain: Brain;
  doozer: Doozer;
  body: Body;
  props: Props;
  clock: NamedTimers;
  timers: Timers;
  random(): number;
  now(): number;
  emote(kind: EmoteKind, options?: { count?: number; icon?: FoodId | UnlockId }): void;
  /** The view is on screen (not tucked away, not popped out for a window change). */
  awake(): boolean;
  /** Nothing is open and nobody is at Doozer: it may wander off. */
  free(): boolean;
  /** Scenes are played where Doozer stands (the Card is open). */
  staysPut(): boolean;
  reduceMotion(): boolean;
  /** The spot Doozer was last put down at. */
  home(): number;
  /** Be lively for at least this long: something is about to move. */
  stir(ms: number): void;
  /** A scene began or ended. */
  changed(): void;
  /** The hatching has been shown to the end. */
  welcomed(): void;
  /** Where to keep count, when the counts should outlive this director (the view is remounted). */
  tally?: Record<string, SceneTally>;
  overruns?: Overrun[];
}

export type SceneTally = Record<SceneOutcome, number>;

/** A scene that did not end by itself and had to be ended by its time limit, or that threw. */
export interface Overrun {
  at: number;
  scene: string;
  outcome: 'timed-out' | 'failed';
}

const BITE_MS = 420;
const REFUSE_GAP_MS = 700;
/** How fast Doozer comes back in when something left it half off the screen. */
const RETURN_SPEED = 90;
/** How long past its limit a scene may be seen running before the watchdog calls it stuck. */
const OVERRUN_MS = 1500;
/** Poses that mean "in the middle of doing something". Standing idle must never show one. */
const DOING_POSES: ReadonlySet<string> = new Set(['walk', 'trot', 'peek', 'play', 'carried']);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

export class Director {
  private readonly scope = new Scope();
  private readonly scenes: SceneRunner;
  private readonly brain: Brain;
  private readonly doozer: Doozer;
  private readonly body: Body;
  private readonly props: Props;
  private readonly clock: NamedTimers;
  private sceneLimit = 0;
  private sceneSince = 0;
  /** It was time for a peek while Doozer was busy: it goes the next time it is free. */
  private peekDue = false;
  /** Outcomes of every scene played, by name. */
  readonly tally: Record<string, SceneTally>;
  /** Scenes that had to be ended by their limit, or that threw. Each one is a bug to explain. */
  readonly overruns: Overrun[];

  constructor(private readonly options: DirectorOptions) {
    this.brain = options.brain;
    this.doozer = options.doozer;
    this.body = options.body;
    this.props = options.props;
    this.clock = options.clock;
    this.tally = options.tally ?? {};
    this.overruns = options.overruns ?? [];
    this.scenes = new SceneRunner({
      timers: options.timers,
      onEnd: (name, outcome) => this.sceneEnded(name, outcome),
    });

    // The lasting look: mood face, glasses, hat, grime, colour.
    this.scope.add(syncDoozer(this.brain, this.doozer));
    this.scope.add(this.brain.on('action', (event) => this.onAction(event)));
    this.scope.add(this.brain.on('refuse', () => this.onRefuse()));
    this.scope.add(this.brain.on('focus', (event) => this.onFocus(event)));
    this.scope.add(this.brain.on('away', () => this.hello()));
    this.scope.add(this.brain.on('settings', ({ key }) => { if (key === 'desktopActivity') this.arm(); }));
    this.scope.add(() => this.scenes.destroy());
  }

  /** The name of the scene that is playing, or null. */
  get scene(): string | null { return this.scenes.active; }
  get pace(): Pace { return paceFor(this.brain.settings.desktopActivity); }

  private get quiet(): boolean { return this.brain.state.quiet; }
  private get asleep(): boolean { return this.brain.state.asleep; }

  /** Doozer is standing on the line in a view that is on screen: a scene can be played. */
  private canAct(): boolean {
    return this.options.awake() && this.body.onGround;
  }

  /** Doozer may go somewhere by itself right now. */
  private canWander(): boolean {
    return this.canAct() && this.scenes.active === null && !this.asleep && !this.quiet
      && !this.options.reduceMotion() && this.options.free();
  }

  /** The timers that start a stroll or a peek should be running. */
  private wanders(): boolean {
    return this.options.awake() && !this.asleep && !this.quiet && !this.options.reduceMotion();
  }

  // ---- starting and stopping ---------------------------------------------------------

  /** Start (or restart) the timers behind what Doozer does by itself. */
  arm(): void {
    for (const name of ['decide', 'peek', 'gesture']) this.clock.disarm(name);
    this.peekDue = false;
    this.syncAutonomy();
    if (this.options.awake()) this.armGesture();
  }

  /** End the scene that is playing, if any. The view calls this before it picks Doozer up. */
  interrupt(): void {
    this.scenes.cancel();
  }

  /** Stop everything this file started: the scene and the timers. (Tucked away.) */
  rest(): void {
    this.scenes.cancel();
    for (const name of ['decide', 'peek', 'gesture', 'glance', 'return', 'refuse-gap']) this.clock.disarm(name);
  }

  destroy(): void {
    this.scope.dispose();
  }

  /** Keep the wander timers in step with whether Doozer may wander at all. */
  syncAutonomy(): void {
    const pace = this.pace;
    const wanders = this.wanders();
    if (wanders && pace.strolls) {
      if (!this.clock.has('decide') && this.scenes.active === null) this.armDecide();
    } else {
      this.clock.disarm('decide');
    }
    if (wanders && pace.peekEvery) {
      if (!this.clock.has('peek')) this.armPeek();
    } else {
      this.clock.disarm('peek');
    }
  }

  private armDecide(): void {
    this.clock.arm('decide', within(this.pace.rest, this.options.random), () => this.decide());
  }

  private armPeek(): void {
    const every = this.pace.peekEvery;
    if (!every) return;
    this.clock.arm('peek', within(every, this.options.random), () => {
      if (this.peek()) return;
      // Busy with something (in Lively it usually is): the peek waits for the next free moment.
      this.peekDue = true;
      this.syncAutonomy();
    });
  }

  private armGesture(): void {
    this.clock.arm('gesture', within(this.pace.gestureEvery, this.options.random), () => {
      this.gesture();
      if (this.options.awake()) this.armGesture();
    });
  }

  private decide(): void {
    if (this.canWander()) {
      if (this.peekDue) {
        this.peekDue = false;
        if (this.peek()) return;
      }
      if (this.options.random() < this.pace.strollChance && this.stroll()) return;
    }
    this.syncAutonomy();
  }

  // ---- scenes ------------------------------------------------------------------------

  private play(name: string, maxMs: number, script: (scene: SceneContext) => Promise<void>): void {
    this.sceneLimit = maxMs;
    this.sceneSince = this.options.now();
    void this.scenes.play(name, async (scene) => {
      // Whatever a scene was doing with Doozer's feet, it stops when the scene does.
      scene.cleanup(() => this.body.stop());
      await script(scene);
    }, maxMs);
    // The next stroll is thought about once this scene is over.
    if (this.scenes.active !== null) this.clock.disarm('decide');
    this.options.stir(Math.min(maxMs, 4000));
    this.options.changed();
  }

  /** The one place a scene ends, however it ended. */
  private sceneEnded(name: string, outcome: SceneOutcome): void {
    const tally = (this.tally[name] ??= { finished: 0, interrupted: 0, 'timed-out': 0, failed: 0 });
    tally[outcome]++;
    if (outcome === 'timed-out' || outcome === 'failed') {
      this.overruns.push({ at: Date.now(), scene: name, outcome });
      if (this.overruns.length > 50) this.overruns.shift();
    }
    this.body.stop();
    // A scene that did not reach its own ending leaves no borrowed face or gesture behind.
    if (outcome !== 'finished') this.doozer.stop();
    if (this.body.onGround) {
      this.doozer.setPose(null);
      this.doozer.setFacing(0);
      this.doozer.setWalkCycle(null);
    }
    this.doozer.lookAt(0, 0);
    this.props.clear();
    // Left half off the screen (a peek cut short): come back in, in a moment.
    if (this.body.onGround && this.body.offstage) this.clock.arm('return', 0, () => this.comeBack());
    this.syncAutonomy();
    this.options.changed();
  }

  /** Emotes are Doozer talking, so a focus session silences them, except the refusal "?". */
  private emote(kind: EmoteKind, options?: { count?: number; icon?: FoodId | UnlockId }): void {
    if (!this.options.awake()) return;
    if (this.quiet && kind !== 'question' && kind !== 'bubble') return;
    this.options.emote(kind, options);
  }

  /**
   * First step of a scene that finds Doozer half off the screen: walk back in. (Asked only
   * when it is off, so that a scene on the screen starts at once, with nothing awaited.)
   */
  private async walkBackIn(scene: SceneContext): Promise<boolean> {
    if (!this.body.offstage) return true;
    if (this.options.reduceMotion()) {
      this.body.standAt(this.body.x);
      return true;
    }
    return scene.until(this.body.walkTo(this.body.x, { speed: RETURN_SPEED, gait: 'trot' }));
  }

  private comeBack(): void {
    if (this.scenes.active !== null || !this.body.onGround || !this.body.offstage) return;
    if (!this.options.awake() || this.options.reduceMotion() || this.asleep) {
      this.body.settle();
      return;
    }
    this.play('return', walkMs(this.body.stage.size * 2, RETURN_SPEED) + 4000, async (scene) => {
      await this.walkBackIn(scene);
    });
  }

  // ---- what Doozer does by itself ----------------------------------------------------

  /** A short walk along the line. False if there was nowhere to go, or it may not wander now. */
  stroll(): boolean {
    if (!this.canWander()) return false;
    const pace = this.pace;
    const target = strollTarget(pace, this.body.stage, this.body.x, this.options.home(), this.options.random);
    if (target === null) return false;
    this.play('stroll', walkMs(target - this.body.x, pace.strollSpeed) + 3000, async (scene) => {
      await scene.until(this.body.walkTo(target, { speed: pace.strollSpeed, gait: pace.strollGait }));
    });
    return true;
  }

  /**
   * Peekaboo (spec 6.4): walk to the nearer edge of the screen, slip half-way off, peek
   * back in, and return. False if it may not wander now or the edge is too far away.
   */
  peek(): boolean {
    if (!this.canWander()) return false;
    const pace = this.pace;
    const stage = this.body.stage;
    const side = peekEdge(pace, stage, this.body.x);
    if (side === null) return false;
    // A little more than half of Doozer out of sight.
    const edge = side < 0 ? -stage.size * 0.05 : stage.w + stage.size * 0.05;
    const settle = pace.peekReturn === 'home'
      ? this.options.home()
      : side < 0 ? stage.minX + 60 + this.options.random() * 200 : stage.maxX - 60 - this.options.random() * 200;
    const walk = { speed: pace.peekSpeed, gait: pace.peekGait };
    const limit = walkMs(edge - this.body.x, pace.peekSpeed) + walkMs(settle - edge, pace.peekSpeed) + 3000 + 5000;
    this.play('peek', limit, async (scene) => {
      if (!(await scene.until(this.body.walkTo(edge, { ...walk, offstage: true })))) return;
      const inward = side < 0 ? 1 : -1;
      this.doozer.setFacing(inward);
      this.doozer.setPose('peek');
      scene.cleanup(() => { this.doozer.setPose(null); this.doozer.setFacing(0); });
      this.doozer.lookAt(inward, -0.2);
      await scene.wait(1000);
      this.doozer.blink();
      await scene.wait(900);
      this.doozer.flash('love', 1000);
      this.emote('heart');
      await scene.wait(1100);
      this.doozer.setPose(null);
      this.doozer.lookAt(0, 0);
      await scene.until(this.body.walkTo(settle, walk));
    });
    return true;
  }

  /** A small sign of life while resting: a glance to one side, a yawn, a wave. */
  gesture(): boolean {
    const s = this.brain.state;
    if (!this.canAct() || this.scenes.active !== null || s.asleep || s.quiet || !this.options.free() || this.doozer.busy) return false;
    const random = this.options.random;
    const roll = random();
    if (s.mood === 'sleepy' && roll < 0.45) {
      this.options.stir(1700);
      void this.doozer.perform('yawn');
    } else if (this.pace.waves && (s.mood === 'joyful' || s.mood === 'content') && roll < 0.3) {
      this.options.stir(1600);
      void this.doozer.perform('wave');
    } else {
      // A glance costs two short redraws and needs nothing else to be running.
      this.doozer.lookAt((random() < 0.5 ? -1 : 1) * (0.5 + random() * 0.4), (random() - 0.6) * 0.5);
      this.clock.arm('glance', 1300 + random() * 1200, () => {
        if (this.scenes.active === null && this.options.free()) this.doozer.lookAt(0, 0);
      });
    }
    return true;
  }

  /** A new pet is shown once: it pops in, waves, and shows its favourite snack. */
  welcome(): void {
    if (!this.canAct()) return;
    this.play('welcome', 9000, async (scene) => {
      this.emote('sparkle', { count: 4 });
      await scene.until(this.doozer.perform('pop-in'));
      this.doozer.flash('wow', 800);
      await scene.wait(800);
      await scene.until(this.doozer.perform('wave'));
      this.emote('snack', { icon: this.brain.state.favourite });
      this.emote('heart', { count: 2 });
      this.doozer.flash('love', 1500);
      await scene.wait(1500);
      this.options.welcomed();
    });
  }

  /** The celebration for a session that finished while Doozer could not show it. */
  celebrate(treats: number, unlocked: readonly UnlockId[]): void {
    if (!this.canAct()) {
      if (this.options.awake()) this.doozer.flash('cheer', 1200);
      return;
    }
    this.play('celebrate', 9000, async (scene) => {
      if (this.body.offstage && !(await this.walkBackIn(scene))) return;
      this.emote('sparkle', { count: 6 });
      if (treats > 0) this.emote('snack', { count: Math.min(3, treats), icon: 'biscuit' });
      await scene.until(this.doozer.perform('celebrate'));
      for (const id of unlocked) {
        this.emote('snack', { icon: id });
        this.emote('sparkle', { count: 2 });
        await scene.wait(520);
      }
      this.doozer.flash('love', 900);
    });
  }

  /** The ball was poked by the pointer: it jumps. */
  bop(fromX: number): boolean {
    const prop = this.props.inPlay;
    if (!prop) return false;
    const random = this.options.random;
    prop.ball.vy = -(600 + random() * 160);
    prop.ball.vx = (prop.ball.x >= fromX ? 1 : -1) * (80 + random() * 160);
    return true;
  }

  // ---- what the brain says happened ----------------------------------------------------

  private onAction(event: BrainEvents['action']): void {
    if (!this.options.awake()) return;
    switch (event.type) {
      case 'feed': this.eat(event.food, 2, false); break;
      case 'auto-eat': this.eat(event.food, 1, false); break;
      case 'treat': this.eat(event.food, 3, event.favourite); break;
      case 'play': this.playBall(event.toy); break;
      case 'wash': this.wash(event.duck); break;
      case 'pet': this.pet(); break;
      case 'fill-bowl':
        if (this.scenes.active === null && !this.quiet) {
          this.options.stir(900);
          this.doozer.flash('wow', 650);
        }
        break;
      case 'sleep':
        this.scenes.cancel();
        this.options.stir(2400);
        if (this.body.onGround) void this.doozer.perform('fall-asleep');
        else this.body.refreshCarriedFace();
        break;
      case 'wake':
        this.scenes.cancel();
        this.options.stir(2200);
        if (this.body.onGround) void this.doozer.perform('wake');
        else this.body.refreshCarriedFace();
        break;
    }
    this.syncAutonomy();
  }

  private onRefuse(): void {
    if (!this.options.awake()) return;
    // Hammering a refused button gets one emote per head-shake, not a cloud of them.
    const first = !this.clock.has('refuse-gap');
    if (first) this.clock.arm('refuse-gap', REFUSE_GAP_MS, () => undefined);
    this.options.stir(1500);
    if (this.asleep) {
      // Asleep: it does not wake to say no. A small stir and a "z".
      if (first) {
        if (this.body.onGround) void this.doozer.perform('stir');
        this.emote('z');
      }
      return;
    }
    this.scenes.cancel();
    this.doozer.flash('no', 900);
    if (first) this.emote('question');
  }

  private onFocus(event: BrainEvents['focus']): void {
    if (this.options.awake()) {
      if (event.type === 'start') {
        // Spec 4.5: glasses on, and it settles. Whatever it was doing ends here.
        this.scenes.cancel();
        this.options.stir(900);
        if (this.body.onGround) void this.doozer.perform('nod');
      } else if (event.type === 'complete') {
        this.celebrate(event.treats, event.unlocked);
      }
      // pause, resume and stop: no comment from Doozer. No scolding.
    }
    this.syncAutonomy();
  }

  private hello(): void {
    if (!this.canAct() || this.scenes.active !== null || this.asleep || this.quiet) return;
    this.options.stir(1700);
    void this.doozer.perform('wave');
  }

  private eat(food: FoodId, hearts: number, favourite: boolean): void {
    if (!this.canAct()) {
      // In the hand or in the air: no snack on the ground to walk to. The face says it.
      if (this.options.awake()) this.doozer.flash('eat', 900);
      return;
    }
    const pace = this.pace;
    const random = this.options.random;
    this.play('eat', 16_000, async (scene) => {
      if (this.body.offstage && !(await this.walkBackIn(scene))) return;
      const body = this.body;
      const stage = body.stage;
      const runs = pace.runsToFood && !this.quiet && !this.options.staysPut() && !this.options.reduceMotion();
      // How far from Doozer's middle the snack is when it is eaten: at its paws.
      const reach = Math.round(stage.size * 0.42);
      const far = runs ? 110 : reach;
      let side: -1 | 1 = random() < 0.5 ? -1 : 1;
      if (body.x - far < Math.max(24, stage.minX - reach)) side = 1;
      else if (body.x + far > Math.min(stage.w - 24, stage.maxX + reach)) side = -1;
      const foodX = runs
        ? clamp(body.x + side * (80 + random() * 30), stage.minX - 10, stage.maxX + 10)
        : body.x + side * reach;
      const snack = this.props.food(food, foodX, stage.ground, side > 0 ? 'left' : 'right');
      scene.cleanup(() => snack.remove());
      if (runs) {
        this.doozer.flash('wow', 700);
        this.doozer.lookAt(side * 0.8, 0.3);
        await scene.wait(700);
        if (!(await scene.until(body.walkTo(foodX - side * reach, { speed: pace.foodSpeed, gait: 'trot' })))) return;
      } else {
        this.doozer.lookAt(side * 0.8, 0.45);
        await scene.wait(380);
      }
      this.doozer.lookAt(side * 0.9, 0.7);
      const biteMs = runs ? 540 : BITE_MS;
      this.doozer.flash('eat', biteMs * 3 + 150);
      for (let bite = 1; bite <= 3; bite++) {
        snack.bite(bite);
        await scene.wait(biteMs);
      }
      snack.remove();
      this.doozer.lookAt(0, 0);
      if (this.quiet) return;
      if (favourite) {
        this.emote('sparkle', { count: 4 });
        this.emote('heart', { count: 4 });
        await scene.until(this.doozer.perform('celebrate'));
      } else {
        this.emote('heart', { count: hearts });
        this.doozer.flash(runs ? 'cheer' : 'love', runs ? 1300 : 900);
        await scene.wait(runs ? 1300 : 900);
      }
    });
  }

  /**
   * Play. Calm (spec 6.4): Doozer bats the ball back and forth where it stands for a few
   * seconds and does not run after it. Lively: as the mockup did, the ball drops a little
   * way off and Doozer chases it and kicks it, six kicks or sixteen seconds.
   */
  private playBall(toy: Exclude<ToyId, 'duck'>): void {
    if (!this.canAct()) return;
    const pace = this.pace;
    const random = this.options.random;
    const chase = pace.chasesBall && !this.quiet && !this.options.staysPut() && !this.options.reduceMotion();
    this.play('play', chase ? 24_000 : 10_000, async (scene) => {
      if (this.body.offstage && !(await this.walkBackIn(scene))) return;
      const body = this.body;
      const doozer = this.doozer;
      const stage = body.stage;
      const size = stage.size;
      const bounds: BallBounds = { left: 0, right: stage.w, top: 0, ground: stage.ground };
      const side = body.x < stage.w / 2 ? 1 : -1;
      const prop = chase
        ? this.props.ball(toy, clamp(body.x + side * 140, 60, Math.max(60, stage.w - 60)), Math.max(40, stage.ground - 300))
        : this.props.ball(toy, body.x + side * size * 0.25, Math.max(30, body.y - size * 1.9));
      scene.cleanup(() => prop.remove());
      const ball = prop.ball;
      ball.vx = chase ? random() * 240 - 120 : 0;
      if (chase) {
        doozer.setWalkCycle(walkCycleMs(size, pace.chaseSpeed, 'trot'));
        doozer.setPose('trot');
      } else {
        doozer.setPose('play', 'cheer');
      }
      scene.cleanup(() => { doozer.setPose(null); doozer.setFacing(0); doozer.setWalkCycle(null); });

      let kicks = 0;
      let cooldown = 0;
      // Near a corner the ball can lie closer to the edge than Doozer may stand.
      const kickReach = Math.max(36, stage.minX - ball.r + 6);
      const stopPlaying = body.addTicker((dt) => {
        stepBall(ball, dt, bounds);
        prop.draw();
        cooldown -= dt;
        const dx = ball.x - body.x;
        if (chase) {
          if (Math.abs(dx) > kickReach) {
            const dir = dx > 0 ? 1 : -1;
            body.shift(dir * pace.chaseSpeed * dt);
            doozer.setFacing(dir);
            doozer.lookAt(dir * 0.85, clamp((ball.y - (body.y - size * 0.55)) / 200, -1, 0.6));
          } else if (ball.y > stage.ground - 84 && cooldown <= 0) {
            cooldown = 0.35;
            const away = dx >= 0 ? 1 : -1;
            const roomAhead = away > 0 ? stage.w - ball.x : ball.x;
            const dir = roomAhead < 160 ? -away : away;
            ball.vx = dir * (260 + random() * 260);
            ball.vy = -(620 + random() * 280);
            doozer.squish(1.1);
            kicks++;
            if (kicks % 2 === 0) this.emote('heart');
          }
        } else {
          // Batting: when the ball comes down to paw height within reach, pat it up and across.
          doozer.lookAt(clamp(dx / 60, -1, 1), -0.8);
          const within = Math.abs(dx) < size * 0.7;
          if (within && ball.vy > 0 && ball.y + ball.r > body.y - size * 0.9 && cooldown <= 0) {
            cooldown = 0.3;
            ball.vy = -(560 + random() * 120);
            const flight = (2 * -ball.vy) / 2100;
            const across = (dx > 0 ? -1 : 1) * size * (0.2 + random() * 0.1);
            ball.vx = (across - dx) / flight;
            kicks++;
          }
        }
      });
      scene.cleanup(stopPlaying);

      if (chase) {
        const began = this.options.now();
        while (kicks < 6 && this.options.now() - began < 16_000) await scene.wait(200);
      } else {
        await scene.wait(4200);
      }
      stopPlaying();
      doozer.setPose(null);
      doozer.setFacing(0);
      doozer.setWalkCycle(null);
      doozer.lookAt(0, 0);
      prop.remove();
      if (this.quiet) return;
      this.emote('heart', { count: 3 });
      doozer.flash(chase ? 'cheer' : 'love', chase ? 1400 : 800);
      await scene.wait(chase ? 1400 : 800);
    });
  }

  private wash(duck: boolean): void {
    if (!this.canAct()) return;
    this.play('wash', 9000, async (scene) => {
      if (this.body.offstage && !(await this.walkBackIn(scene))) return;
      const body = this.body;
      const stage = body.stage;
      const side = body.x < stage.w / 2 ? 1 : -1;
      const toy = duck ? this.props.duck(body.x + side * stage.size * 0.62, stage.ground) : null;
      if (toy) scene.cleanup(() => toy.remove());
      this.doozer.flash('shake', 1500);
      for (let i = 0; i < 3; i++) {
        this.emote('bubble', { count: 5 });
        await scene.wait(470);
      }
      toy?.remove();
      this.emote('sparkle', { count: 5 });
      await scene.until(this.doozer.perform('shake-off'));
      if (this.quiet) return;
      this.doozer.flash('cheer', 800);
      await scene.wait(800);
    });
  }

  private pet(): void {
    this.options.stir(1500);
    this.doozer.squish(0.7);
    this.emote('heart');
    // Mid-scene, or in the hand, the face belongs to that; otherwise a happy flash.
    if (this.scenes.active === null && this.body.onGround) this.doozer.flash('love', 1000);
  }

  // ---- the watchdog's questions ------------------------------------------------------

  /** Everything about what Doozer is doing that is not as it should be. Empty when all is well. */
  check(): string[] {
    const problems: string[] = [];
    const scene = this.scenes.active;
    const body = this.body;
    if (scene !== null) {
      if (!body.onGround) problems.push(`the "${scene}" scene is playing while Doozer is off the ground`);
      if (this.options.now() - this.sceneSince > this.sceneLimit + OVERRUN_MS) problems.push(`the "${scene}" scene ran past its limit`);
      if (!this.options.awake()) problems.push(`the "${scene}" scene is playing while tucked away`);
    } else {
      if (body.walking) problems.push('walking with no scene behind it');
      if (this.props.count > 0) problems.push('something was left lying beside Doozer');
      if (body.onGround && !body.moving && DOING_POSES.has(this.doozer.pose)) problems.push(`standing idle in the "${this.doozer.pose}" pose`);
      if (body.onGround && body.offstage && !this.clock.has('return')) problems.push('left standing off the screen');
      if (this.options.awake() && this.wanders()) {
        if (this.pace.strolls && !this.clock.has('decide')) problems.push('nothing will start the next stroll');
        if (this.pace.peekEvery && !this.clock.has('peek')) problems.push('nothing will start the next peek');
      }
    }
    return problems;
  }
}
