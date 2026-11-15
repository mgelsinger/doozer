// Small pure pieces of the kit: need levels, the clock, reduce-motion, icons, and the
// rule that the kit never reaches into a view or the shell.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { FoodId, UnlockId } from '../core/contract';
import { clockText, formatClock, quietClock, quietRemaining } from './format';
import { ICONS, ITEM_NAME, VIEW_ICON } from './icons';
import { resolveReduceMotion } from './motion';
import { NEED_ART, NEED_KEYS, needLevel, needText, needTone } from './needs';
import { FAKE_LIMITS } from './dev/fake-brain';

describe('need levels', () => {
  it('uses the brain thresholds: below 30 is low, below 12 is urgent', () => {
    expect(needLevel(100, FAKE_LIMITS)).toBe('ok');
    expect(needLevel(30, FAKE_LIMITS)).toBe('ok');
    expect(needLevel(29.9, FAKE_LIMITS)).toBe('low');
    expect(needLevel(12, FAKE_LIMITS)).toBe('low');
    expect(needLevel(11.9, FAKE_LIMITS)).toBe('urgent');
    expect(needLevel(-5, FAKE_LIMITS)).toBe('urgent');
    expect(needLevel(Number.NaN, FAKE_LIMITS)).toBe('urgent');
  });

  it('colour steps green, yellow, amber, red as a need falls', () => {
    expect([100, 60, 59, 30, 29, 12, 11, 0].map((v) => needTone(v, FAKE_LIMITS)))
      .toEqual(['good', 'good', 'fair', 'fair', 'low', 'low', 'urgent', 'urgent']);
  });

  it('says the level in words, so colour is never the only signal', () => {
    expect(needText('tummy', 64.4, FAKE_LIMITS)).toBe('Tummy 64%');
    expect(needText('fun', 23, FAKE_LIMITS)).toBe('Fun 23%, low');
    expect(needText('clean', 3, FAKE_LIMITS)).toBe('Clean 3%, urgent');
  });

  it('every need has a label and an icon', () => {
    for (const key of NEED_KEYS) {
      expect(NEED_ART[key].label).toBeTruthy();
      expect(ICONS[NEED_ART[key].icon]).toContain('<svg');
    }
  });
});

describe('the clock', () => {
  it('formats minutes and seconds, rounding up so it never shows 00:00 early', () => {
    expect(formatClock(25 * 60_000)).toBe('25:00');
    expect(formatClock(50 * 60_000)).toBe('50:00');
    expect(formatClock(59_001)).toBe('01:00');
    expect(formatClock(1)).toBe('00:01');
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(-100)).toBe('00:00');
    expect(formatClock(Number.NaN)).toBe('00:00');
  });

  it('has a spoken form', () => {
    expect(clockText(25 * 60_000)).toBe('25 minutes left');
    expect(clockText(61_000)).toBe('1 minute 1 second left');
    expect(clockText(30_000)).toBe('30 seconds left');
  });

  it('for nobody it counts in whole minutes, rounded up, and in seconds for the last minute', () => {
    expect(quietClock(25 * 60_000)).toBe('25 min');
    expect(quietClock(25 * 60_000 - 1)).toBe('25 min');
    expect(quietClock(24 * 60_000 + 1)).toBe('25 min');
    expect(quietClock(24 * 60_000)).toBe('24 min');
    // It never says less than is left.
    expect(quietClock(61_000)).toBe('2 min');
    expect(quietClock(60_001)).toBe('2 min');
    // The last minute, to the second, as the precise clock has it.
    expect(quietClock(60_000)).toBe('01:00');
    expect(quietClock(42_000)).toBe('00:42');
    expect(quietClock(1)).toBe('00:01');
    expect(quietClock(0)).toBe('00:00');
    expect(quietClock(Number.NaN)).toBe('00:00');
  });

  it('changes once a minute over a whole session, until the last minute', () => {
    let changes = 0;
    let shown = quietClock(25 * 60_000);
    for (let ms = 25 * 60_000; ms > 60_000; ms -= 1000) {
      const text = quietClock(ms);
      if (text !== shown) { changes++; shown = text; }
    }
    // "25 min" down to "2 min": twenty-four readings, twenty-three changes in twenty-four minutes.
    expect(changes).toBe(23);
    // What is drawn for nobody (the room's kitchen timer) steps the same way.
    expect(quietRemaining(24 * 60_000 + 1)).toBe(25 * 60_000);
    expect(quietRemaining(24 * 60_000)).toBe(24 * 60_000);
    expect(quietRemaining(42_500)).toBe(42_500);
  });
});

