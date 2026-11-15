import { describe, expect, it, vi } from 'vitest';
import {
  HEARTBEAT_MS,
  REGION_NUDGE_MS,
  REGION_NUDGE_PX,
  compareRegions,
  createBrowserShell,
  createNativeShell,
  parseRadius,
  regionOf,
  type Bridge,
  type KeyValueStore,
  type PageHost,
  type Region,
  type WindowInfo,
} from '../src/shell';

// ---- Fakes ---------------------------------------------------------------------

interface Call {
  command: string;
  args: Record<string, unknown> | undefined;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/** A bridge whose calls stay pending until the test answers them. */
function fakeBridge() {
  const calls: Call[] = [];
  const listeners = new Map<string, Set<(payload: unknown) => void>>();
  const bridge: Bridge = {
    invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        calls.push({ command, args, resolve: resolve as (value: unknown) => void, reject });
      });
    },
    listen(event, handler) {
      const set = listeners.get(event) ?? new Set();
      set.add(handler);
      listeners.set(event, set);
      return () => set.delete(handler);
    },
  };
  return {
    bridge,
    calls,
    /** Calls to one command, in order. */
    of: (command: string) => calls.filter((c) => c.command === command),
    emit: (event: string, payload: unknown) => listeners.get(event)?.forEach((h) => h(payload)),
    listenerCount: (event: string) => listeners.get(event)?.size ?? 0,
  };
}

function fakeHost(width = 300, height = 200) {
  const size = { width, height };
  const resizeHandlers = new Set<() => void>();
  const visibleHandlers = new Set<() => void>();
  const intervals: { ms: number; handler: () => void }[] = [];
  const timeouts: (() => void)[] = [];
  const delays: number[] = [];
  let time = 0;
  const host: PageHost = {
    now: () => time,
    viewport: () => ({ ...size }),
    frame: () => Promise.resolve(),
    onResize(handler) {
      resizeHandlers.add(handler);
      return () => resizeHandlers.delete(handler);
    },
    onVisible(handler) {
      visibleHandlers.add(handler);
      return () => visibleHandlers.delete(handler);
    },
    every(ms, handler) {
      const entry = { ms, handler };
      intervals.push(entry);
      return () => void intervals.splice(intervals.indexOf(entry), 1);
    },
    after(ms, handler) {
      timeouts.push(handler);
      delays.push(ms);
      return () => {
        const i = timeouts.indexOf(handler);
        if (i >= 0) { timeouts.splice(i, 1); delays.splice(i, 1); }
      };
    },
  };
  return {
    host,
    intervals,
    /** Let time pass on the page's clock (nothing fires by itself). */
    pass(ms: number) { time += ms; },
    /** The delays of the timeouts that are waiting. */
    waiting: () => [...delays],
    resize(w: number, h: number) {
      size.width = w;
      size.height = h;
      resizeHandlers.forEach((handler) => handler());
    },
    fireTimeouts: () => { const due = [...timeouts]; timeouts.length = 0; delays.length = 0; due.forEach((handler) => handler()); },
    becomeVisible: () => visibleHandlers.forEach((handler) => handler()),
    pendingResizeHandlers: () => resizeHandlers.size,
  };
}

