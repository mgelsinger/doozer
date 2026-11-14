// The 3D Doozer (src/character/doozer3d.ts) driving the real model file. three.js builds
// the scene graph without a graphics card, so everything except the drawing itself is
// exercised here: faces, bones, palettes, hats, and that nothing temporary outlives its time.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Mesh, MeshStandardMaterial, Object3D } from 'three';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDoozer3D, parseDoozerModel, shapesNeeded, type Doozer3D, type DoozerModel } from '../../../src/character/doozer3d';
import { EXPRESSIONS, EXPRESSION_NAMES } from '../../../src/character/expressions';
import { PALETTES, PALETTE_IDS } from '../../../src/character/palettes';
import { PERFORMANCES, PERFORMANCE_NAMES } from '../../../src/character/performances';

const file = fileURLToPath(new URL('../../../assets/doozer/doozer.glb', import.meta.url));
let model: DoozerModel;

beforeAll(async () => {
  const bytes = readFileSync(file);
  model = await parseDoozerModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
});
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const FRAME = 1 / 60;
const named = (doozer: Doozer3D, name: string): Object3D => {
  const found = doozer.object.getObjectByName(name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};
/** The weight of one shape key, read from the first mesh under `group` that has it. */
function weight(doozer: Doozer3D, group: string, key: string): number {
  let value = Number.NaN;
  named(doozer, group).traverse((node) => {
    const mesh = node as Mesh;
    const index = mesh.morphTargetDictionary?.[key];
    if (index !== undefined && mesh.morphTargetInfluences && Number.isNaN(value)) value = mesh.morphTargetInfluences[index] ?? Number.NaN;
  });
  return value;
}
/** Draw frames until nothing moves (or the limit passes). Timers move with them. */
function run(doozer: Doozer3D, seconds: number): boolean {
  let moving = true;
  for (let t = 0; t < seconds; t += FRAME) {
    vi.advanceTimersByTime(FRAME * 1000);
    moving = doozer.update(FRAME);
  }
  return moving;
}
function still(options: Parameters<typeof createDoozer3D>[1] = {}): Doozer3D {
  const doozer = createDoozer3D(model, options);
  doozer.setLive(false);
  run(doozer, 1);
  return doozer;
}
const materialsNamed = (doozer: Doozer3D, name: string): MeshStandardMaterial[] => {
  const found = new Set<MeshStandardMaterial>();
  doozer.object.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      if (material.name === name) found.add(material as MeshStandardMaterial);
    }
  });
  return [...found];
};
const hex = (material: MeshStandardMaterial): string => `#${material.color.getHexString().toUpperCase()}`;

