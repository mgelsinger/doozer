import { describe, expect, it, vi } from 'vitest';
import {
  HEARTBEAT_MS,
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
  const host: PageHost = {
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
    after(_ms, handler) {
      timeouts.push(handler);
      return () => void timeouts.splice(timeouts.indexOf(handler), 1);
    },
  };
  return {
    host,
    intervals,
    resize(w: number, h: number) {
      size.width = w;
      size.height = h;
      resizeHandlers.forEach((handler) => handler());
    },
    fireTimeouts: () => [...timeouts].forEach((handler) => handler()),
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
    const sent = Object.fromEntries(b.calls.map((c) => [c.command, c.args]));
    expect(sent).toMatchObject({
      begin_drag: { x: 12, y: 34 },
      set_focusable: { focusable: true },
      set_window_visible: { visible: false },
      set_always_on_top: { onTop: false },
      write_save: { json: '{"a":1}' },
    });
    expect(Object.keys(sent)).toEqual(expect.arrayContaining(['load_save', 'show_menu', 'quit', 'window_info', 'fullscreen_in_front']));
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