/** Let every already-queued microtask and promise reaction run. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const info = (cssWidth: number, cssHeight: number): WindowInfo => ({
  kind: 'floating',
  view: 'room',
  x: 10,
  y: 20,
  width: cssWidth * 1.5,
  height: cssHeight * 1.5,
  scale: 1.5,
  cssWidth,
  cssHeight,
  monitor: { full: { x: 0, y: 0, w: 3840, h: 2160 }, work: { x: 0, y: 0, w: 3840, h: 2088 }, scale: 1.5 },
  nativeMs: 1,
});

const A: Region = { x: 1, y: 2, w: 30, h: 40, r: 5 };
const B: Region = { x: 5, y: 6, w: 70, h: 80 };

// ---- regionOf --------------------------------------------------------------------

describe('regionOf', () => {
  const box = (left: number, top: number, width: number, height: number) => ({ getBoundingClientRect: () => ({ left, top, width, height }) });

  it('uses the border box', () => {
    expect(regionOf(box(10, 20, 100, 50))).toEqual({ x: 10, y: 20, w: 100, h: 50, r: 0 });
  });

  it('grows by the padding on every side, radius included', () => {
    expect(regionOf(box(10, 20, 100, 50), { pad: 4, radius: 10 })).toEqual({ x: 6, y: 16, w: 108, h: 58, r: 10 });
  });

  it('never reports a radius larger than half the shorter side', () => {
    expect(regionOf(box(0, 0, 214, 54), { radius: 999 }).r).toBe(27);
  });
});

describe('parseRadius', () => {
  it('reads pixels', () => expect(parseRadius('27px', 214, 54)).toBe(27));
  it('reads a percentage of the shorter side', () => expect(parseRadius('50%', 110, 96)).toBe(48));
  it('takes the first of an elliptical pair', () => expect(parseRadius('12px 20px', 100, 100)).toBe(12));
  it('treats anything else as square', () => {
    expect(parseRadius('0px', 10, 10)).toBe(0);
    expect(parseRadius('', 10, 10)).toBe(0);
    expect(parseRadius('auto', 10, 10)).toBe(0);
  });
});

// ---- What is worth telling the native side ----------------------------------------

describe('compareRegions', () => {
  const doozer: Region = { x: 100, y: 500, w: 78, h: 94, r: 36 };

  it('the same regions are the same', () => {
    expect(compareRegions([doozer], [{ ...doozer }], 0)).toBe('same');
    expect(compareRegions([doozer], [{ ...doozer }], 60_000)).toBe('same');
    expect(compareRegions([], [], 0)).toBe('same');
  });

  it('nothing sent yet, another number of regions, another shape: different', () => {
    expect(compareRegions([doozer], null, 0)).toBe('different');
    expect(compareRegions([doozer, A], [doozer], 0)).toBe('different');
    expect(compareRegions([], [doozer], 0)).toBe('different');
    expect(compareRegions([{ ...doozer, r: 0 }], [doozer], 0)).toBe('different');
    expect(compareRegions([{ ...doozer, w: doozer.w + REGION_NUDGE_PX + 1 }], [doozer], 0)).toBe('different');
  });

  it('a few pixels off is a nudge; further is different', () => {
    expect(compareRegions([{ ...doozer, x: doozer.x + 3 }], [doozer], 0)).toBe('nudged');
    expect(compareRegions([{ ...doozer, y: doozer.y - REGION_NUDGE_PX }], [doozer], 0)).toBe('nudged');
    expect(compareRegions([{ ...doozer, x: doozer.x + REGION_NUDGE_PX + 0.5 }], [doozer], 0)).toBe('different');
    expect(compareRegions([{ ...doozer, h: doozer.h - 2 }], [doozer], 0)).toBe('nudged');
  });

  it('a walk that goes as it was announced needs no further word, to its end and after', () => {
    // 30 px a second to the right for four seconds.
    const start: Region = { ...doozer, vx: 30, vy: 0, ms: 4000 };
    const at = (ms: number): Region => ({ ...doozer, x: doozer.x + (30 * ms) / 1000, vx: 30, vy: 0, ms: 4000 - ms });
    for (const ms of [0, 33, 1000, 2500, 3990]) expect(compareRegions([at(ms)], [start], ms), `${ms} ms in`).toBe('same');
    // Arrived: standing where the walk said it would end.
    const arrived: Region = { ...doozer, x: doozer.x + 120 };
    expect(compareRegions([arrived], [start], 4000)).toBe('same');
    expect(compareRegions([arrived], [start], 9000)).toBe('same');
  });

  it('a walk that is cut short, changes speed, turns round or is late has to be reported', () => {
    const start: Region = { ...doozer, vx: 30, vy: 0, ms: 4000 };
    // Stopped half-way: standing still where the native side thinks it is still walking.
    expect(compareRegions([{ ...doozer, x: doozer.x + 60 }], [start], 2000)).toBe('different');
    // A different speed, the other way.
    expect(compareRegions([{ ...doozer, x: doozer.x + 60, vx: 50, vy: 0, ms: 2000 }], [start], 2000)).toBe('different');
    expect(compareRegions([{ ...doozer, x: doozer.x + 60, vx: -30, vy: 0, ms: 2000 }], [start], 2000)).toBe('different');
    // Ends at another moment.
    expect(compareRegions([{ ...doozer, x: doozer.x + 60, vx: 30, vy: 0, ms: 3000 }], [start], 2000)).toBe('different');
    // The page's clock stalled for half a second: Doozer is 15 px behind where it was announced.
    expect(compareRegions([{ ...doozer, x: doozer.x + 45, vx: 30, vy: 0, ms: 2500 }], [start], 2000)).toBe('different');
    // Setting off from rest.
    expect(compareRegions([start], [doozer], 5000)).toBe('different');
  });

  it('a clock that is a hair out does not count as a change', () => {
    const start: Region = { ...doozer, vx: 150, vy: 0, ms: 2000 };
    // Eight milliseconds late at the fastest speed there is: 1.2 px.
    expect(compareRegions([{ ...doozer, x: doozer.x + 150 * 0.992, vx: 150, vy: 0, ms: 1008 }], [start], 1000)).toBe('same');
  });
});

// ---- Native shell ----------------------------------------------------------------

describe('native shell: hit regions', () => {
  it('merges calls made in the same turn and sends only the latest set', async () => {
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost().host);
    shell.setHitRegions([A]);
    shell.setHitRegions([A, B]);
    shell.setHitRegions([B]);
    await settle();
    const sent = b.of('set_hit_regions');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.args).toEqual({ regions: [{ ...B, r: 0 }] });
  });

  it('sends one set at a time, so an older set can never land after a newer one', async () => {
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost().host);
    shell.setHitRegions([A]);
    await settle();
    shell.setHitRegions([B]);
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(1); // the second is waiting for the first
    b.of('set_hit_regions')[0]?.resolve(1);
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(2);
    expect(b.of('set_hit_regions')[1]?.args).toEqual({ regions: [{ ...B, r: 0 }] });
  });

  it('keeps going after a failed send', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost().host);
    shell.setHitRegions([A]);
    await settle();
    b.of('set_hit_regions')[0]?.reject(new Error('boom'));
    await settle();
    shell.setHitRegions([B]);
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(2);
    quiet.mockRestore();
  });

  it('regionsFlushed waits for everything sent so far', async () => {
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost().host);
    shell.setHitRegions([A]);
    let flushed = false;
    void shell.regionsFlushed().then(() => {
      flushed = true;
    });
    await settle();
    expect(flushed).toBe(false);
    b.of('set_hit_regions')[0]?.resolve(1);
    await settle();
    expect(flushed).toBe(true);
  });
});

describe('native shell: only what is worth sending is sent', () => {
  const doozer: Region = { x: 100, y: 500, w: 78, h: 94, r: 36 };
  const sentRegions = (b: ReturnType<typeof fakeBridge>): unknown[] => b.of('set_hit_regions').map((call) => (call.args as { regions: unknown }).regions);
  /** Answer every send that is waiting, as the native side does. */
  const answer = async (b: ReturnType<typeof fakeBridge>): Promise<void> => {
    await settle();
    for (const call of b.of('set_hit_regions')) call.resolve(1);
    await settle();
  };

  it('the same regions again are not sent again', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    shell.setHitRegions([doozer]);
    await answer(b);
    for (let i = 0; i < 50; i++) {
      h.pass(33);
      shell.setHitRegions([{ ...doozer }]);
      await settle();
    }
    expect(b.of('set_hit_regions')).toHaveLength(1);
    expect(h.waiting()).toEqual([]);
  });

  it('a region standing still is sent exactly as before: no speed, no time', async () => {
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost().host);
    shell.setHitRegions([{ ...doozer, vx: 0, vy: 0, ms: 0 }, { ...A, vx: 30, ms: 0 }, { ...B, ms: 500 }]);
    await settle();
    expect(sentRegions(b)[0]).toEqual([doozer, A, { ...B, r: 0 }]);
  });

  it('a walk is sent once: where it starts, how fast it goes, how long it lasts', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    shell.setHitRegions([doozer]);
    await answer(b);
    // The view reports thirty times a second, as it always did.
    for (let ms = 0; ms < 4000; ms += 33) {
      shell.setHitRegions([{ ...doozer, x: doozer.x + (30 * ms) / 1000, vx: 30, vy: 0, ms: 4000 - ms }]);
      await answer(b);
      h.pass(33);
    }
    // Arrived, and standing there for a while.
    for (let i = 0; i < 30; i++) {
      shell.setHitRegions([{ ...doozer, x: doozer.x + 120 }]);
      await answer(b);
      h.pass(33);
    }
    expect(sentRegions(b)).toEqual([[doozer], [{ ...doozer, vx: 30, vy: 0, ms: 4000 }]]);
    expect(h.waiting()).toEqual([]);
  });

  it('a walk that is stopped half-way is reported at once', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    shell.setHitRegions([{ ...doozer, vx: 30, vy: 0, ms: 4000 }]);
    await answer(b);
    h.pass(1500);
    // Picked up, or the Card opened: Doozer stands where it had got to.
    const stopped = { ...doozer, x: doozer.x + 45 };
    shell.setHitRegions([stopped]);
    await settle();
    expect(sentRegions(b)).toHaveLength(2);
    expect(sentRegions(b)[1]).toEqual([stopped]);
  });

  it('a small drift waits its turn, and what is sent then is the latest', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    shell.setHitRegions([doozer]);
    await answer(b);
    // Floating down: an eased move, reported step by step.
    h.pass(20);
    shell.setHitRegions([{ ...doozer, y: doozer.y + 2 }]);
    await settle();
    h.pass(20);
    shell.setHitRegions([{ ...doozer, y: doozer.y + 4 }]);
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(1);
    // One timer, for what is left of the tenth of a second since the last send.
    expect(h.waiting()).toEqual([REGION_NUDGE_MS - 20]);
    h.pass(60);
    h.fireTimeouts();
    await settle();
    expect(sentRegions(b)).toHaveLength(2);
    expect(sentRegions(b)[1]).toEqual([{ ...doozer, y: doozer.y + 4 }]);
    expect(h.waiting()).toEqual([]);
  });

  it('a drift that has waited long enough is sent with the next report, without a timer', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    shell.setHitRegions([doozer]);
    await answer(b);
    h.pass(REGION_NUDGE_MS + 1);
    shell.setHitRegions([{ ...doozer, x: doozer.x + 3 }]);
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(2);
    expect(h.waiting()).toEqual([]);
  });

  it('a drift that drifts back needs no word at all', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    shell.setHitRegions([doozer]);
    await answer(b);
    h.pass(10);
    shell.setHitRegions([{ ...doozer, x: doozer.x + 3 }]);
    await settle();
    h.pass(10);
    shell.setHitRegions([doozer]);
    await settle();
    h.pass(200);
    h.fireTimeouts();
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(1);
  });

  it('anything bigger goes at once, even right after a send: a menu opening must not wait', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    shell.setHitRegions([doozer]);
    await answer(b);
    h.pass(1);
    shell.setHitRegions([doozer, A, B]);
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(2);
    h.pass(1);
    shell.setHitRegions([{ ...doozer, x: doozer.x + 200 }]);
    await answer(b);
    expect(b.of('set_hit_regions')).toHaveLength(3);
  });

  it('regionsFlushed sends what was waiting its turn', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    shell.setHitRegions([doozer]);
    await answer(b);
    h.pass(10);
    shell.setHitRegions([{ ...doozer, x: doozer.x + 3 }]);
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(1);
    let flushed = false;
    void shell.regionsFlushed().then(() => { flushed = true; });
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(2);
    expect(flushed).toBe(false);
    await answer(b);
    expect(flushed).toBe(true);
    expect(h.waiting()).toEqual([]);
  });

  it('after a failed send the same regions are sent again', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost().host);
    shell.setHitRegions([doozer]);
    await settle();
    b.of('set_hit_regions')[0]?.reject(new Error('boom'));
    await settle();
    shell.setHitRegions([{ ...doozer }]);
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(2);
    quiet.mockRestore();
  });

  it('after the window has changed the next report is sent whatever it is', async () => {
    const b = fakeBridge();
    const h = fakeHost(300, 200);
    const shell = createNativeShell(b.bridge, h.host);
    shell.setHitRegions([doozer]);
    await answer(b);
    const changing = shell.setWindowMode({ kind: 'floating', width: 300, height: 200 }, 'room');
    await settle();
    b.of('set_window_mode')[0]?.resolve(info(300, 200));
    await changing;
    // The native side dropped its regions with the old window. These are the same numbers, and must go.
    shell.setHitRegions([{ ...doozer }]);
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(2);
  });

  it('a drift waiting its turn is dropped when the window changes', async () => {
    const b = fakeBridge();
    const h = fakeHost(300, 200);
    const shell = createNativeShell(b.bridge, h.host);
    shell.setHitRegions([doozer]);
    await answer(b);
    h.pass(10);
    shell.setHitRegions([{ ...doozer, x: doozer.x + 3 }]);
    await settle();
    expect(h.waiting()).toHaveLength(1);
    const changing = shell.setWindowMode({ kind: 'floating', width: 300, height: 200 }, 'room');
    await settle();
    b.of('set_window_mode')[0]?.resolve(info(300, 200));
    await changing;
    h.fireTimeouts();
    await settle();
    // Nothing of the old layout arrives after the window has changed.
    expect(b.of('set_hit_regions')).toHaveLength(1);
  });
});