describe('faces', () => {
  it('shows each of the sixteen expressions with the eyes and mouth the 2D rig draws for it', () => {
    const doozer = still();
    const { eyes, mouths } = shapesNeeded();
    for (const name of EXPRESSION_NAMES) {
      doozer.setMood(name);
      run(doozer, 0.8);
      const want = EXPRESSIONS[name];
      for (const kind of eyes) if (kind !== 'open') expect(weight(doozer, 'eyes', kind), `${name}: eyes ${kind}`).toBe(want.eyes === kind ? 1 : 0);
      for (const kind of mouths) {
        if (kind === 'w') continue;
        const shown = kind === 'chew' ? weight(doozer, 'mouth', 'chew') + weight(doozer, 'mouth', 'chew-shut') : weight(doozer, 'mouth', kind);
        expect(shown, `${name}: mouth ${kind}`).toBeCloseTo(want.mouth === kind ? 1 : 0, 5);
      }
      expect(named(doozer, 'glasses').visible, `${name}: glasses`).toBe(want.glasses === true);
      expect(named(doozer, 'drool').visible, `${name}: drool`).toBe(want.extra === 'drool');
      expect(named(doozer, 'dirt').visible, `${name}: grime`).toBe(want.extra === 'dirt');
      expect(doozer.showing).toBe(name);
    }
    doozer.destroy();
  });

  it('eases from one face to the next rather than jumping', () => {
    const doozer = still();
    doozer.setMood('joyful');
    doozer.update(FRAME);
    const early = weight(doozer, 'eyes', 'happy');
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(1);
    run(doozer, 0.5);
    expect(weight(doozer, 'eyes', 'happy')).toBe(1);
    doozer.destroy();
  });

  it('never shows more than one whole face at once while easing', () => {
    const doozer = still();
    const { eyes } = shapesNeeded();
    for (const name of ['joyful', 'sleepy', 'no', 'wow', 'asleep', 'content'] as const) {
      doozer.setMood(name);
      for (let i = 0; i < 12; i++) {
        doozer.update(FRAME);
        const total = eyes.filter((kind) => kind !== 'open').reduce((sum, kind) => sum + weight(doozer, 'eyes', kind), 0) + weight(doozer, 'eyes', 'blink');
        expect(total).toBeLessThanOrEqual(1.0001);
        expect(total).toBeGreaterThanOrEqual(0);
      }
    }
    doozer.destroy();
  });

  it('a blink shuts round eyes and leaves eyes that are already lines alone', () => {
    const doozer = still();
    doozer.blink();
    let shut = 0;
    for (let i = 0; i < 12; i++) { doozer.update(FRAME); shut = Math.max(shut, weight(doozer, 'eyes', 'blink')); }
    expect(shut).toBeGreaterThan(0.8);
    run(doozer, 0.5);
    expect(weight(doozer, 'eyes', 'blink')).toBe(0);

    doozer.setMood('joyful');
    run(doozer, 0.5);
    doozer.blink();
    shut = 0;
    for (let i = 0; i < 12; i++) { doozer.update(FRAME); shut = Math.max(shut, weight(doozer, 'eyes', 'blink')); }
    expect(shut).toBe(0);
    expect(weight(doozer, 'eyes', 'happy')).toBe(1);
    doozer.destroy();
  });

  it('a flash shows its face and then returns to the mood by itself', () => {
    const doozer = still();
    doozer.setMood('hungry');
    doozer.flash('love', 900);
    run(doozer, 0.3);
    expect(doozer.showing).toBe('love');
    expect(doozer.busy).toBe(true);
    run(doozer, 1);
    expect(doozer.showing).toBe('hungry');
    expect(doozer.busy).toBe(false);
    doozer.destroy();
  });
});

describe('the body', () => {
  it('writes the squash and stretch onto the body bone, feet left on the ground', () => {
    const doozer = still();
    doozer.squish(1);
    let lowest = 1;
    for (let i = 0; i < 20; i++) { doozer.update(FRAME); lowest = Math.min(lowest, named(doozer, 'body').scale.y); }
    expect(lowest).toBeLessThan(0.9);
    expect(named(doozer, 'body').scale.x).not.toBe(1);
    expect(named(doozer, 'footL').scale.y).toBe(1);
    expect(run(doozer, 3)).toBe(false);
    expect(named(doozer, 'body').scale.y).toBeCloseTo(1, 2);
    doozer.destroy();
  });

  it('droops the tuft with the mood and hides it under the nightcap', () => {
    const doozer = still();
    doozer.setMood('asleep');
    run(doozer, 3);
    expect(named(doozer, 'tuft').rotation.z).toBeCloseTo(-EXPRESSIONS.asleep.tuft * Math.PI / 180, 1);
    expect(named(doozer, 'tuft').scale.x).toBe(1);
    doozer.setHat('nightcap');
    doozer.update(FRAME);
    expect(named(doozer, 'tuft').scale.x).toBeLessThan(0.01);
    expect(named(doozer, 'hat-nightcap').visible).toBe(true);
    expect(named(doozer, 'hat-bow').visible).toBe(false);
    doozer.setHat('bow');
    doozer.update(FRAME);
    expect(named(doozer, 'hat-bow').visible).toBe(true);
    expect(named(doozer, 'hat-nightcap').visible).toBe(false);
    expect(named(doozer, 'tuft').scale.x).toBe(1);
    doozer.destroy();
  });

  it('every performance ends on its own timer and leaves the body at rest', async () => {
    for (const name of PERFORMANCE_NAMES) {
      const doozer = still();
      let outcome = '';
      void doozer.perform(name).then((result) => { outcome = result; });
      run(doozer, PERFORMANCES[name].duration / 1000 + 0.1);
      await Promise.resolve();
      expect(outcome, name).toBe('finished');
      expect(doozer.busy, name).toBe(false);
      expect(run(doozer, 3), name).toBe(false);
      expect(named(doozer, 'root').scale.x, name).toBe(1);
      expect(named(doozer, 'root').position.y, name).toBeCloseTo(0, 5);
      doozer.destroy();
    }
  });

  it('a performance cut short by another settles its promise as interrupted', async () => {
    const doozer = still();
    const outcomes: string[] = [];
    void doozer.perform('celebrate').then((result) => outcomes.push(`celebrate:${result}`));
    run(doozer, 0.3);
    void doozer.perform('wave').then((result) => outcomes.push(`wave:${result}`));
    run(doozer, 2);
    await Promise.resolve();
    expect(outcomes).toEqual(['celebrate:interrupted', 'wave:finished']);
    expect(run(doozer, 3)).toBe(false);
    doozer.destroy();
  });

  it('glasses can be put on by the view as well as by the focus face', () => {
    const doozer = still();
    expect(named(doozer, 'glasses').visible).toBe(false);
    doozer.setGlasses(true);
    run(doozer, 0.5);
    expect(named(doozer, 'glasses').visible).toBe(true);
    expect(named(doozer, 'glasses').scale.x).toBeCloseTo(1, 2);
    doozer.setGlasses(false);
    run(doozer, 0.5);
    expect(named(doozer, 'glasses').visible).toBe(false);
    doozer.destroy();
  });
});

