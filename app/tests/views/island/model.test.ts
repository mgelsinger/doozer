// The model file itself (app/assets/doozer/doozer.glb, built by build_doozer.py): that
// it carries what the page relies on, and that it has not drifted from the 2D rig's
// tables. If one of these fails after a change to the rig, rebuild the model:
//
//   blender --background --factory-startup --python app/assets/doozer/build_doozer.py

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXPRESSIONS } from '../../../src/character/expressions';
import { PALETTES, PALETTE_IDS } from '../../../src/character/palettes';
import { HAT_ANCHOR, PIVOTS } from '../../../src/character/rig-markup';

interface GltfNode { name?: string; mesh?: number; skin?: number; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[]; extras?: Record<string, unknown> }
interface Gltf {
  nodes: GltfNode[];
  meshes: { name: string; extras?: { targetNames?: string[] }; primitives: { attributes: Record<string, number>; material?: number; targets?: unknown[] }[] }[];
  materials: { name: string; alphaMode?: string; extras?: Record<string, unknown>; extensions?: Record<string, unknown> }[];
  skins: { joints: number[] }[];
  accessors: { count: number; min?: number[]; max?: number[] }[];
  extensionsUsed?: string[];
}

const file = fileURLToPath(new URL('../../../assets/doozer/doozer.glb', import.meta.url));
const bytes = readFileSync(file);
const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString('utf8')) as Gltf;
const node = (name: string): GltfNode => {
  const found = gltf.nodes.find((n) => n.name === name);
  if (!found) throw new Error(`the model has no node called ${name}`);
  return found;
};
const mesh = (name: string) => {
  const found = gltf.meshes.find((m) => m.name === name);
  if (!found) throw new Error(`the model has no mesh called ${name}`);
  return found;
};
/** A point of the 2D rig's drawing, in model units (build_doozer.py: `rp`). */
const rig = (x: number, y: number): [number, number] => [(x - 100) / 100, (186 - y) / 100];

describe('the file', () => {
  it('is a binary glTF of a sensible size', () => {
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('glTF');
    expect(bytes.length).toBeGreaterThan(100_000);
    expect(bytes.length).toBeLessThan(900_000);
  });

  it('is low-poly: under 20,000 triangles in all', () => {
    // Each primitive is indexed; count through its position accessor as an upper bound on detail.
    const vertices = gltf.meshes.flatMap((m) => m.primitives).reduce((sum, p) => sum + (gltf.accessors[p.attributes.POSITION ?? -1]?.count ?? 0), 0);
    expect(vertices).toBeLessThan(10_000);
  });
});

describe('the armature', () => {
  const joints = (gltf.skins[0]?.joints ?? []).map((index) => gltf.nodes[index]?.name);

  it('has the bones the plan asks for: root, body, ears, tuft, arms, feet (and a tail)', () => {
    expect([...joints].sort()).toEqual(['armL', 'armR', 'body', 'earL', 'earR', 'footL', 'footR', 'root', 'tail', 'tuft']);
  });

  it('every bone rests unrotated and unscaled, so its axes are the model\'s own', () => {
    for (const name of joints) {
      const joint = node(name as string);
      const [x, y, z, w] = joint.rotation ?? [0, 0, 0, 1];
      expect(Math.abs(x ?? 0) + Math.abs(y ?? 0) + Math.abs(z ?? 0), `${name} rotation`).toBeLessThan(1e-5);
      expect(Math.abs(w ?? 1), `${name} rotation`).toBeCloseTo(1, 5);
      for (const s of joint.scale ?? [1, 1, 1]) expect(s, `${name} scale`).toBeCloseTo(1, 5);
    }
  });

  it('the body and the feet hang from the root; ears, tuft, arms and tail from the body', () => {
    const children = (name: string): string[] => (node(name).children ?? []).map((index) => gltf.nodes[index]?.name ?? '');
    expect(children('root')).toEqual(expect.arrayContaining(['body', 'footL', 'footR']));
    expect(children('body')).toEqual(expect.arrayContaining(['earL', 'earR', 'tuft', 'armL', 'armR', 'tail']));
  });

  it('puts each pivot where the 2D rig has it', () => {
    const at = (name: string): number[] => node(name).translation ?? [0, 0, 0];
    const expectAt = (name: string, pivot: readonly [number, number], mirrored = false): void => {
      const [x, y] = rig(pivot[0], pivot[1]);
      expect(at(name)[0], `${name} x`).toBeCloseTo(mirrored ? -x : x, 4);
      expect(at(name)[1], `${name} y`).toBeCloseTo(y, 4);
    };
    expectAt('earL', PIVOTS['ear-l']);
    expectAt('earR', PIVOTS['ear-r']);
    expectAt('armL', PIVOTS['arm-l']);
    expectAt('armR', PIVOTS['arm-r']);
    expectAt('tuft', PIVOTS.tuft);
    expectAt('footL', PIVOTS['foot-l']);
    expectAt('footR', PIVOTS['foot-r']);
    const anchor = node('Doozer').extras?.hatAnchor as number[];
    expect(anchor[0]).toBeCloseTo(rig(HAT_ANCHOR.x, HAT_ANCHOR.y)[0], 6);
    expect(anchor[1]).toBeCloseTo(rig(HAT_ANCHOR.x, HAT_ANCHOR.y)[1], 6);
  });

  it('skins the body and the limbs to it, and fixes the face and the hats to bones', () => {
    expect(node('doozer-body').skin).toBe(0);
    expect(node('doozer-limbs').skin).toBe(0);
    const on = (bone: string): string[] => (node(bone).children ?? []).map((index) => gltf.nodes[index]?.name ?? '');
    expect(on('body')).toEqual(expect.arrayContaining(['eyes', 'mouth', 'cheeks', 'glasses', 'dirt', 'drool', 'hat-nightcap']));
    expect(on('earL')).toContain('hat-bow');
  });
});