describe('native shell: heartbeat', () => {
  it('checks in at once and then on a timer', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    createNativeShell(b.bridge, h.host);
    expect(b.of('heartbeat')).toHaveLength(1);
    expect(h.intervals.map((i) => i.ms)).toEqual([HEARTBEAT_MS]);
    h.intervals[0]?.handler();
    expect(b.of('heartbeat')).toHaveLength(2);
  });

  it('sends the regions again when the native side says it dropped them', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    b.of('heartbeat')[0]?.resolve(false);
    shell.setHitRegions([A]);
    await settle();
    b.of('set_hit_regions')[0]?.resolve(1);
    await settle();

    h.intervals[0]?.handler();
    b.of('heartbeat')[1]?.resolve(true); // "I lost them"
    await settle();
    expect(b.of('set_hit_regions')).toHaveLength(2);
    expect(b.of('set_hit_regions')[1]?.args).toEqual({ regions: [A] });
  });

  it('checks in the moment the page becomes visible again, and after being shown', async () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    expect(b.of('heartbeat')).toHaveLength(1);
    h.becomeVisible();
    expect(b.of('heartbeat')).toHaveLength(2);

    void shell.setVisible(false);
    await settle();
    b.of('set_window_visible')[0]?.resolve(undefined);
    await settle();
    expect(b.of('heartbeat')).toHaveLength(2); // hiding does not need one
    void shell.setVisible(true);
    await settle();
    b.of('set_window_visible')[1]?.resolve(undefined);
    await settle();
    expect(b.of('heartbeat')).toHaveLength(3);
  });

  it('can be stopped and started (the watchdog test relies on this)', () => {
    const b = fakeBridge();
    const h = fakeHost();
    const shell = createNativeShell(b.bridge, h.host);
    shell.stopHeartbeat();
    expect(h.intervals).toHaveLength(0);
    shell.startHeartbeat();
    shell.startHeartbeat();
    expect(h.intervals).toHaveLength(1);
    expect(b.of('heartbeat')).toHaveLength(2);
  });
});