describe('palettes', () => {
  it('each palette colours the materials that follow it, and only this Doozer', () => {
    const one = still();
    const other = still({ palette: 'sky' });
    for (const id of PALETTE_IDS) {
      one.setPalette(id);
      const palette = PALETTES[id];
      for (const [name, key] of [['skin', 'body'], ['shade', 'shade'], ['ear', 'ear'], ['cheek', 'cheek'], ['ink', 'ink']] as const) {
        for (const material of materialsNamed(one, name)) expect(hex(material), `${id}: ${name}`).toBe(palette[key]);
      }
      expect(one.palette).toBe(id);
    }
    for (const material of materialsNamed(other, 'skin')) expect(hex(material)).toBe(PALETTES.sky.body);
    one.destroy();
    other.destroy();
  });

  it('paints the body from the body colour to the belly colour by the mask', () => {
    const doozer = still({ palette: 'mint' });
    const body = named(doozer, 'doozer-body') as Mesh;
    const mask = body.geometry.getAttribute('_belly');
    const colour = body.geometry.getAttribute('color');
    expect(mask.count).toBe(colour.count);
    let bellyAt = -1;
    let bodyAt = -1;
    for (let i = 0; i < mask.count; i++) {
      if (mask.getX(i) > 0.999 && bellyAt < 0) bellyAt = i;
      if (mask.getX(i) === 0 && bodyAt < 0) bodyAt = i;
    }
    expect(bellyAt).toBeGreaterThanOrEqual(0);
    expect(bodyAt).toBeGreaterThanOrEqual(0);
    const expected = materialsNamed(still({ palette: 'mint' }), 'skin')[0]?.color;
    expect(colour.getX(bodyAt)).toBeCloseTo(expected?.r ?? -1, 4);
    expect(colour.getY(bodyAt)).toBeCloseTo(expected?.g ?? -1, 4);
    expect(colour.getX(bellyAt)).toBeGreaterThan(colour.getX(bodyAt));   // the belly is paler
    doozer.destroy();
  });
});

describe('going away', () => {
  it('destroy frees this Doozer\'s own materials and leaves the shared model usable', () => {
    const doozer = still();
    const mine = materialsNamed(doozer, 'skin');
    let freed = 0;
    for (const material of mine) material.addEventListener('dispose', () => { freed++; });
    doozer.destroy();
    expect(freed).toBe(mine.length);
    expect(doozer.update(FRAME)).toBe(false);
    doozer.setMood('joyful');                      // nothing happens, nothing throws
    const again = still();
    expect(again.object.getObjectByName('eyes')).toBeTruthy();
    again.destroy();
  });

  it('leaves no timer behind', () => {
    const before = vi.getTimerCount();
    const doozer = still();
    doozer.flash('wow', 5000);
    void doozer.perform('celebrate');
    doozer.destroy();
    expect(vi.getTimerCount()).toBe(before);
  });

  it('tells its owner when something changed while nothing was being drawn', () => {
    let asked = 0;
    const doozer = createDoozer3D(model, { invalidate: () => { asked++; } });
    doozer.setLive(false);
    run(doozer, 1);
    asked = 0;
    doozer.setMood('hungry');
    expect(asked).toBeGreaterThan(0);
    asked = 0;
    doozer.flash('love', 400);
    vi.advanceTimersByTime(500);                   // the flash ends by timer, with no frame
    expect(asked).toBeGreaterThan(1);
    doozer.destroy();
  });
});