describe('the proportions', () => {
  it('the body is as wide and as tall as the 2D outline', () => {
    const position = gltf.accessors[mesh('doozer-body').primitives[0]?.attributes.POSITION ?? -1];
    // The 2D body path spans x 36..164 and y 44..184.
    expect(position?.min?.[0]).toBeCloseTo(rig(36, 0)[0], 2);
    expect(position?.max?.[0]).toBeCloseTo(rig(164, 0)[0], 2);
    expect(position?.max?.[1]).toBeCloseTo(rig(0, 44)[1], 2);
    expect(position?.min?.[1]).toBeCloseTo(rig(0, 184)[1], 2);
    // A little flatter front to back than it is wide.
    const depth = (position?.max?.[2] ?? 0) - (position?.min?.[2] ?? 0);
    expect(depth).toBeGreaterThan(1.1);
    expect(depth).toBeLessThan(1.28);
  });

  it('stands on the ground', () => {
    const position = gltf.accessors[mesh('doozer-limbs').primitives.map((p) => p.attributes.POSITION ?? -1)[0] ?? -1];
    const lowest = Math.min(...mesh('doozer-limbs').primitives.map((p) => gltf.accessors[p.attributes.POSITION ?? -1]?.min?.[1] ?? 0));
    expect(position).toBeDefined();
    expect(lowest).toBeGreaterThan(-0.02);
    expect(lowest).toBeLessThan(0.02);
  });
});

describe('the face', () => {
  const needed = { eyes: new Set(Object.values(EXPRESSIONS).map((e) => e.eyes)), mouths: new Set(Object.values(EXPRESSIONS).map((e) => e.mouth)) };

  it('has a shape key for every way an expression draws the eyes (open is the resting shape)', () => {
    const targets = mesh('eyes').extras?.targetNames ?? [];
    for (const eyes of needed.eyes) if (eyes !== 'open') expect(targets, eyes).toContain(eyes);
    expect(targets).toContain('blink');
    expect(node('Doozer').extras?.eyes).toEqual(['open', ...targets.filter((name) => name !== 'blink')]);
  });

  it('has a shape key for every mouth (w is the resting shape)', () => {
    const targets = mesh('mouth').extras?.targetNames ?? [];
    for (const mouth of needed.mouths) if (mouth !== 'w') expect(targets, mouth).toContain(mouth);
    expect(targets).toContain('chew-shut');
  });

  it('every primitive of a shaped mesh carries every shape', () => {
    for (const name of ['eyes', 'mouth']) {
      const m = mesh(name);
      for (const primitive of m.primitives) expect(primitive.targets?.length, name).toBe(m.extras?.targetNames?.length);
    }
  });

  it('every one of the sixteen expressions can therefore be shown', () => {
    const eyes = new Set(['open', ...(mesh('eyes').extras?.targetNames ?? [])]);
    const mouths = new Set(['w', ...(mesh('mouth').extras?.targetNames ?? [])]);
    expect(Object.keys(EXPRESSIONS)).toHaveLength(16);
    for (const [name, expression] of Object.entries(EXPRESSIONS)) {
      expect(eyes.has(expression.eyes), `${name}: eyes ${expression.eyes}`).toBe(true);
      expect(mouths.has(expression.mouth), `${name}: mouth ${expression.mouth}`).toBe(true);
    }
  });
});

describe('the palettes', () => {
  const material = (name: string) => {
    const found = gltf.materials.find((m) => m.name === name);
    if (!found) throw new Error(`the model has no material called ${name}`);
    return found;
  };

  it('carries the five palettes exactly as the 2D rig has them', () => {
    const stored = node('Doozer').extras?.palettes as Record<string, Record<string, string>>;
    expect(Object.keys(stored).sort()).toEqual([...PALETTE_IDS].sort());
    for (const id of PALETTE_IDS) {
      for (const key of ['body', 'light', 'shade', 'belly', 'cheek', 'ear', 'line', 'ink'] as const) {
        expect(stored[id]?.[key], `${id}.${key}`).toBe(PALETTES[id][key]);
      }
    }
  });

  it('names the palette colour each coloured material takes', () => {
    expect(material('body').extras).toMatchObject({ palette: 'body', belly: 'belly' });
    expect(material('skin').extras).toMatchObject({ palette: 'body' });
    expect(material('shade').extras).toMatchObject({ palette: 'shade' });
    expect(material('ear').extras).toMatchObject({ palette: 'ear' });
    expect(material('cheek').extras).toMatchObject({ palette: 'cheek' });
    expect(material('ink').extras).toMatchObject({ palette: 'ink' });
  });

  it('the body carries its belly mask and its colours per vertex', () => {
    const attributes = mesh('doozer-body').primitives[0]?.attributes ?? {};
    expect(Object.keys(attributes)).toEqual(expect.arrayContaining(['_BELLY', 'COLOR_0', 'JOINTS_0', 'WEIGHTS_0']));
  });

  it('cheeks, lenses and grime are see-through; plush parts have their sheen', () => {
    for (const name of ['cheek', 'lens', 'dirt']) expect(material(name).alphaMode, name).toBe('BLEND');
    for (const name of ['body', 'skin', 'shade']) expect(material(name).extensions, name).toHaveProperty('KHR_materials_sheen');
  });
});