describe('native shell: setWindowMode', () => {
  it('resolves only when the page has reached its new size', async () => {
    const b = fakeBridge();
    const h = fakeHost(300, 200);
    const shell = createNativeShell(b.bridge, h.host);
    let done: WindowInfo | null = null;
    void shell.setWindowMode({ kind: 'floating', width: 380, height: 464 }, 'room').then((result) => {
      done = result;
    });
    await settle();
    const call = b.of('set_window_mode')[0];
    expect(call?.args).toEqual({ mode: { kind: 'floating', width: 380, height: 464 }, view: 'room' });
    call?.resolve(info(380, 464));
    await settle();
    expect(done).toBeNull(); // the native side is done, the page is not
    h.resize(350, 400); // an intermediate size
    await settle();
    expect(done).toBeNull();
    h.resize(380, 464);
    await settle();
    expect(done).not.toBeNull();
    expect(h.pendingResizeHandlers()).toBe(0);
  });

  it('resolves at once when the size does not change', async () => {
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost(380, 464).host);
    let done = false;
    void shell.setWindowMode({ kind: 'floating', width: 380, height: 464 }).then(() => {
      done = true;
    });
    await settle();
    expect(b.of('set_window_mode')[0]?.args?.view).toBeNull();
    b.of('set_window_mode')[0]?.resolve(info(380, 464));
    await settle();
    expect(done).toBe(true);
  });

  it('gives up waiting rather than hang if the page never reaches the size', async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const b = fakeBridge();
    const h = fakeHost(300, 200);
    const shell = createNativeShell(b.bridge, h.host);
    let done = false;
    void shell.setWindowMode({ kind: 'overlay' }).then(() => {
      done = true;
    });
    await settle();
    b.of('set_window_mode')[0]?.resolve(info(2560, 1392));
    await settle();
    expect(done).toBe(false);
    h.fireTimeouts();
    await settle();
    expect(done).toBe(true);
    expect(quiet).toHaveBeenCalled();
    quiet.mockRestore();
  });

  it('drops queued regions and lets a send in flight land before the window changes', async () => {
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost(380, 464).host);
    shell.setHitRegions([A]);
    await settle(); // A is in flight
    shell.setHitRegions([B]); // B is queued behind it
    void shell.setWindowMode({ kind: 'overlay' });
    await settle();
    expect(b.of('set_window_mode')).toHaveLength(0); // waiting for A to land
    b.of('set_hit_regions')[0]?.resolve(1);
    await settle();
    expect(b.of('set_window_mode')).toHaveLength(1);
    // B described the old layout and must never be sent.
    expect(b.of('set_hit_regions').every((c) => JSON.stringify(c.args) !== JSON.stringify({ regions: [{ ...B, r: 0 }] }))).toBe(true);
  });

  it('passes a native failure on to the caller', async () => {
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost().host);
    const result = shell.setWindowMode({ kind: 'overlay' });
    await settle();
    b.of('set_window_mode')[0]?.reject('no monitor found for the window');
    await expect(result).rejects.toBe('no monitor found for the window');
  });
});

