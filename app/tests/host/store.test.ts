import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildSave, createSaver, freshHostData, parseSave } from '../../src/host/store';
import { createBrain } from '../../src/core';

describe('the save document', () => {
  it('round-trips the brain and the host side by side', () => {
    const brain = createBrain();
    const host = { welcomedPet: brain.state.bornAt, positions: { room: { x: 120, y: 340 } } };
    const parsed = parseSave(buildSave(brain.serialize(), host));
    expect(parsed.host).toEqual(host);
    expect(parsed.brain).toEqual(brain.serialize());
    // The brain reads its own part back as the same pet.
    expect(createBrain({ save: parsed.brain }).state.bornAt).toBe(brain.state.bornAt);
  });

  it('gives a fresh start for no file, bad JSON and things that are not a save', () => {
    for (const text of [null, '', 'not json', '42', '[]', '{"hello":1}']) {
      const parsed = parseSave(text);
      expect(parsed.brain).toBeUndefined();
      expect(parsed.host).toEqual(freshHostData());
    }
  });

  it('keeps a bare brain save (no wrapper) as a pet', () => {
    const brain = createBrain();
    const parsed = parseSave(JSON.stringify(brain.serialize()));
    expect(parsed.brain).toEqual(brain.serialize());
    expect(parsed.host).toEqual(freshHostData());
  });

  it('keeps the good parts of a damaged host section', () => {
    const text = JSON.stringify({
      app: 'doozer', v: 1, brain: { v: 2, pet: {} },
      host: { welcomedPet: 'yesterday', positions: { room: { x: 10.4, y: 20.6 }, island: { x: 'left', y: 3 }, attic: { x: 1, y: 2 }, desktop: null } },
    });
    expect(parseSave(text).host).toEqual({ welcomedPet: null, positions: { room: { x: 10, y: 21 } } });
  });
});

describe('the saver', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  function make(overrides: Partial<Parameters<typeof createSaver>[0]> = {}) {
    let version = 0;
    const written: string[] = [];
    const errors: unknown[] = [];
    const saver = createSaver({
      build: () => `{"n":${++version}}`,
      write: async (json) => void written.push(json),
      soonMs: 1000,
      lazyMs: 60_000,
      retryMs: 30_000,
      onError: (error) => void errors.push(error),
      ...overrides,
    });
    return { saver, written, errors };
  }

  it('writes soon after something happens, once for a burst', async () => {
    const { saver, written } = make();
    saver.touch('soon');
    saver.touch('soon');
    await vi.advanceTimersByTimeAsync(999);
    expect(written).toEqual([]);
    saver.touch('soon');
    await vi.advanceTimersByTimeAsync(1);
    expect(written).toEqual(['{"n":1}']);
    expect(saver.dirty).toBe(false);
  });

  it('lets time merely passing wait, but not for ever', async () => {
    const { saver, written } = make();
    saver.touch('lazy');
    await vi.advanceTimersByTimeAsync(30_000);
    saver.touch('lazy'); // more of the same does not push it back
    await vi.advanceTimersByTimeAsync(29_999);
    expect(written).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(written).toHaveLength(1);
  });

  it('brings a lazy write forward when something happens', async () => {
    const { saver, written } = make();
    saver.touch('lazy');
    saver.touch('soon');
    await vi.advanceTimersByTimeAsync(1000);
    expect(written).toHaveLength(1);
    // ...and a lazy touch never pushes a soon one back.
    saver.touch('soon');
    saver.touch('lazy');
    await vi.advanceTimersByTimeAsync(1000);
    expect(written).toHaveLength(2);
  });

  it('flush writes at once, and only if there is something to write', async () => {
    const { saver, written } = make();
    await saver.flush();
    expect(written).toEqual([]);
    saver.touch('lazy');
    await saver.flush();
    expect(written).toEqual(['{"n":1}']);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(written).toHaveLength(1);
  });

  it('writes one at a time, and writes again if something changed meanwhile', async () => {
    const pending: (() => void)[] = [];
    const written: string[] = [];
    const { saver } = make({
      write: (json) => new Promise<void>((resolve) => { pending.push(() => { written.push(json); resolve(); }); }),
    });
    saver.touch('soon');
    await vi.advanceTimersByTimeAsync(1000);
    expect(pending).toHaveLength(1);
    saver.touch('soon'); // while the first write is in flight
    await vi.advanceTimersByTimeAsync(5000);
    expect(pending).toHaveLength(1);
    pending[0]?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(pending).toHaveLength(2);
    pending[1]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual(['{"n":1}', '{"n":2}']);
    expect(saver.dirty).toBe(false);
  });

  it('flush during a write waits for it and then writes the newer state', async () => {
    const pending: (() => void)[] = [];
    const written: string[] = [];
    const { saver } = make({
      write: (json) => new Promise<void>((resolve) => { pending.push(() => { written.push(json); resolve(); }); }),
    });
    saver.touch('soon');
    await vi.advanceTimersByTimeAsync(1000);
    saver.touch('soon');
    let flushed = false;
    void saver.flush().then(() => { flushed = true; });
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(false);
    pending[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    pending[1]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toBe(true);
    expect(written).toEqual(['{"n":1}', '{"n":2}']);
  });

  it('stays dirty after a failed write and tries again later, without hammering', async () => {
    let fail = true;
    const written: string[] = [];
    const { saver, errors } = make({
      write: async (json) => {
        if (fail) throw new Error('disk full');
        written.push(json);
      },
    });
    saver.touch('soon');
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toHaveLength(1);
    expect(saver.dirty).toBe(true);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(errors).toHaveLength(1);
    fail = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(written).toHaveLength(1);
    expect(saver.dirty).toBe(false);
  });

  it('does nothing after dispose', async () => {
    const { saver, written } = make();
    saver.touch('soon');
    saver.dispose();
    saver.touch('soon');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(written).toEqual([]);
  });
});
