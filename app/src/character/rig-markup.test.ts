// Structure checks on the rig that do not need a browser: the transform-origin trap,
// that every face and pose named in the data has CSS to draw it, and that the
// choreography data is well formed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXPRESSIONS, EXPRESSION_NAMES, POSES } from './expressions';
import { PALETTES, PALETTE_IDS, PALETTE_VARS } from './palettes';
import { PERFORMANCES, PERFORMANCE_NAMES } from './performances';
import { PIVOTS, hatMarkup, rigMarkup } from './rig-markup';

const css = readFileSync(fileURLToPath(new URL('./rig.css', import.meta.url)), 'utf8');
const markup = rigMarkup('test');
const tags = (source: string) => source.match(/<[a-zA-Z][^>]*>/g) ?? [];

describe('the transform-origin trap', () => {
  // A shape with its own transform attribute must not inherit a CSS transform box or
  // origin, or it is drawn in the wrong place.
  it('no element with a transform attribute is also a pivot part', () => {
    const all = [...tags(markup), ...tags(hatMarkup('nightcap')), ...tags(hatMarkup('bow'))];
    const transformed = all.filter((tag) => /\stransform="/.test(tag));
    expect(transformed.length).toBeGreaterThan(0);
    for (const tag of transformed) {
      expect(tag).not.toMatch(/class="[^"]*\bdz-p\b/);
      expect(tag).not.toMatch(/--px/);
    }
  });

  it('the stylesheet has no blanket rule setting a transform box or origin', () => {
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) ?? [];
    for (const rule of rules) {
      const [selector = '', body = ''] = rule.split('{');
      if (!/transform-box|transform-origin/.test(body)) continue;
      expect(selector, `blanket selector: ${selector.trim()}`).not.toMatch(/(^|[\s>+~,])\*/);
    }
  });

  it('every pivot is carried by a part, in view-box units', () => {
    for (const [name, [x, y]] of Object.entries(PIVOTS)) {
      expect(markup, name).toContain(`--px:${x}px;--py:${y}px`);
    }
    expect(css).toMatch(/\.dz-p\s*\{[^}]*transform-box:\s*view-box/);
  });
});

describe('faces and poses', () => {
  it('there are sixteen expressions: eight moods, seven reactions, and focus', () => {
    expect(EXPRESSION_NAMES).toEqual([
      'joyful', 'content', 'meh', 'hungry', 'bored', 'sleepy', 'dirty', 'asleep',
      'eat', 'love', 'wow', 'cheer', 'no', 'shake', 'yawn', 'focus',
    ]);
    expect(EXPRESSIONS.focus.glasses).toBe(true);
    expect(EXPRESSIONS.focus.eyes).toBe('calm');
  });

  it('every eye shape, mouth and pose an expression uses has CSS to draw it', () => {
    for (const name of EXPRESSION_NAMES) {
      const exp = EXPRESSIONS[name];
      if (exp.eyes !== 'open') expect(css, `${name} eyes`).toContain(`[data-eyes="${exp.eyes}"]`);
      expect(css, `${name} mouth`).toContain(`[data-mouth="${exp.mouth}"]`);
      expect(css, `${name} pose`).toContain(`[data-pose="${exp.pose}"]`);
    }
  });

  it('every pose has CSS (except none, which is the absence of a loop)', () => {
    for (const pose of POSES) {
      if (pose === 'none') continue;
      expect(css, pose).toContain(`[data-pose="${pose}"]`);
    }
  });

  it('droopy moods droop the tuft and happy ones perk it', () => {
    expect(EXPRESSIONS.joyful.tuft).toBeLessThan(0);
    expect(EXPRESSIONS.content.tuft).toBe(0);
    for (const low of ['hungry', 'bored', 'sleepy', 'dirty', 'asleep'] as const) expect(EXPRESSIONS[low].tuft).toBeGreaterThan(20);
  });
});

describe('palettes and styles', () => {
  it('five palettes, each with every colour the rig reads', () => {
    expect(PALETTE_IDS).toEqual(['peach', 'mint', 'lavender', 'butter', 'sky']);
    for (const id of PALETTE_IDS) {
      for (const key of PALETTE_VARS) {
        expect(PALETTES[id][key], `${id}.${key}`).toMatch(/^#[0-9A-Fa-f]{6}$/);
        expect(markup + css).toContain(`--dz-${key}`);
      }
    }
  });

  it('the soft style is the same parts with the outline switched off', () => {
    expect(css).toMatch(/\.dz\[data-style="soft"\] \.dz-stroke\s*\{\s*stroke:\s*none/);
    expect(markup).not.toContain('data-style');   // one set of parts, styled from the root
  });

  it('hats draw into the attachment point', () => {
    expect(markup).toContain('class="dz-hat dz-p"');
    expect(hatMarkup('nightcap')).toContain('dz-hat-nightcap');
    expect(hatMarkup('bow')).toContain('dz-hat-bow');
  });
});

describe('performance data', () => {
  it('is well formed: sane lengths, ordered offsets, faces inside the run', () => {
    for (const name of PERFORMANCE_NAMES) {
      const spec = PERFORMANCES[name];
      expect(spec.duration, name).toBeGreaterThan(100);
      expect(spec.duration, name).toBeLessThanOrEqual(5000);
      for (const [at, face] of spec.faces ?? []) {
        expect(at, `${name} face ${face}`).toBeLessThan(spec.duration);
        expect(EXPRESSIONS[face], `${name} face ${face}`).toBeDefined();
      }
      for (const strength of [0.5, 1, 2]) {
        for (const track of spec.tracks(strength)) {
          expect(track.keyframes.length, `${name} ${track.part}`).toBeGreaterThanOrEqual(2);
          let previous = -1;
          for (const frame of track.keyframes) {
            if (frame.offset === undefined) continue;
            expect(frame.offset).toBeGreaterThan(previous);
            expect(frame.offset).toBeLessThanOrEqual(1);
            previous = frame.offset;
          }
        }
      }
    }
  });

  it('falling asleep ends on the first frame of the sleep loop, so the hand-over does not pop', () => {
    const tracks = PERFORMANCES['fall-asleep'].tracks(1);
    const body = tracks.find((track) => track.part === 'body');
    const lastFrame = body?.keyframes[body.keyframes.length - 1];
    expect(lastFrame?.transform).toContain('scale(1.1, .84)');
    expect(css).toMatch(/@keyframes dz-sleep \{ 0%, 100% \{ transform: scale\(1\.1, \.84\)/);
  });
});