describe('native shell: the rest', () => {
  it('maps each call to its command', async () => {
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost().host);
    void shell.beginDrag({ clientX: 12, clientY: 34 });
    void shell.setFocusable(true);
    void shell.setVisible(false);
    void shell.setAlwaysOnTop(false);
    void shell.save('{"a":1}');
    void shell.load();
    void shell.showMenu();
    void shell.quit();
    void shell.windowInfo();
    void shell.fullscreenInFront();
    void shell.setAvailableViews(['pill']);
    void shell.setAutostart(true);
    void shell.autostartEnabled();
    const sent = Object.fromEntries(b.calls.map((c) => [c.command, c.args]));
    expect(sent).toMatchObject({
      set_available_views: { views: ['pill'] },
      set_autostart: { enabled: true },
      begin_drag: { x: 12, y: 34 },
      set_focusable: { focusable: true },
      set_window_visible: { visible: false },
      set_always_on_top: { onTop: false },
      write_save: { json: '{"a":1}' },
    });
    expect(Object.keys(sent)).toEqual(expect.arrayContaining(['load_save', 'show_menu', 'quit', 'window_info', 'fullscreen_in_front', 'autostart_enabled']));
  });

  it('delivers events under their short names and can unsubscribe', () => {
    const b = fakeBridge();
    const shell = createNativeShell(b.bridge, fakeHost().host);
    const seen: string[] = [];
    const off = shell.on('view-requested', (view) => seen.push(view));
    b.emit('shell://view-requested', 'island');
    off();
    b.emit('shell://view-requested', 'room');
    expect(seen).toEqual(['island']);
    expect(b.listenerCount('shell://view-requested')).toBe(0);
  });

  it('reports itself as native', () => {
    expect(createNativeShell(fakeBridge().bridge, fakeHost().host).native).toBe(true);
  });
});

