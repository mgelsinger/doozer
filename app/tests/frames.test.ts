import { describe, expect, it, vi } from 'vitest';
import { AMBIENT_FPS, ATTENDED_FPS, ATTEND_MS, FALLBACK_MS, FrameClock } from '../src/frames';

// ---- A pretend screen: a clock, timers, and frames at a refresh rate -------------------

/**
 * As a browser does it. Every frame is stamped with the moment of the refresh it belongs
 * to. A page that has had a frame lately is offered the next refresh. A page that has been
 * idle for a few refreshes (`idleRefreshes`; Infinity: never) is handed the refresh it has
 * just missed, at once.
 */
function pretendScreen(hz = 120, idleRefreshes = 3.5) {
  let time = 0;
  let nextTimer = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  type FrameCallback = (frameTime?: number) => void;
  let frameCallbacks: FrameCallback[] = [];
  const handedAtOnce = new Map<FrameCallback, number>();
  let framesOffered = 0;
  let framesComing = true;
  const period = 1000 / hz;
  let nextRefresh = period;
  let lastFrameAt = -Infinity;
  let longestTimer = 0;
  const stamps: number[] = [];

  const runTimersUpTo = (limit: number): void => {
    for (;;) {
      let first: [number, { at: number; fn: () => void }] | null = null;
      for (const entry of timers) if (entry[1].at <= limit && (!first || entry[1].at < first[1].at)) first = entry;
      if (!first) return;
      timers.delete(first[0]);
      time = Math.max(time, first[1].at);
      first[1].fn();
    }
  };

  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = nextTimer++;
        if (ms !== FALLBACK_MS) longestTimer = Math.max(longestTimer, ms);
        timers.set(id, { at: time + Math.max(0, ms), fn });
        return id;
      },
      clear: (handle: unknown) => { timers.delete(handle as number); },
    },
    now: () => time,
    requestFrame: (callback: FrameCallback) => {
      if (framesComing && time - lastFrameAt > idleRefreshes * period) {
        // Idle: the refresh just missed, at once.
        const stamp = nextRefresh - period;
        const id = nextTimer++;
        timers.set(id, { at: time, fn: () => { handedAtOnce.delete(callback); lastFrameAt = time; framesOffered++; stamps.push(stamp); callback(stamp); } });
        handedAtOnce.set(callback, id);
        return callback;
      }
      frameCallbacks.push(callback);
      return callback;
    },
    cancelFrame: (handle: unknown) => {
      frameCallbacks = frameCallbacks.filter((c) => c !== handle);
      const id = handedAtOnce.get(handle as FrameCallback);
      if (id !== undefined) { timers.delete(id); handedAtOnce.delete(handle as FrameCallback); }
    },
    /** Let `ms` pass: timers fire when due and the screen offers a frame at every refresh. */
    advance(ms: number): void {
      const end = time + ms;
      while (nextRefresh <= end) {
        runTimersUpTo(nextRefresh);
        time = nextRefresh;
        nextRefresh += period;
        if (framesComing && frameCallbacks.length) {
          framesOffered++;
          lastFrameAt = time;
          const due = frameCallbacks;
          frameCallbacks = [];
          stamps.push(time);
          for (const callback of due) callback(time);
        }
      }
      runTimersUpTo(end);
      time = end;
    },
    /** A hidden or covered window: the screen offers nothing. */
    stopFrames(): void { framesComing = false; },
    pendingTimers: () => timers.size,
    pendingFrames: () => frameCallbacks.length + handedAtOnce.size,
    framesOffered: () => framesOffered,
    /** The longest single wait the clock has asked a timer for (the fallback aside). */
    longestTimer: () => longestTimer,
    /** The refresh each frame handed out belonged to. */
    stamps: () => stamps,
    period,
  };
}

// ---- Pretend animations and a pretend document ----------------------------------------------

