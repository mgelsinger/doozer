// @vitest-environment happy-dom
// The Island's 3D engine is loaded into a hidden frame so that it can be given back
// (src/views/island/engine.ts). These are about the fetching and the giving back: the
// frame is always removed, whatever goes wrong, and it cannot keep the view waiting.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DoozerModel } from '../../../src/character/doozer3d';
import { FRAME_LIMIT_MS, loadEngineInFrame } from '../../../src/views/island/engine';
import type { IslandEngine } from '../../../src/views/island/frame';

interface Made {
  frame: HTMLIFrameElement;
  /** The frame's page finished loading, with this on its window. */
  open(onWindow: Record<string, unknown> | null): void;
  fail(): void;
}

/**
 * The next frame the document makes is caught, so that the test can play the frame's page.
 * It is a plain element standing in for a frame: the test DOM's own frames try to load
 * their page, and there is none to load.
 */
function catchFrame(): () => Made {
  const real = document.createElement.bind(document);
  let made: Made | null = null;
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, options?: ElementCreationOptions) => {
    if (tag !== 'iframe') return real(tag, options);
    const frame = real('div') as unknown as HTMLIFrameElement;
    frame.dataset.standsFor = 'iframe';
    let inside: Record<string, unknown> | null = null;
    Object.defineProperty(frame, 'contentWindow', { get: () => inside });
    // The address is only kept, never fetched.
    Object.defineProperty(frame, 'src', { value: '', writable: true });
    made = {
      frame,
      open: (onWindow) => { inside = onWindow; frame.dispatchEvent(new Event('load')); },
      fail: () => { frame.dispatchEvent(new Event('error')); },
    };
    return frame;
  }) as typeof document.createElement);
  return () => {
    if (!made) throw new Error('no frame was made');
    return made;
  };
}

function fakeEngine(): { engine: IslandEngine; model: DoozerModel; disposed: () => number; asked: string[] } {
  let disposed = 0;
  const asked: string[] = [];
  const model = { template: {}, dispose: () => { disposed++; } } as unknown as DoozerModel;
  const engine = {
    stage: { marker: 'the stage module' },
    loadDoozerModel: async (url: string) => { asked.push(url); return model; },
  } as unknown as IslandEngine;
  return { engine, model, disposed: () => disposed, asked };
}

const options = { document, frameUrl: 'http://app.test/island-frame.html', modelUrl: 'http://app.test/assets/doozer.glb' };
const frames = (): number => document.querySelectorAll('[data-stands-for="iframe"]').length;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  document.body.replaceChildren();
});

describe('the engine in a frame of its own', () => {
  it('the frame is hidden, out of the way, and opened at the page it was given', async () => {
    const made = catchFrame();
    const fake = fakeEngine();
    const loading = loadEngineInFrame(options);
    const { frame } = made();
    expect(frame.isConnected).toBe(true);
    expect(frame.src).toBe(options.frameUrl);
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.tabIndex).toBe(-1);
    expect(frame.style.visibility).toBe('hidden');
    expect(frame.style.pointerEvents).toBe('none');
    made().open({ doozerIsland: Promise.resolve(fake.engine) });
    await loading;
  });

  it('hands over the stage and the model from the frame, and release removes the frame', async () => {
    const made = catchFrame();
    const fake = fakeEngine();
    const loading = loadEngineInFrame(options);
    made().open({ doozerIsland: Promise.resolve(fake.engine) });
    const loaded = await loading;
    expect(loaded.stage).toBe(fake.engine.stage);
    expect(loaded.model).toBe(fake.model);
    expect(fake.asked).toEqual([options.modelUrl]);
    expect(frames()).toBe(1);
    loaded.release?.();
    expect(frames()).toBe(0);
    // Giving it back twice does no harm.
    loaded.release?.();
    expect(frames()).toBe(0);
  });

  it('leaves no timer behind once the engine has arrived', async () => {
    vi.useFakeTimers();
    const made = catchFrame();
    const loading = loadEngineInFrame(options);
    expect(vi.getTimerCount()).toBe(1);
    made().open({ doozerIsland: Promise.resolve(fakeEngine().engine) });
    await loading;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a frame that fails to load is removed, and the loading fails', async () => {
    const made = catchFrame();
    const loading = loadEngineInFrame(options);
    made().fail();
    await expect(loading).rejects.toThrow('did not load');
    expect(frames()).toBe(0);
  });

  it('a frame with no engine in it is removed, and the loading fails', async () => {
    const made = catchFrame();
    const loading = loadEngineInFrame(options);
    made().open({});
    await expect(loading).rejects.toThrow('no engine');
    expect(frames()).toBe(0);
  });

  it('a frame with no window at all is removed, and the loading fails', async () => {
    const made = catchFrame();
    const loading = loadEngineInFrame(options);
    made().open(null);
    await expect(loading).rejects.toThrow('no engine');
    expect(frames()).toBe(0);
  });

  it('an engine that fails inside the frame: the frame is removed and the error is one of this page\'s', async () => {
    const made = catchFrame();
    const loading = loadEngineInFrame(options);
    // An error from another page's world is not an Error here.
    const failing = Promise.reject({ message: 'three.js would not start' });
    failing.catch(() => undefined);
    made().open({ doozerIsland: failing });
    const error = await loading.then(() => null, (e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('three.js would not start');
    expect(frames()).toBe(0);
  });

  it('a model that cannot be loaded: the frame is removed', async () => {
    const made = catchFrame();
    const fake = fakeEngine();
    fake.engine.loadDoozerModel = async () => { throw new Error('no model'); };
    const loading = loadEngineInFrame(options);
    made().open({ doozerIsland: Promise.resolve(fake.engine) });
    await expect(loading).rejects.toThrow('no model');
    expect(frames()).toBe(0);
  });

  it('a frame that never loads cannot keep the view waiting: it is removed at the limit', async () => {
    vi.useFakeTimers();
    catchFrame();
    const loading = loadEngineInFrame(options);
    const outcome = loading.then(() => 'loaded', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(FRAME_LIMIT_MS - 1);
    expect(frames()).toBe(1);
    await vi.advanceTimersByTimeAsync(2);
    expect(await outcome).toContain('too long');
    expect(frames()).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an engine that turns up after the limit is thrown away: its model is disposed of', async () => {
    vi.useFakeTimers();
    const made = catchFrame();
    const fake = fakeEngine();
    let arrive!: (model: DoozerModel) => void;
    fake.engine.loadDoozerModel = () => new Promise<DoozerModel>((resolve) => { arrive = resolve; });
    const loading = loadEngineInFrame({ ...options, limitMs: 500 });
    const outcome = loading.then(() => 'loaded', (e: Error) => e.message);
    made().open({ doozerIsland: Promise.resolve(fake.engine) });
    await vi.advanceTimersByTimeAsync(600);
    expect(await outcome).toContain('too long');
    expect(frames()).toBe(0);
    arrive(fake.model);
    await vi.advanceTimersByTimeAsync(10);
    expect(fake.disposed()).toBe(1);
  });

  it('the limit is well inside the view\'s own, so there is time left to load into the page instead', async () => {
    const { LOAD_LIMIT_MS } = await import('../../../src/views/island');
    expect(FRAME_LIMIT_MS).toBeLessThanOrEqual(LOAD_LIMIT_MS / 2);
  });
});
