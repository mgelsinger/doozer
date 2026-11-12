// "A temporary expression must always return to the mood expression", and everything
// around it: flashes, one-shot performances, interruptions, rapid calls, teardown.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExpressionState, FLASH_MAX_MS, type Look } from './expression-state';
import { EXPRESSIONS, EXPRESSION_NAMES } from './expressions';
import { PERFORMANCES, PERFORMANCE_NAMES } from './performances';

function setup(options: { reduceMotion?: boolean; failingBody?: boolean } = {}) {
  const looks: Look[] = [];
  const body = { started: [] as string[], stopped: [] as string[] };
  const state = new ExpressionState({
    apply: (look) => { looks.push(look); },
    startPerformance(name) {
      if (options.failingBody) throw new Error('no animations here');
      body.started.push(name);
      return () => { body.stopped.push(name); };
    },
  }, { reduceMotion: options.reduceMotion });
  const last = () => looks[looks.length - 1];
  return { state, looks, body, last };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('mood', () => {
  it('starts content and shows whatever mood is set', () => {
    const { state, last } = setup();
    expect(state.mood).toBe('content');
    state.setMood('hungry');
    expect(state.showing).toBe('hungry');
    expect(last()?.eyes).toBe(EXPRESSIONS.hungry.eyes);
    expect(last()?.pose).toBe('sulk');
  });

  it('every expression resolves to a complete look', () => {
    const { state } = setup();
    for (const name of EXPRESSION_NAMES) {
      state.setMood(name);
      const look = state.look();
      expect(look.expression).toBe(name);
      expect(look.eyes).toBeTruthy();
      expect(look.mouth).toBeTruthy();
      expect(look.pose).toBeTruthy();
    }
  });
});

describe('flash', () => {
  it('returns to the mood when its time is up', () => {
    const { state } = setup();
    state.setMood('meh');
    state.flash('love', 1000);
    expect(state.showing).toBe('love');
    expect(state.busy).toBe(true);
    vi.advanceTimersByTime(999);
    expect(state.showing).toBe('love');
    vi.advanceTimersByTime(1);
    expect(state.showing).toBe('meh');
    expect(state.busy).toBe(false);
  });

  it('returns to the mood that was set while it was showing', () => {
    const { state } = setup();
    state.flash('eat', 500);
    state.setMood('joyful');
    expect(state.showing).toBe('eat');
    vi.advanceTimersByTime(500);
    expect(state.showing).toBe('joyful');
  });

  it('a newer flash replaces an older one, and the old timer cannot end it early', () => {
    const { state } = setup();
    state.flash('wow', 300);
    vi.advanceTimersByTime(250);
    state.flash('love', 1000);
    vi.advanceTimersByTime(100);       // the first flash's time is now past
    expect(state.showing).toBe('love');
    vi.advanceTimersByTime(900);
    expect(state.showing).toBe('content');
  });

  it('always ends, whatever length it is asked for', () => {
    for (const ms of [Infinity, Number.NaN, -5, 0, 1e12]) {
      const { state } = setup();
      state.flash('cheer', ms);
      vi.advanceTimersByTime(FLASH_MAX_MS);
      expect(state.busy).toBe(false);
      expect(state.showing).toBe('content');
    }
  });

  it('ignores a name that is not an expression', () => {
    const { state } = setup();
    state.flash('grumpy' as never);
    expect(state.busy).toBe(false);
  });
});

describe('pose override', () => {
  it('holds a pose over the mood pose and releases it', () => {
    const { state } = setup();
    state.setMood('hungry');
    state.setPose('walk');
    expect(state.pose).toBe('walk');
    expect(state.showing).toBe('hungry');
    state.setPose(null);
    expect(state.pose).toBe('sulk');
  });

  it('can carry a face that lasts exactly as long as the pose', () => {
    const { state } = setup();
    state.setPose('carried', 'wow');
    expect(state.showing).toBe('wow');
    state.flash('love', 200);
    expect(state.showing).toBe('love');
    expect(state.pose).toBe('carried');
    vi.advanceTimersByTime(200);
    expect(state.showing).toBe('wow');
    state.setPose(null);
    expect(state.showing).toBe('content');
  });
});

describe('performances', () => {
  it('shows its faces in order, ends on time, and hands back to the mood', async () => {
    const { state, body } = setup();
    state.setMood('asleep');
    const done = state.perform('fall-asleep');
    expect(state.performing).toBe('fall-asleep');
    expect(state.showing).toBe('sleepy');
    expect(state.pose).toBe('none');
    vi.advanceTimersByTime(520);
    expect(state.showing).toBe('yawn');
    vi.advanceTimersByTime(760);
    expect(state.showing).toBe('asleep');
    vi.advanceTimersByTime(PERFORMANCES['fall-asleep'].duration);
    await expect(done).resolves.toBe('finished');
    expect(state.performing).toBeNull();
    expect(state.pose).toBe('sleep');
    expect(body.started).toEqual(['fall-asleep']);
    expect(body.stopped).toEqual(['fall-asleep']);
  });

  it('every performance ends by itself and stops its animation exactly once', async () => {
    for (const name of PERFORMANCE_NAMES) {
      const { state, body } = setup();
      state.setMood('bored');
      const done = state.perform(name);
      vi.advanceTimersByTime(PERFORMANCES[name].duration);
      await expect(done).resolves.toBe('finished');
      expect(state.busy).toBe(false);
      expect(state.showing).toBe('bored');
      expect(body.stopped).toEqual([name]);
    }
  });

  it('is interrupted cleanly by a flash: no late faces, animation stopped once', async () => {
    const { state, body } = setup();
    const done = state.perform('wake');
    vi.advanceTimersByTime(100);
    state.flash('love', 400);
    await expect(done).resolves.toBe('interrupted');
    expect(body.stopped).toEqual(['wake']);
    vi.advanceTimersByTime(300);        // wake's "yawn" cue would have fired by now
    expect(state.showing).toBe('love');
    vi.advanceTimersByTime(5000);
    expect(state.showing).toBe('content');
    expect(body.stopped).toEqual(['wake']);
  });

  it('is interrupted by another performance', async () => {
    const { state, body } = setup();
    const first = state.perform('celebrate');
    const second = state.perform('yawn');
    await expect(first).resolves.toBe('interrupted');
    expect(state.performing).toBe('yawn');
    vi.advanceTimersByTime(PERFORMANCES.yawn.duration);
    await expect(second).resolves.toBe('finished');
    expect(body.started).toEqual(['celebrate', 'yawn']);
    expect(body.stopped).toEqual(['celebrate', 'yawn']);
  });

  it('stop() ends it now', async () => {
    const { state } = setup();
    state.setMood('joyful');
    const done = state.perform('celebrate');
    state.stop();
    await expect(done).resolves.toBe('interrupted');
    expect(state.showing).toBe('joyful');
    expect(state.busy).toBe(false);
  });

  it('still ends when the animation layer throws', async () => {
    const { state } = setup({ failingBody: true });
    const done = state.perform('celebrate');
    vi.advanceTimersByTime(PERFORMANCES.celebrate.duration);
    await expect(done).resolves.toBe('finished');
    expect(state.busy).toBe(false);
  });

  it('with motion reduced: pure movement is over at once, faces still play, nothing animates', async () => {
    const { state, body } = setup({ reduceMotion: true });
    await expect(state.perform('hop')).resolves.toBe('finished');
    expect(state.busy).toBe(false);
    const done = state.perform('yawn');
    vi.advanceTimersByTime(200);
    expect(state.showing).toBe('yawn');
    vi.advanceTimersByTime(PERFORMANCES.yawn.duration);
    await expect(done).resolves.toBe('finished');
    expect(body.started).toEqual([]);
  });

  it('refuses an unknown name without getting stuck', async () => {
    const { state } = setup();
    await expect(state.perform('moonwalk' as never)).resolves.toBe('interrupted');
    expect(state.busy).toBe(false);
  });
});

describe('rapid, repeated and late calls', () => {
  it('a storm of flashes and performances always settles on the mood', async () => {
    const { state, body } = setup();
    state.setMood('content');
    let seed = 7;
    const random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const pending: Promise<unknown>[] = [];
    for (let i = 0; i < 400; i++) {
      const roll = random();
      if (roll < 0.4) state.flash(EXPRESSION_NAMES[Math.floor(random() * EXPRESSION_NAMES.length)] ?? 'wow', random() * 800);
      else if (roll < 0.8) pending.push(state.perform(PERFORMANCE_NAMES[Math.floor(random() * PERFORMANCE_NAMES.length)] ?? 'hop'));
      else if (roll < 0.9) state.stop();
      else state.setMood(random() < 0.5 ? 'content' : 'hungry');
      vi.advanceTimersByTime(Math.floor(random() * 120));
    }
    state.setMood('meh');
    vi.advanceTimersByTime(10_000);
    await Promise.all(pending);          // every promise settled
    expect(state.busy).toBe(false);
    expect(state.showing).toBe('meh');
    expect(body.stopped.length).toBe(body.started.length);
    expect(vi.getTimerCount()).toBe(0);  // and no timer left behind
  });

  it('destroy ends everything and nothing is drawn afterwards', async () => {
    const { state, looks, body } = setup();
    const done = state.perform('celebrate');
    state.destroy();
    await expect(done).resolves.toBe('interrupted');
    expect(body.stopped).toEqual(['celebrate']);
    const drawn = looks.length;
    state.setMood('joyful');
    state.flash('love');
    await expect(state.perform('hop')).resolves.toBe('interrupted');
    vi.advanceTimersByTime(10_000);
    expect(looks.length).toBe(drawn);
    expect(vi.getTimerCount()).toBe(0);
    state.destroy();                     // twice is fine
  });
});