interface FakeOptions { end?: number; css?: boolean; holder?: { live: boolean }; rate?: number; state?: AnimationPlayState; at?: number }

class FakeAnimation {
  playState: AnimationPlayState;
  playbackRate: number;
  timeline: unknown = null;
  writes: number[] = [];
  calls: string[] = [];
  private time: number;
  effect: { target: { closest(selector: string): unknown }; getComputedTiming(): { endTime: number } };
  breaks = false;

  constructor(private readonly options: FakeOptions = {}) {
    this.playState = options.state ?? 'running';
    this.playbackRate = options.rate ?? 1;
    this.time = options.at ?? 0;
    // Present on a CSS animation only, as in a browser.
    if (options.css) (this as unknown as { animationName: string }).animationName = 'dz-breathe';
    const holder = options.holder;
    this.effect = {
      target: { closest: (selector: string) => (selector === '[data-live="0"]' && holder && !holder.live ? {} : null) },
      getComputedTiming: () => ({ endTime: options.end ?? Infinity }),
    };
  }

  get currentTime(): number { return this.time; }
  set currentTime(value: number) {
    if (this.breaks) throw new Error('this one will not be moved');
    this.time = value;
    this.writes.push(value);
  }
  /** The browser moving a running animation on by itself. */
  runNatively(ms: number): void { if (this.playState === 'running') this.time += ms * this.playbackRate; }
  pause(): void { this.calls.push('pause'); this.playState = 'paused'; }
  play(): void { this.calls.push('play'); this.playState = 'running'; }
  finish(): void { this.calls.push('finish'); this.playState = 'finished'; this.time = this.options.end ?? this.time; }
}

