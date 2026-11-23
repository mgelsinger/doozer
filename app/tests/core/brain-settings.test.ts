import { describe, expect, it } from 'vitest';
import type { Settings } from '../../src/core';
import { of, rig } from './helpers';

describe('settings', () => {
  it('start at the defaults in the spec', () => {
    expect(rig().brain.settings).toEqual({
      palette: 'peach',
      size: { pill: 'medium', room: 'medium', island: 'medium', desktop: 'medium' },
      pillDock: 'top-center',
      desktopActivity: 'calm',
      sound: false,
      soundAsked: false,
      onFocusEnd: 'quiet',
      alwaysOnTop: true,
      tuckAwayInFullscreen: true,
      startWithWindows: false,
      reduceMotion: 'system',
      uiScale: 'normal',
      frameRate: 'light',
      hat: null,
      lastView: 'pill',
    } satisfies Settings);
  });

  it('change one at a time and say which one changed', () => {
    const r = rig();
    r.brain.setSetting('palette', 'lavender');
    r.brain.setSetting('desktopActivity', 'lively');
    r.brain.setSetting('sound', true);
    r.brain.setSetting('lastView', 'island');
    expect(r.brain.settings).toMatchObject({ palette: 'lavender', desktopActivity: 'lively', sound: true, lastView: 'island' });
    expect(of(r.events, 'settings')).toEqual([{ key: 'palette' }, { key: 'desktopActivity' }, { key: 'sound' }, { key: 'lastView' }]);
  });

  it('accept every value the spec lists', () => {
    const r = rig();
    const all: { [K in keyof Settings]: Settings[K][] } = {
      palette: ['mint', 'lavender', 'butter', 'sky', 'peach'],
      size: [{ pill: 'small', room: 'large', island: 'small', desktop: 'large' }],
      pillDock: ['top-left', 'top-right', 'bottom-right', 'top-center'],
      desktopActivity: ['still', 'lively', 'calm'],
      sound: [true, false],
      soundAsked: [true],
      onFocusEnd: ['open-card', 'quiet'],
      alwaysOnTop: [false, true],
      tuckAwayInFullscreen: [false, true],
      startWithWindows: [true, false],
      reduceMotion: ['on', 'off', 'system'],
      uiScale: ['large', 'larger', 'normal'],
      frameRate: ['30', '60', '120', '144', 'light'],
      hat: ['nightcap', 'bow', null],
      lastView: ['room', 'island', 'desktop', 'pill'],
    };
    const set = <K extends keyof Settings>(key: K, value: Settings[K]): void => {
      r.brain.setSetting(key, value);
      expect(r.brain.settings[key]).toEqual(value);
    };
    for (const key of Object.keys(all) as (keyof Settings)[]) {
      for (const value of all[key]) set(key, value);
    }
  });

  it('do not count as a change of state', () => {
    const r = rig();
    const before = r.brain.state;
    r.brain.setSetting('palette', 'sky');
    expect(of(r.events, 'change')).toHaveLength(0);
    expect(r.brain.state).toBe(before);
  });

  it('say nothing when set to the value they already have', () => {
    const r = rig();
    r.brain.setSetting('palette', 'peach');
    r.brain.setSetting('size', { pill: 'medium', room: 'medium', island: 'medium', desktop: 'medium' });
    expect(r.events).toHaveLength(0);
  });

  it('ignore values they cannot take and keys that do not exist', () => {
    const r = rig();
    const loose = r.brain.setSetting as (key: string, value: unknown) => void;
    loose('palette', 'neon');
    loose('sound', 'loud');
    loose('size', { pill: 'small' });
    loose('size', 'large');
    loose('hat', 'crown');
    loose('volume', 11);
    loose('toString', 'x');
    loose('__proto__', {});
    expect(r.events).toHaveLength(0);
    expect(r.brain.settings.palette).toBe('peach');
    expect(r.brain.settings.size.pill).toBe('medium');
    expect('volume' in r.brain.settings).toBe(false);
  });

  it('hand out a frozen snapshot that is replaced, not edited', () => {
    const r = rig();
    const before = r.brain.settings;
    expect(Object.isFrozen(before)).toBe(true);
    expect(Object.isFrozen(before.size)).toBe(true);
    r.brain.setSetting('sound', true);
    expect(r.brain.settings).not.toBe(before);
    expect(before.sound).toBe(false);
  });

  it('do not keep a reference to an object passed in', () => {
    const r = rig();
    const size: Settings['size'] = { pill: 'small', room: 'small', island: 'small', desktop: 'small' };
    r.brain.setSetting('size', size);
    size.pill = 'large';
    expect(r.brain.settings.size.pill).toBe('small');
  });

  it('survive a restart', () => {
    const r = rig();
    r.brain.setSetting('palette', 'butter');
    r.brain.setSetting('pillDock', 'bottom-right');
    r.brain.setSetting('soundAsked', true);
    r.brain.setSetting('reduceMotion', 'on');
    r.brain.setSetting('lastView', 'room');
    r.brain.setSetting('size', { pill: 'large', room: 'small', island: 'medium', desktop: 'medium' });
    const later = r.restart();
    expect(later.brain.settings).toEqual(r.brain.settings);
  });

  it('fire change as well when the hat setting alters what Doozer is wearing', () => {
    const r = rig();
    for (let i = 0; i < 60; i++) {
      r.brain.startFocus();
      r.debug.finishFocusNow();
    }
    r.clear();
    r.brain.setSetting('hat', 'bow');
    expect(r.events.map((e) => e.type)).toEqual(['settings', 'change']);
    expect(r.brain.state.wearing).toBe('bow');
  });
});