// ---- Browser stand-in --------------------------------------------------------------

describe('browser stand-in', () => {
  const memory = (): KeyValueStore & { map: Map<string, string> } => {
    const map = new Map<string, string>();
    return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
  };
  const make = (store = memory()) => ({ store, shell: createBrowserShell(store, () => ({ width: 800, height: 600 })) });

  it('starts with nothing saved', async () => {
    expect(await make().shell.load()).toEqual({ data: null, source: 'none', problem: null });
  });

  it('round-trips a save and keeps the previous one as a backup', async () => {
    const { shell, store } = make();
    await shell.save('{"n":1}');
    await shell.save('{"n":2}');
    expect(await shell.load()).toEqual({ data: '{"n":2}', source: 'main', problem: null });
    expect(store.map.get('doozer.save.bak')).toBe('{"n":1}');
  });

  it('refuses to save something that is not JSON', async () => {
    const { shell } = make();
    await shell.save('{"n":1}');
    await expect(shell.save('{"n":')).rejects.toThrow(/not valid JSON/);
    expect((await shell.load()).data).toBe('{"n":1}');
  });

  it('falls back to the backup when the main save is damaged', async () => {
    const { shell, store } = make();
    await shell.save('{"n":1}');
    await shell.save('{"n":2}');
    store.setItem('doozer.save', '{"n":');
    expect(await shell.load()).toMatchObject({ data: '{"n":1}', source: 'backup' });
  });

  it('never lets a damaged main save overwrite a good backup', async () => {
    const { shell, store } = make();
    await shell.save('{"n":1}');
    await shell.save('{"n":2}');
    store.setItem('doozer.save', 'garbage');
    await shell.save('{"n":3}');
    expect(store.map.get('doozer.save.bak')).toBe('{"n":1}');
  });

  it('answers window calls without a native side', async () => {
    const { shell } = make();
    expect(shell.native).toBe(false);
    const result = await shell.setWindowMode({ kind: 'overlay' }, 'desktop');
    expect(result).toMatchObject({ kind: 'overlay', view: 'desktop', cssWidth: 800, cssHeight: 600, scale: 1 });
    expect(await shell.windowInfo()).toEqual(result);
    expect(await shell.beginDrag({ clientX: 0, clientY: 0 })).toBe(false);
    expect(await shell.fullscreenInFront()).toBe(false);
    shell.setHitRegions([A]);
    await shell.regionsFlushed();
    shell.on('watchdog', () => undefined)();
  });
});