describe('reduce motion', () => {
  it('follows the system unless the setting says otherwise', () => {
    expect(resolveReduceMotion('system', true)).toBe(true);
    expect(resolveReduceMotion('system', false)).toBe(false);
    expect(resolveReduceMotion('on', false)).toBe(true);
    expect(resolveReduceMotion('off', true)).toBe(false);
  });
});

describe('icons', () => {
  it('every food, toy and hat has an icon and a name', () => {
    const items: (FoodId | UnlockId)[] = ['apple', 'bread', 'carrot', 'biscuit', 'cookie', 'donut', 'strawberry', 'onigiri', 'ball', 'yarn', 'duck', 'nightcap', 'bow'];
    for (const id of items) {
      expect(ICONS[id], id).toContain('<svg');
      expect(ITEM_NAME[id], id).toBeTruthy();
    }
  });

  it('every view and every emote has an icon', () => {
    for (const name of Object.values(VIEW_ICON)) expect(ICONS[name]).toContain('<svg');
    for (const name of ['heart', 'sparkle', 'z', 'question', 'bubble'] as const) expect(ICONS[name]).toContain('<svg');
  });

  it('icons are decorative: hidden from assistive tech, never focusable', () => {
    for (const [name, markup] of Object.entries(ICONS)) {
      expect(markup, name).toContain('aria-hidden="true"');
      expect(markup, name).toContain('focusable="false"');
    }
  });
});

describe('boundaries', () => {
  // The kit talks to the pet through core/contract.ts and to the rest through callbacks.
  const here = fileURLToPath(new URL('.', import.meta.url));
  const sources = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? sources(`${dir}/${entry.name}`) : /\.(ts|css)$/.test(entry.name) ? [`${dir}/${entry.name}`] : []);
  const files = [...sources(here.replace(/[\\/]$/, '')), ...sources(fileURLToPath(new URL('../character', import.meta.url)))];
  const importsOf = (file: string) => [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'|import\s+'([^']+)'/g)].map((m) => m[1] ?? m[2] ?? '');

  it('nothing in ui/ or character/ imports from views/ or shell', () => {
    for (const file of files) {
      for (const target of importsOf(file)) {
        expect(target, file).not.toMatch(/(^|\/)views(\/|$)|(^|\/)shell(\.ts)?$|src-tauri|@tauri-apps/);
      }
    }
  });

  it('the only thing the kit and the rig take from core/ is the contract', () => {
    for (const file of files) {
      // Tests and the dev viewer may use the real brain; the kit itself may not.
      if (/[\/]dev[\/]|\.test\.ts$/.test(file)) continue;
      for (const target of importsOf(file)) {
        if (/(^|\/)core(\/|$)/.test(target)) expect(target, file).toMatch(/core\/contract$/);
      }
    }
  });

  it('the fake brain is used only by the dev pages and the tests', () => {
    for (const file of files) {
      if (/[\\/]dev[\\/]|\.test\.ts$/.test(file)) continue;
      for (const target of importsOf(file)) expect(target, file).not.toMatch(/fake-brain|(^|\/)dev(\/|$)/);
    }
  });

  it('no view is named in the kit or the rig styles or logic, beyond the four view ids on the switcher', () => {
    for (const file of files) {
      if (/[\\/]dev[\\/]|\.test\.ts$/.test(file)) continue;
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/taskbar|innerWidth|innerHeight|screen\.(width|height)/);
    }
  });
});
