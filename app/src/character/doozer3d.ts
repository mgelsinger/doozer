// The 3D Doozer (DESIGN_SPEC.md section 7: one design, two renderings). It loads the model
// built by app/assets/doozer/build_doozer.py and drives it with the same expression names
// and the same state machine as the 2D rig, so the two cannot disagree about what a face
// is or how long a reaction lasts.
//
// THIS FILE IMPORTS three.js. Only the Island view and the development viewer may load
// it, and only through a dynamic `import()`: three.js must never be part of what the app
// loads at start-up (WORK_PLAN.md section 3). `character/index.ts` deliberately does not
// re-export it, and tests/views/island/lazy-three.test.ts checks the rule.
//
// Division of labour:
//   - ExpressionState (shared with the 2D rig) decides which face and pose are showing
//     and ends everything temporary by timer.
//   - BodyMotion (body-motion.ts, no three.js) turns that into numbers: the squash-and-
//     stretch spring, the hop, ears, tuft, arms.
//   - This file writes those numbers onto the model's bones and shape keys once a frame,
//     when its owner calls `update(dt)`. It never starts a frame loop of its own: the
//     owner draws only while `update` says something is still moving, and is told through
//     `invalidate` when something changed while it was not drawing.

import { BufferAttribute, Color, type Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneWithSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { HatId, PaletteId } from '../core/contract';
import { BodyMotion } from './body-motion';
import { EXPRESSIONS, type ExpressionName, type Eyes, type Mouth, type Pose } from './expressions';
import { ExpressionState, type Look, type PerformanceOutcome } from './expression-state';
import { PALETTES, isPaletteId, type Palette } from './palettes';
import type { PerformanceName } from './performances';
import { realTimers, type Timers } from './timers';

/** The model file, parsed. Instances are made from it; it is never drawn itself. */
export interface DoozerModel {
  readonly template: Group;
  /** Free the geometry and materials every instance shares. Destroy the instances first. */
  dispose(): void;
}

export interface Doozer3DOptions {
  palette?: PaletteId;
  hat?: HatId | null;
  reduceMotion?: boolean;
  timers?: Timers;
  random?: () => number;
  /** Something changed while nothing was moving: the owner should draw again. */
  invalidate?(): void;
  /** The feet touched down after a hop. */
  onLand?(speed: number): void;
}

export interface Doozer3D {
  /** Add this to a scene. Its origin is the ground under the feet; one unit is 100 px of the 2D rig. */
  readonly object: Group;
  /** The body's physics: `hop()`, `press()`, `setFacing()`, and whether it is on the ground. */
  readonly body: BodyMotion;
  readonly mood: ExpressionName;
  readonly showing: ExpressionName;
  readonly pose: Pose;
  /** True while a flash or a performance is running. */
  readonly busy: boolean;
  readonly palette: PaletteId;

  setPalette(id: PaletteId): void;
  setHat(hat: HatId | null): void;
  setGlasses(on: boolean): void;
  setDirt(on: boolean): void;
  setReduceMotion(on: boolean): void;
  /** False stops the idle loops (breathing, swaying): nothing then moves without a reason. */
  setLive(on: boolean): void;

  setMood(name: ExpressionName): void;
  flash(name: ExpressionName, ms?: number): void;
  setPose(pose: Pose | null, face?: ExpressionName | null): void;
  lookAt(x: number, y: number): void;
  perform(name: PerformanceName, strength?: number): Promise<PerformanceOutcome>;
  squish(strength?: number): void;
  blink(): void;
  stop(): void;

  /** Advance by `dt` seconds and write the result to the model. True while anything is still moving. */
  update(dt: number): boolean;
  /** Everything at rest, now, and written to the model. */
  settle(): void;
  destroy(): void;
}

const EYE_KINDS: readonly Eyes[] = ['open', 'calm', 'half', 'heavy', 'sad', 'wide', 'happy', 'closed', 'squeeze'];
const MOUTH_KINDS: readonly Mouth[] = ['w', 'smile', 'open', 'o', 'flat', 'frown', 'wavy', 'chew', 'yawn'];
/** The eyes a blink can shut. The others are already lines. */
const ROUND_EYES: ReadonlySet<Eyes> = new Set<Eyes>(['open', 'calm', 'half', 'heavy', 'sad', 'wide']);
/** Where the glasses grow from when they are put on: between the eyes, on the face. */
const FACE_PIVOT = { x: 0, y: 0.8, z: 0.56 } as const;

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value && typeof value === 'object' && 'isTexture' in value) (value as { dispose(): void }).dispose();
  }
  material.dispose();
}

