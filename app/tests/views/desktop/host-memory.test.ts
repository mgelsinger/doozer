// The small note a view may keep in the save (`ViewMemory` in src/host/view.ts): added to
// the host in Phase 9 so the Desktop view can remember Doozer's spot on each monitor.
// The host stores it and hands it back without looking inside.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrain } from '../../../src/core';
import { createHost } from '../../../src/host/host';
import { buildSave, freshHostData, parseSave } from '../../../src/host/store';
import type { View, ViewContext } from '../../../src/host/view';
import type { Shell, WindowInfo, WindowMode } from '../../../src/shell';
import type { ViewId } from '../../../src/core';
import { START, seeded } from '../../core/helpers';

function fakeShell() {
  const saves: string[] = [];
  const info = (mode: WindowMode, view: ViewId | null): WindowInfo => ({
    kind: mode.kind, view, x: 0, y: 0, width: 3840, height: 2088, scale: 1.5, cssWidth: 2560, cssHeight: 1392,
    monitor: { full: { x: 0, y: 0, w: 3840, h: 2160 }, work: { x: 0, y: 0, w: 3840, h: 2088 }, scale: 1.5 }, nativeMs: 0,
  });
  const shell = {
    native: true,
    setWindowMode: async (mode: WindowMode, view?: ViewId) => info(mode, view ?? null),
    windowInfo: async () => null,
    setHitRegions: () => undefined,
    regionsFlushed: async () => undefined,
    beginDrag: async () => false,
    setFocusable: async () => undefined,
    setVisible: async () => undefined,
    setAlwaysOnTop: async () => undefined,
    fullscreenInFront: async () => false,
    load: async () => ({ data: null, source: 'none', problem: null }),
    save: async (json: string) => void saves.push(json),
    showMenu: async () => undefined,
    setAvailableViews: async () => undefined,
    autostartEnabled: async () => false,
    setAutostart: async () => false,
    quit: async () => undefined,
    on: () => () => undefined,
  } as unknown as Shell;
  return { shell, saves };
}

/** A view that does nothing but hold on to the context it was mounted with. */
function noteView(id: ViewId) {
  const seen: { context: ViewContext | null } = { context: null };
  const view: View = {
    id,
    window: () => ({ kind: 'overlay' }),
    mount(_root, context) { seen.context = context; },
    unmount() { seen.context = null; },
    hitRegions: () => [],
  };
  return { view, seen };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
});
afterEach(() => vi.useRealTimers());

describe('a view\'s note in the save', () => {
  it('is absent from a fresh save and from one written before there were notes', () => {
    expect(freshHostData()).toEqual({ welcomedPet: null, positions: {} });
    const old = JSON.stringify({ app: 'doozer', v: 1, brain: { pet: {} }, host: { welcomedPet: 5, positions: {} } });
    expect(parseSave(old).host).toEqual({ welcomedPet: 5, positions: {} });
  });

  it('goes into the save and comes back out, per view, untouched', () => {
    const host = freshHostData();
    host.memory = { desktop: { v: 1, spots: { '3840x2160@0,0': { f: 0.4, t: 12 } } } };
    const read = parseSave(buildSave({ pet: {} }, host)).host;
    expect(read.memory).toEqual({ desktop: { v: 1, spots: { '3840x2160@0,0': { f: 0.4, t: 12 } } } });
    expect(read.positions).toEqual({});
  });

  it('drops notes filed under anything that is not a view, and survives nonsense', () => {
    const text = JSON.stringify({ app: 'doozer', v: 1, brain: { pet: {} }, host: { memory: { desktop: 7, garage: { x: 1 }, room: null } } });
    expect(parseSave(text).host.memory).toEqual({ desktop: 7 });
    for (const memory of [null, 5, 'x', [1, 2]]) {
      const odd = JSON.stringify({ app: 'doozer', v: 1, brain: { pet: {} }, host: { memory } });
      expect(parseSave(odd).host.memory).toBeUndefined();
    }
  });

  it('the host hands each view its own note, and writes the save soon after a view changes it', async () => {
    const { shell, saves } = fakeShell();
    const brain = createBrain({ now: () => Date.now(), random: seeded(3) });
    const hostData = freshHostData();
    hostData.memory = { desktop: { was: 'here' } };
    const pill = noteView('pill');
    const desktop = noteView('desktop');
    // The host only hides, shows and empties its root: no DOM is needed for that.
    const root = { style: { visibility: '' }, replaceChildren: () => undefined } as unknown as HTMLElement;
    const host = createHost({ root, shell, brain, views: [pill.view, desktop.view], hostData, frame: async () => undefined });
    await host.start();

    // The pill has no note yet.
    expect(pill.seen.context?.memory?.read()).toBeNull();
    await host.switchTo('desktop');
    expect(desktop.seen.context?.memory?.read()).toEqual({ was: 'here' });

    await vi.advanceTimersByTimeAsync(5000);
    const before = saves.length;
    desktop.seen.context?.memory?.write({ now: 'there' });
    expect(desktop.seen.context?.memory?.read()).toEqual({ now: 'there' });
    await vi.advanceTimersByTimeAsync(1500);
    expect(saves.length).toBe(before + 1);
    expect(parseSave(saves.at(-1) ?? null).host.memory).toEqual({ desktop: { now: 'there' } });

    // Another view's note is its own.
    await host.switchTo('pill');
    pill.seen.context?.memory?.write([1, 2, 3]);
    await host.flush();
    expect(parseSave(saves.at(-1) ?? null).host.memory).toEqual({ desktop: { now: 'there' }, pill: [1, 2, 3] });
    host.stop();
  });
});