function pretendDocument() {
  const animations: FakeAnimation[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const timeline = {};
  const doc = {
    timeline,
    documentElement: {},
    getAnimations: () => animations.filter((a) => a.playState !== 'idle'),
    addEventListener: (type: string, handler: () => void) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type))?.add(handler); },
    removeEventListener: (type: string, handler: () => void) => { listeners.get(type)?.delete(handler); },
  };
  return {
    doc: doc as unknown as Document,
    add(options: FakeOptions = {}): FakeAnimation {
      const animation = new FakeAnimation(options);
      animation.timeline = timeline;
      animations.push(animation);
      return animation;
    },
    remove(animation: FakeAnimation): void { animation.playState = 'idle'; },
    emit(type: string): void { for (const handler of [...(listeners.get(type) ?? [])]) handler(); },
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

function setUp(hz = 120) {
  const screen = pretendScreen(hz);
  const page = pretendDocument();
  const clock = new FrameClock({ timers: screen.timers, now: screen.now, requestFrame: screen.requestFrame, cancelFrame: screen.cancelFrame });
  const detach = clock.attach(page.doc);
  return { screen, page, clock, detach };
}

// ---- In step with the screen -------------------------------------------------------------------

describe('each picture on the refresh it was aimed at', () => {
  /** The gaps between the refreshes the pictures belonged to, in refreshes. */
  const gapsOf = (screen: ReturnType<typeof pretendScreen>, from = 0): number[] => {
    const stamps = screen.stamps().slice(from);
    return stamps.slice(1).map((stamp, i) => Math.round((stamp - (stamps[i] ?? stamp)) / screen.period));
  };

  it('a slow rate: the idle page is handed the refresh it has just missed, and that is the one aimed for', () => {
    const { screen, page, clock } = setUp(120);
    page.add({ css: true });
    page.emit('animationstart');
    screen.advance(3000);
    const gaps = gapsOf(screen, 2);
    // 24 a second on a 120 Hz screen: every fifth refresh, every time, and nothing passed over to get it.
    expect(new Set(gaps)).toEqual(new Set([5]));
    expect(clock.stats.passedOver).toBe(0);
    expect(clock.stats.late).toBe(0);
    expect(clock.stats.ticks).toBe(screen.framesOffered());
  });

  it('a quick rate: the page is still being offered every refresh, and is asked a little before', () => {
    const { screen, page, clock } = setUp(120);
    page.add({ css: true });
    page.emit('animationstart');
    clock.attend(60_000);
    screen.advance(2000);
    expect(new Set(gapsOf(screen, 2))).toEqual(new Set([2]));
    expect(clock.stats.passedOver).toBe(0);
    expect(clock.stats.late).toBe(0);
  });

  it('a 60 Hz screen: 24 a second does not fit, so every third refresh (20 a second), not two-three-two', () => {
    const { screen, page, clock } = setUp(60);
    page.add({ css: true });
    page.emit('animationstart');
    screen.advance(3000);
    expect(new Set(gapsOf(screen, 4))).toEqual(new Set([3]));
    // (One picture may count as late while the clock finds out how this screen behaves.)
    expect(clock.stats.late).toBeLessThanOrEqual(1);
  });

  it('a page that is not idle after all costs one late picture, and the clock asks beforehand from then on', () => {
    // A browser that never hands out a missed frame: whoever asks waits for the next refresh.
    const screen = pretendScreen(120, Infinity);
    const page = pretendDocument();
    const clock = new FrameClock({ timers: screen.timers, now: screen.now, requestFrame: screen.requestFrame, cancelFrame: screen.cancelFrame });
    clock.attach(page.doc);
    page.add({ css: true });
    page.emit('animationstart');
    screen.advance(3000);
    const gaps = gapsOf(screen);
    expect(clock.stats.late).toBe(1);
    expect(gaps.filter((gap) => gap !== 5)).toEqual([6]);
    expect(gaps.slice(-20).every((gap) => gap === 5)).toBe(true);
  });

  it('a page that goes idle sooner than guessed costs one frame passed over, and the clock asks afterwards from then on', () => {
    // 40 a second (a tick every 25 ms, which the clock guesses is too quick for the page to go idle), on a browser that calls a page idle after two refreshes.
    const screen = pretendScreen(120, 1.5);
    const page = pretendDocument();
    const clock = new FrameClock({ timers: screen.timers, now: screen.now, requestFrame: screen.requestFrame, cancelFrame: screen.cancelFrame });
    clock.setRates({ ambient: 40, attended: 40 });
    clock.attach(page.doc);
    page.add({ css: true });
    page.emit('animationstart');
    screen.advance(3000);
    expect(clock.stats.passedOver).toBe(1);
    expect(clock.stats.late).toBe(0);
    // 40 a second at 120 Hz: a tick every third refresh.
    expect(clock.stats.ticks).toBeGreaterThanOrEqual(118);
    expect(clock.stats.ticks).toBeLessThanOrEqual(121);
  });

  it('never waits on one long timer: the browser lets those slip', () => {
    const { screen, page } = setUp(120);
    page.add({ css: true });
    page.emit('animationstart');
    screen.advance(2000);
    expect(screen.longestTimer()).toBeGreaterThan(10);
    expect(screen.longestTimer()).toBeLessThanOrEqual(24);
  });

  it('a stamp that cannot be right is not believed', () => {
    const screen = pretendScreen(120);
    const page = pretendDocument();
    // A browser whose frame stamps are on some other clock altogether.
    const clock = new FrameClock({
      timers: screen.timers, now: screen.now, cancelFrame: screen.cancelFrame,
      requestFrame: (callback) => screen.requestFrame(() => callback(screen.now() + 5_000_000)),
    });
    clock.attach(page.doc);
    const walk = page.add({ css: true });
    page.emit('animationstart');
    screen.advance(2000);
    // It still ticks, at about the rate asked for, counting from its own clock.
    expect(clock.stats.ticks).toBeGreaterThanOrEqual(40);
    expect(clock.stats.ticks).toBeLessThanOrEqual(50);
    expect(walk.currentTime).toBeGreaterThan(1900);
  });
});

// ---- Before it is attached ---------------------------------------------------------------------

describe('a frame clock that paces nothing', () => {
  it('hands out the screen\'s own frames, as they come', () => {
    const screen = pretendScreen();
    const clock = new FrameClock({ timers: screen.timers, now: screen.now, requestFrame: screen.requestFrame, cancelFrame: screen.cancelFrame });
    let frames = 0;
    const loop = (): void => { frames++; clock.request(loop); };
    clock.request(loop);
    screen.advance(1000);
    // Every refresh of the screen (the last one may fall on the boundary).
    expect(frames).toBeGreaterThanOrEqual(119);
    expect(frames).toBeLessThanOrEqual(120);
    expect(screen.pendingTimers()).toBe(0);
  });

  it('takes a request back', () => {
    const screen = pretendScreen();
    const clock = new FrameClock({ timers: screen.timers, now: screen.now, requestFrame: screen.requestFrame, cancelFrame: screen.cancelFrame });
    const callback = vi.fn();
    clock.request(callback)();
    screen.advance(100);
    expect(callback).not.toHaveBeenCalled();
  });

  it('says so where there are no frames at all, so that callers fall back to their timers', () => {
    const screen = pretendScreen();
    const clock = new FrameClock({ timers: screen.timers, now: screen.now, requestFrame: null });
    expect(clock.frameSource()).toBeNull();
    const callback = vi.fn();
    clock.request(callback);
    screen.advance(1000);
    expect(callback).not.toHaveBeenCalled();
    expect(screen.pendingTimers()).toBe(0);
  });

  it('wake does nothing', () => {
    const screen = pretendScreen();
    const clock = new FrameClock({ timers: screen.timers, now: screen.now, requestFrame: screen.requestFrame, cancelFrame: screen.cancelFrame });
    clock.wake();
    expect(screen.pendingTimers() + screen.pendingFrames()).toBe(0);
  });
});

// ---- Pacing -------------------------------------------------------------------------------------

describe('pacing the page\'s animations', () => {
  it('takes a running animation over exactly where it is, and moves it on by the time that really passed', () => {
    const { screen, page, clock } = setUp();
    const walk = page.add({ at: 250 });
    screen.advance(20);
    expect(walk.calls).toEqual(['pause']);
    expect(walk.writes[0]).toBe(250);
    screen.advance(1000);
    // A second later it is a second further on (to within one tick), not faster and not slower.
    expect(walk.currentTime).toBeGreaterThan(250 + 1000 - 1000 / AMBIENT_FPS - 1);
    // (A tick comes a millisecond after the refresh it belongs to.)
    expect(walk.currentTime).toBeLessThanOrEqual(250 + 1000 + 2);
    expect(clock.stats.adopted).toBe(1);
  });

  it('draws at the ambient rate with nobody there, and evenly: every picture for the same number of refreshes', () => {
    const { screen, page } = setUp(120);
    const walk = page.add();
    screen.advance(100);
    const before = walk.writes.length;
    screen.advance(2000);
    const perSecond = (walk.writes.length - before) / 2;
    expect(perSecond).toBeGreaterThanOrEqual(AMBIENT_FPS - 1);
    expect(perSecond).toBeLessThanOrEqual(AMBIENT_FPS + 1);
    // Evenly: every step is the same number of refreshes long.
    const steps = walk.writes.slice(-20).map((value, i, all) => (i ? value - (all[i - 1] as number) : NaN)).slice(1);
    for (const step of steps) expect(step).toBeCloseTo(steps[0] as number, 6);
  });

  it('never draws more often than the cap, whatever the screen', () => {
    for (const hz of [60, 75, 120, 144, 165, 240]) {
      const { screen, page } = setUp(hz);
      const walk = page.add();
      screen.advance(200);
      const before = walk.writes.length;
      screen.advance(3000);
      const perSecond = (walk.writes.length - before) / 3;
      expect(perSecond, `${hz} Hz`).toBeLessThanOrEqual(AMBIENT_FPS * 1.15);
      expect(perSecond, `${hz} Hz`).toBeGreaterThanOrEqual(AMBIENT_FPS * 0.6);
    }
  });

  it('draws at the higher rate while somebody is there, and goes back by itself', () => {
    const { screen, page, clock } = setUp();
    const walk = page.add();
    screen.advance(100);
    clock.attend();
    expect(clock.fps).toBe(ATTENDED_FPS);
    let before = walk.writes.length;
    screen.advance(1000);
    expect(walk.writes.length - before).toBeGreaterThanOrEqual(ATTENDED_FPS - 2);
    expect(walk.writes.length - before).toBeLessThanOrEqual(ATTENDED_FPS + 2);
    screen.advance(ATTEND_MS);
    expect(clock.fps).toBe(AMBIENT_FPS);
    before = walk.writes.length;
    screen.advance(1000);
    expect(walk.writes.length - before).toBeLessThanOrEqual(AMBIENT_FPS + 1);
  });

  it('a pointer event anywhere in the page is somebody being there', () => {
    const { page, clock } = setUp();
    expect(clock.fps).toBe(AMBIENT_FPS);
    page.emit('pointermove');
    expect(clock.fps).toBe(ATTENDED_FPS);
  });

  it('finishes an animation that has an end, at its end, and leaves a looping one going', () => {
    const { screen, page, clock } = setUp();
    const hop = page.add({ end: 620 });
    const breathe = page.add({ css: true });
    screen.advance(700);
    expect(hop.calls).toEqual(['pause', 'finish']);
    expect(hop.playState).toBe('finished');
    expect(clock.stats.finished).toBe(1);
    // It was never set past its end.
    expect(Math.max(...hop.writes)).toBeLessThan(620);
    screen.advance(5000);
    expect(breathe.playState).toBe('paused');
    expect(breathe.currentTime).toBeGreaterThan(5000);
  });

  it('follows an animation that plays at another speed', () => {
    const { screen, page } = setUp();
    const slow = page.add({ rate: 0.5 });
    screen.advance(2020);
    expect(slow.currentTime).toBeGreaterThan(950);
    expect(slow.currentTime).toBeLessThanOrEqual(1010);
  });

  it('leaves alone what is not its to move: paused by its owner, finished, or on another clock', () => {
    const { screen, page } = setUp();
    const owners = page.add({ state: 'paused', at: 40 });
    const done = page.add({ state: 'finished', at: 300 });
    const scroll = page.add();
    scroll.timeline = {};
    const walk = page.add();
    screen.advance(500);
    expect(owners.calls).toEqual([]);
    expect(owners.currentTime).toBe(40);
    expect(done.calls).toEqual([]);
    expect(scroll.calls).toEqual([]);
    expect(walk.calls).toEqual(['pause']);
  });

  it('gives an animation back when somebody else plays it', () => {
    const { screen, page } = setUp();
    const walk = page.add();
    screen.advance(200);
    const written = walk.writes.length;
    walk.playState = 'finished';
    screen.advance(200);
    expect(walk.writes.length).toBe(written);
  });

  it('never moves an animation that has been cancelled', () => {
    const { screen, page } = setUp();
    const walk = page.add({ css: true });
    const other = page.add();
    screen.advance(200);
    const written = walk.writes.length;
    // The pose changed: the stylesheet no longer asks for it.
    page.remove(walk);
    screen.advance(500);
    expect(walk.writes.length).toBe(written);
    expect(other.currentTime).toBeGreaterThan(600);
  });

  it('an animation that cannot be moved is handed back to the browser, and the rest carry on', () => {
    const { screen, page, clock } = setUp();
    const stubborn = page.add();
    const walk = page.add();
    screen.advance(100);
    stubborn.breaks = true;
    screen.advance(300);
    expect(stubborn.calls).toEqual(['pause', 'play']);
    expect(clock.stats.released).toBe(1);
    expect(walk.currentTime).toBeGreaterThan(300);
    // It runs by itself from now on: it is not taken over a second time.
    stubborn.breaks = false;
    screen.advance(300);
    expect(stubborn.calls).toEqual(['pause', 'play']);
    expect(stubborn.playState).toBe('running');
  });
});

// ---- Rest ---------------------------------------------------------------------------------------

describe('when nothing is moving', () => {
  it('holds no timer and asks for no frame', () => {
    const { screen, page, clock } = setUp();
    const hop = page.add({ end: 300 });
    screen.advance(1000);
    expect(hop.playState).toBe('finished');
    expect(clock.stats.running).toBe(false);
    expect(screen.pendingTimers()).toBe(0);
    expect(screen.pendingFrames()).toBe(0);
    const offered = screen.framesOffered();
    screen.advance(60_000);
    expect(screen.framesOffered()).toBe(offered);
  });

  it('wakes when the page says an animation has started', () => {
    const { screen, page, clock } = setUp();
    screen.advance(1000);
    expect(clock.stats.running).toBe(false);
    const emote = page.add({ end: 1250, css: true });
    page.emit('animationstart');
    screen.advance(100);
    expect(emote.calls).toEqual(['pause']);
    screen.advance(1300);
    expect(emote.playState).toBe('finished');
    expect(screen.pendingTimers()).toBe(0);
  });

  it('wakes for a transition, and when told to look', () => {
    const { screen, page, clock } = setUp();
    screen.advance(500);
    const fade = page.add({ end: 200 });
    page.emit('transitionrun');
    screen.advance(50);
    expect(fade.calls).toEqual(['pause']);
    screen.advance(500);
    const wave = page.add({ end: 400 });
    clock.wake();
    screen.advance(50);
    expect(wave.calls).toEqual(['pause']);
  });

  it('an animation nobody told it about simply runs as the browser runs it', () => {
    const { screen, page } = setUp();
    screen.advance(500);
    const stray = page.add({ end: 400 });
    screen.advance(100);
    expect(stray.calls).toEqual([]);
    expect(stray.playState).toBe('running');
  });
});

// ---- Held ---------------------------------------------------------------------------------------

describe('a resting Doozer (data-live="0")', () => {
  it('holds its looping animations exactly where they are, and the clock goes to rest', () => {
    const { screen, page, clock } = setUp();
    const rig = { live: true };
    const breathe = page.add({ css: true, holder: rig });
    screen.advance(1000);
    const at = breathe.currentTime;
    rig.live = false;
    screen.advance(5000);
    expect(breathe.currentTime).toBe(at);
    expect(clock.stats.running).toBe(false);
    expect(screen.pendingTimers()).toBe(0);
  });

  it('carries on from where it stopped, without a jump, when Doozer comes alive again', () => {
    const { screen, page, clock } = setUp();
    const rig = { live: true };
    const breathe = page.add({ css: true, holder: rig });
    screen.advance(1000);
    rig.live = false;
    screen.advance(30_000);
    const at = breathe.currentTime;
    rig.live = true;
    clock.wake();
    screen.advance(100);
    expect(breathe.currentTime).toBeGreaterThan(at);
    expect(breathe.currentTime).toBeLessThan(at + 110);
  });

  it('does not hold a transition or a one-shot: a face that changes at rest still finishes changing', () => {
    const { screen, page } = setUp();
    const rig = { live: false };
    const loop = page.add({ css: true, holder: rig });
    const tuft = page.add({ end: 700, holder: rig });
    page.emit('transitionrun');
    screen.advance(900);
    expect(tuft.playState).toBe('finished');
    expect(loop.currentTime).toBe(0);
  });
});

// ---- Frames that do not come ----------------------------------------------------------------------

describe('a window that is offered no frames', () => {
  it('still moves time on, on a timer, so that what has an end reaches it', () => {
    const { screen, page, clock } = setUp();
    screen.stopFrames();
    const hop = page.add({ end: 620 });
    const callback = vi.fn();
    clock.request(callback);
    screen.advance(FALLBACK_MS * 4);
    expect(hop.playState).toBe('finished');
    expect(callback).toHaveBeenCalledTimes(1);
    expect(clock.stats.fallbacks).toBeGreaterThan(0);
    screen.advance(2000);
    expect(screen.pendingTimers()).toBe(0);
  });

  it('with no frames at all (no screen) it runs on timers alone, at the cap', () => {
    const screen = pretendScreen();
    const page = pretendDocument();
    const clock = new FrameClock({ timers: screen.timers, now: screen.now, requestFrame: null });
    clock.attach(page.doc);
    expect(clock.frameSource()).not.toBeNull();
    const walk = page.add();
    screen.advance(1100);
    expect(walk.writes.length).toBeGreaterThan(AMBIENT_FPS * 0.8);
    expect(walk.writes.length).toBeLessThanOrEqual(AMBIENT_FPS * 1.2 + 2);
  });
});

// ---- Frames for whatever moves things by script -----------------------------------------------------

describe('frames asked for by a view', () => {
  it('come at the capped rate, on the same tick as the animations', () => {
    const { screen, page, clock } = setUp();
    const walk = page.add();
    const order: string[] = [];
    let frames = 0;
    const loop = (): void => {
      frames++;
      order.push(`frame after ${walk.writes.length} writes`);
      clock.request(loop);
    };
    clock.request(loop);
    screen.advance(1020);
    expect(frames).toBeGreaterThanOrEqual(AMBIENT_FPS - 1);
    expect(frames).toBeLessThanOrEqual(AMBIENT_FPS + 2);
    // One write per frame: the callback and the animation share every tick, the animation first.
    expect(order.slice(0, 4)).toEqual(['frame after 1 writes', 'frame after 2 writes', 'frame after 3 writes', 'frame after 4 writes']);
  });

  it('a request is answered once, can be taken back, and keeps the clock awake only while there is one', () => {
    const { screen, clock } = setUp();
    const once = vi.fn();
    const never = vi.fn();
    clock.request(once);
    clock.request(never)();
    screen.advance(500);
    expect(once).toHaveBeenCalledTimes(1);
    expect(never).not.toHaveBeenCalled();
    expect(clock.stats.running).toBe(false);
    expect(screen.pendingTimers()).toBe(0);
  });

  it('a callback that throws does not stop the clock or the others', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { screen, page, clock } = setUp();
    const walk = page.add();
    const fine = vi.fn();
    clock.request(() => { throw new Error('boom'); });
    clock.request(fine);
    screen.advance(300);
    expect(fine).toHaveBeenCalledTimes(1);
    expect(walk.currentTime).toBeGreaterThan(200);
    quiet.mockRestore();
  });
});

// ---- Letting go -------------------------------------------------------------------------------------

describe('detaching', () => {
  it('hands every animation back to the browser and listens to nothing', () => {
    const { screen, page, clock, detach } = setUp();
    const walk = page.add();
    const breathe = page.add({ css: true });
    screen.advance(300);
    detach();
    expect(walk.calls).toEqual(['pause', 'play']);
    expect(breathe.calls).toEqual(['pause', 'play']);
    expect(page.listenerCount()).toBe(0);
    expect(clock.pacing).toBe(false);
    expect(screen.pendingTimers()).toBe(0);
    // A view still waiting for a frame gets the screen's next one.
    const callback = vi.fn();
    clock.request(callback);
    screen.advance(20);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('a frame asked for before detaching is still delivered', () => {
    const { screen, clock, detach } = setUp();
    const callback = vi.fn();
    clock.request(callback);
    detach();
    screen.advance(20);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});