function eachMaterial(mesh: Mesh, fn: (material: Material) => void): void {
  if (Array.isArray(mesh.material)) mesh.material.forEach(fn);
  else fn(mesh.material);
}

/** Read the model from the bytes of the .glb file. */
export async function parseDoozerModel(data: ArrayBuffer): Promise<DoozerModel> {
  const gltf = await new GLTFLoader().parseAsync(data, '');
  const template = gltf.scene;
  return {
    template,
    dispose() {
      template.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        eachMaterial(mesh, disposeMaterial);
      });
    },
  };
}

/** Fetch and read the model. Rejects if the file cannot be had; the caller sets the time limit. */
export async function loadDoozerModel(url: string, signal?: AbortSignal): Promise<DoozerModel> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`the Doozer model could not be loaded (${response.status})`);
  return parseDoozerModel(await response.arrayBuffer());
}

const backOut = (t: number): number => 1 + 2.4 * Math.pow(t - 1, 3) + 1.4 * Math.pow(t - 1, 2);

export function createDoozer3D(model: DoozerModel, options: Doozer3DOptions = {}): Doozer3D {
  const timers = options.timers ?? realTimers;
  const invalidate = options.invalidate ?? (() => undefined);
  const object = cloneWithSkeleton(model.template) as Group;

  // ---- this instance's own materials and body colours ------------------------------
  // Geometry is shared with every other instance; colours are not.
  const owned = new Map<Material, Material>();
  const byName = new Map<string, Material[]>();
  let bodyMesh: Mesh | null = null;
  const own = (material: Material): Material => {
    let mine = owned.get(material);
    if (!mine) {
      mine = material.clone();
      owned.set(material, mine);
      const list = byName.get(mine.name) ?? [];
      list.push(mine);
      byName.set(mine.name, list);
    }
    return mine;
  };
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(own) : own(mesh.material);
    // Bones move the skin far from where it was modelled; never cull by the modelled bounds.
    mesh.frustumCulled = false;
    if (mesh.geometry.getAttribute('_belly')) {
      mesh.geometry = mesh.geometry.clone();
      bodyMesh = mesh;
    }
  });
  for (const name of ['cheek', 'lens', 'dirt']) {
    for (const material of byName.get(name) ?? []) { material.transparent = true; material.depthWrite = false; }
  }
  const SOLID = new Set(['doozer-body', 'doozer-limbs', 'hat-nightcap', 'hat-bow']);
  object.traverse((node) => {
    const mesh = node as Mesh;
    if (!mesh.isMesh) return;
    let top: Object3D | null = mesh;
    while (top && !SOLID.has(top.name)) top = top.parent;
    mesh.castShadow = top !== null;
  });

  const part = <T extends Object3D = Object3D>(name: string): T | null => (object.getObjectByName(name) as T | undefined) ?? null;
  const bones = {
    root: part('root'), body: part('body'), earL: part('earL'), earR: part('earR'), tuft: part('tuft'),
    armL: part('armL'), armR: part('armR'), footL: part('footL'), footR: part('footR'), tail: part('tail'),
  };
  const rest = {
    rootY: bones.root?.position.y ?? 0,
    tailX: bones.tail?.position.x ?? 0,
  };
  const nodes = {
    eyes: part('eyes'), mouth: part('mouth'), cheeks: part('cheeks'), glasses: part('glasses'),
    dirt: part('dirt'), drool: part('drool'), nightcap: part('hat-nightcap'), bow: part('hat-bow'),
  };
  const home = new Map<Object3D, { x: number; y: number; z: number }>();
  for (const node of [nodes.eyes, nodes.mouth, nodes.cheeks, nodes.glasses]) {
    if (node) home.set(node, { x: node.position.x, y: node.position.y, z: node.position.z });
  }
  const morphs = (root: Object3D | null): Mesh[] => {
    const found: Mesh[] = [];
    root?.traverse((node) => {
      const mesh = node as Mesh;
      if (mesh.isMesh && mesh.morphTargetDictionary && mesh.morphTargetInfluences) found.push(mesh);
    });
    return found;
  };
  const eyeMeshes = morphs(nodes.eyes);
  const mouthMeshes = morphs(nodes.mouth);
  const set = (meshes: readonly Mesh[], key: string, value: number): void => {
    for (const mesh of meshes) {
      const index = mesh.morphTargetDictionary?.[key];
      if (index !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[index] = value;
    }
  };

  // ---- state -----------------------------------------------------------------------
  const body = new BodyMotion({ random: options.random, onLand: options.onLand });
  let paletteId: PaletteId = 'peach';
  let hat: HatId | null = null;
  let glasses = false;
  let dirt = false;
  let reduce = options.reduceMotion ?? false;
  let destroyed = false;
  let look: Look | null = null;

  const eyeWeight = Object.fromEntries(EYE_KINDS.map((kind) => [kind, 0])) as Record<Eyes, number>;
  const mouthWeight = Object.fromEntries(MOUTH_KINDS.map((kind) => [kind, 0])) as Record<Mouth, number>;
  let faceSnap = true;       // the first face is not eased into
  let glassesK = 0;
  let dirtK = 0;
  let blushK = 0;
  let droolK = 0;
  let extrasSnap = true;

  const state = new ExpressionState({
    apply(next) {
      look = next;
      body.setLook(next);
      invalidate();
    },
    startPerformance(name, strength) {
      const stop = body.startPerformance(name, strength);
      invalidate();
      return stop;
    },
  }, { timers, reduceMotion: reduce });

  function paintPalette(): void {
    const palette = PALETTES[paletteId];
    const colour = new Color();
    for (const materials of byName.values()) {
      for (const material of materials) {
        const key = material.userData.palette as keyof Palette | undefined;
        if (!key || !(key in palette) || material.userData.belly) continue;
        (material as MeshStandardMaterial).color.set(palette[key]);
      }
    }
    // The body's own colour is per vertex: body colour, eased into the belly colour by the mask.
    const mesh = bodyMesh as Mesh | null;
    const mask = mesh?.geometry.getAttribute('_belly');
    if (!mesh || !mask) return;
    const count = mask.count;
    const existing = mesh.geometry.getAttribute('color');
    const size = existing && existing.count === count ? existing.itemSize : 3;
    const values = new Float32Array(count * size).fill(1);
    const base = new Color(palette.body);
    const belly = new Color(palette.belly);
    for (let i = 0; i < count; i++) {
      colour.copy(base).lerp(belly, mask.getX(i));
      values[i * size] = colour.r;
      values[i * size + 1] = colour.g;
      values[i * size + 2] = colour.b;
    }
    mesh.geometry.setAttribute('color', new BufferAttribute(values, size));
    eachMaterial(mesh, (material) => {
      (material as MeshStandardMaterial).color.set(0xffffff);
      material.vertexColors = true;
      material.needsUpdate = true;
    });
  }

  /** The face and the small extras, eased toward what the look asks for. True while still easing. */
  function paintFace(dt: number, blink: number, chew: number): boolean {
    if (!look) return false;
    let easing = false;
    const toward = (from: number, to: number, seconds: number, snap: boolean): number => {
      if (snap || reduce) return to;
      const next = from + (to - from) * (1 - Math.exp(-dt / seconds));
      if (Math.abs(next - to) < 0.01) return to;
      easing = true;
      return next;
    };

    let lines = 0;
    for (const kind of EYE_KINDS) {
      eyeWeight[kind] = toward(eyeWeight[kind], look.eyes === kind ? 1 : 0, 0.045, faceSnap);
      if (!ROUND_EYES.has(kind)) lines += eyeWeight[kind];
    }
    for (const kind of EYE_KINDS) {
      if (kind !== 'open') set(eyeMeshes, kind, eyeWeight[kind] * (ROUND_EYES.has(kind) ? 1 - blink : 1));
    }
    set(eyeMeshes, 'blink', blink * Math.max(0, 1 - lines));

    for (const kind of MOUTH_KINDS) mouthWeight[kind] = toward(mouthWeight[kind], look.mouth === kind ? 1 : 0, 0.06, faceSnap);
    for (const kind of MOUTH_KINDS) {
      if (kind === 'w') continue;
      if (kind === 'chew') {
        set(mouthMeshes, 'chew', mouthWeight.chew * (1 - chew));
        set(mouthMeshes, 'chew-shut', mouthWeight.chew * chew);
      } else set(mouthMeshes, kind, mouthWeight[kind]);
    }
    faceSnap = false;

    glassesK = toward(glassesK, look.glasses || glasses ? 1 : 0, 0.07, extrasSnap);
    blushK = toward(blushK, look.blush ? 1 : 0, 0.12, extrasSnap);
    dirtK = toward(dirtK, look.extra === 'dirt' || dirt ? 1 : 0, 0.12, extrasSnap);
    droolK = toward(droolK, look.extra === 'drool' ? 1 : 0, 0.08, extrasSnap);
    extrasSnap = false;

    if (nodes.glasses) {
      const s = 0.7 + 0.3 * backOut(glassesK);
      nodes.glasses.visible = glassesK > 0.02;
      nodes.glasses.scale.setScalar(s);
      nodes.glasses.userData.grow = 1 - s;
    }
    for (const material of byName.get('cheek') ?? []) material.opacity = 0.62 + 0.34 * blushK;
    for (const material of byName.get('dirt') ?? []) material.opacity = 0.5 * dirtK;
    if (nodes.dirt) nodes.dirt.visible = dirtK > 0.02;
    if (nodes.drool) nodes.drool.visible = droolK > 0.5;
    return easing;
  }

  function paintBody(): void {
    const p = body.pose;
    if (bones.root) {
      bones.root.position.y = rest.rootY + p.y;
      bones.root.rotation.y = p.yaw;
      bones.root.scale.setScalar(p.scale);
    }
    if (bones.body) {
      bones.body.scale.set(p.bulge, p.stretch, p.bulge);
      bones.body.rotation.set(p.pitch, 0, p.roll);
    }
    if (bones.earL) bones.earL.rotation.z = p.earL;
    if (bones.earR) bones.earR.rotation.z = -p.earR;
    if (bones.tuft) {
      bones.tuft.rotation.set(p.tuftSway, 0, p.tuft);
      // The nightcap covers the tuft, as in the 2D rig.
      bones.tuft.scale.setScalar(hat === 'nightcap' ? 0.001 : 1);
    }
    if (bones.armL) bones.armL.rotation.set(-p.armLForward, 0, -p.armL);
    if (bones.armR) bones.armR.rotation.set(-p.armRForward, 0, p.armR);
    if (bones.footL) bones.footL.rotation.x = p.tuck * 0.5;
    if (bones.footR) bones.footR.rotation.x = p.tuck * 0.5;
    if (bones.tail) bones.tail.position.x = rest.tailX + p.tail;

    // The face slides a little toward where Doozer is looking, as the 2D face does.
    const slide = (node: Object3D | null, amount: number): void => {
      const at = node ? home.get(node) : undefined;
      if (!node || !at) return;
      const grow = (node.userData.grow as number | undefined) ?? 0;
      node.position.set(
        at.x + p.lookX * 0.03 * amount + FACE_PIVOT.x * grow,
        at.y + p.lookY * 0.02 * amount + FACE_PIVOT.y * grow,
        at.z + FACE_PIVOT.z * grow,
      );
    };
    slide(nodes.eyes, 1);
    slide(nodes.glasses, 1);
    slide(nodes.mouth, 0.8);
    slide(nodes.cheeks, 0.5);
  }

  function showHat(): void {
    if (nodes.nightcap) nodes.nightcap.visible = hat === 'nightcap';
    if (nodes.bow) nodes.bow.visible = hat === 'bow';
  }

  const api: Doozer3D = {
    object,
    body,
    get mood() { return state.mood; },
    get showing() { return state.showing; },
    get pose() { return state.pose; },
    get busy() { return state.busy; },
    get palette() { return paletteId; },

    setPalette(id) {
      const next = isPaletteId(id) ? id : 'peach';
      if (next === paletteId && bodyMesh?.geometry.getAttribute('color')) return;
      paletteId = next;
      paintPalette();
      invalidate();
    },
    setHat(next) {
      const value = next === 'nightcap' || next === 'bow' ? next : null;
      if (value === hat) return;
      hat = value;
      showHat();
      invalidate();
    },
    setGlasses(on) {
      if (glasses === on) return;
      glasses = on;
      invalidate();
    },
    setDirt(on) {
      if (dirt === on) return;
      dirt = on;
      invalidate();
    },
    setReduceMotion(on) {
      reduce = on;
      state.setReduceMotion(on);
      body.setReduceMotion(on);
      invalidate();
    },
    setLive(on) {
      body.setLive(on);
      invalidate();
    },

    setMood(name) { state.setMood(name); },
    flash(name, ms) { state.flash(name, ms); },
    setPose(pose, face = null) { state.setPose(pose, face); },
    lookAt(x, y) { body.lookAt(x, y); invalidate(); },
    perform(name, strength) { return state.perform(name, strength); },
    squish(strength = 1) { body.squish(strength); invalidate(); },
    blink() { body.blink(); invalidate(); },
    stop() { state.stop(); },

    update(dt) {
      if (destroyed) return false;
      const pose = body.update(dt);
      paintBody();
      const easing = paintFace(Number.isFinite(dt) ? Math.max(0, dt) : 0, pose.blink, pose.chew);
      return body.moving || easing;
    },
    settle() {
      if (destroyed) return;
      body.settle();
      faceSnap = true;
      extrasSnap = true;
      paintFace(0, 0, 0);
      paintBody();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      state.destroy();
      object.removeFromParent();
      for (const material of owned.values()) disposeMaterial(material);
      owned.clear();
      (bodyMesh as Mesh | null)?.geometry.dispose();
    },
  };

  paletteId = isPaletteId(options.palette) ? options.palette : 'peach';
  paintPalette();
  hat = options.hat === 'nightcap' || options.hat === 'bow' ? options.hat : null;
  showHat();
  state.setMood('content');
  api.settle();
  return api;
}

/** The eye and mouth shapes the model must carry: every one an expression can ask for. */
export function shapesNeeded(): { eyes: Eyes[]; mouths: Mouth[] } {
  const eyes = new Set<Eyes>();
  const mouths = new Set<Mouth>();
  for (const expression of Object.values(EXPRESSIONS)) { eyes.add(expression.eyes); mouths.add(expression.mouth); }
  return { eyes: [...eyes], mouths: [...mouths] };
}
