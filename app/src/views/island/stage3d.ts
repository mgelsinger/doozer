// The Island's stage: the three.js scene that draws the world (world.ts) and the 3D
// Doozer (character/doozer3d.ts).
//
// THIS FILE IMPORTS three.js. The view (index.ts) loads it with a dynamic `import()` when
// the Island is mounted, and calls `dispose()` when it is left: every geometry, material,
// texture and shadow map is freed and the WebGL context is given up. Nothing here starts
// a frame loop: the view's loop calls `frame(dt, draw)` only while something is moving.
//
// The drawing itself goes through a small `Painter`, so the tests can run this whole file
// without a graphics card.

import {
  AdditiveBlending, Color, DirectionalLight, Group, HemisphereLight, PCFShadowMap, PerspectiveCamera, Scene, Sprite, SpriteMaterial,
  WebGLRenderer, type BufferGeometry, type CanvasTexture, type Material, type Mesh, type MeshStandardMaterial, type Object3D, type Texture,
} from 'three';
import type { PaletteId } from '../../core/contract';
import { createDoozer3D, type Doozer3D, type DoozerModel } from '../../character/doozer3d';
import type { Timers } from '../../character/timers';
import { createProjector, type Projector } from './camera';
import { CAMERA, DOOZER_SCALE, groundY, type IslandLayout } from './layout';
import { buildBall, buildCloud, buildDuck, buildGlyph, buildIsland, buildSnack, disposeTree, mulberry, type Glyph } from './props3d';
import { BALL_RADIUS, type Particle, type PlayToy, type World } from './world';

// ---- the painter ---------------------------------------------------------------------------

export interface PainterInfo {
  geometries: number;
  textures: number;
  programs: number;
}

/** The part of the renderer the stage uses. `createWebGLPainter` is the real one. */
export interface Painter {
  readonly canvas: HTMLCanvasElement;
  /** True between the graphics context being lost and its return. */
  readonly lost: boolean;
  setSize(width: number, height: number, pixelRatio: number): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  /** What is held on the graphics card right now. */
  info(): PainterInfo;
  onLost(handler: () => void): void;
  onRestored(handler: () => void): void;
  /** For the checks: lose the context as a driver reset would, and bring it back. */
  loseContext(): void;
  restoreContext(): void;
  dispose(): void;
}

export function createWebGLPainter(): Painter {
  const canvas = document.createElement('canvas');
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  let lost = false;
  let disposed = false;
  const lostHandlers: (() => void)[] = [];
  const restoredHandlers: (() => void)[] = [];
  // three.js keeps its own listeners for these; ours only pass the news on.
  const onLost = (): void => { if (disposed) return; lost = true; for (const handler of lostHandlers) handler(); };
  const onRestored = (): void => { if (disposed) return; lost = false; for (const handler of restoredHandlers) handler(); };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  // Asked for now: while the context is lost the browser hands out no extensions at all,
  // and this is the one needed to ask for it back.
  const loseContext = renderer.getContext().getExtension('WEBGL_lose_context');

  return {
    canvas,
    get lost() { return lost; },
    setSize(width, height, pixelRatio) {
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height, false);
    },
    render(scene, camera) { if (!lost && !disposed) renderer.render(scene, camera); },
    info: () => ({ geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs?.length ?? 0 }),
    onLost(handler) { lostHandlers.push(handler); },
    onRestored(handler) { restoredHandlers.push(handler); },
    loseContext() { if (!lost) loseContext?.loseContext(); },
    restoreContext() { if (lost) loseContext?.restoreContext(); },
    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      renderer.dispose();
      // Give the context itself back, not just what was drawn with it.
      renderer.forceContextLoss();
      canvas.width = 1;
      canvas.height = 1;
    },
  };
}

// ---- the stage -----------------------------------------------------------------------------

export interface Stage3DOptions {
  world: World;
  model: DoozerModel;
  layout: IslandLayout;
  palette: PaletteId;
  reduceMotion: boolean;
  /** Device pixels per CSS pixel. */
  pixelRatio: number;
  createPainter?: () => Painter;
  timers?: Timers;
  random?: () => number;
  /** Something changed while no frame was being drawn. */
  invalidate(): void;
  onLand?(speed: number): void;
  onContextLost?(): void;
  onContextRestored?(): void;
}

export interface Stage3D {
  /** The element that shows the island. It changes if the painter has to be rebuilt. */
  readonly canvas: HTMLCanvasElement;
  readonly actor: Doozer3D;
  /** The camera as arithmetic, for the drawing's current size. */
  readonly projector: Projector;
  readonly contextLost: boolean;
  resize(layout: IslandLayout, pixelRatio: number): void;
  /** Advance the world and Doozer by `dt` seconds and, if `draw`, draw. True while anything is still moving. */
  frame(dt: number, draw: boolean): boolean;
  /** True when what is moving deserves the full frame rate (not just idle breathing). */
  readonly active: boolean;
  /** Draw now and return the picture as a PNG data URL. */
  capture(): string;
  info(): PainterInfo & { frames: number; objects: number };
  /** Everything in the scene that lives on the graphics card, for the leak checks. */
  resources(): { geometries: BufferGeometry[]; materials: Material[]; textures: Texture[] };
  loseContext(): void;
  restoreContext(): void;
  /** Throw the painter away and make a new one (the context did not come back). */
  rebuild(): HTMLCanvasElement;
  dispose(): void;
}

const DAY = { sky: new Color(0xffffff), ground: new Color(0xffd9c2), key: new Color(0xfff4e6), rim: new Color(0xffc4dc) };
const NIGHT = { sky: new Color(0x9aa8ff), ground: new Color(0x4a5296), key: new Color(0xc8d6ff), rim: new Color(0x7f8cff) };
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function createStage3D(options: Stage3DOptions): Stage3D {
  const { world } = options;
  const makePainter = options.createPainter ?? createWebGLPainter;
  const random = options.random ?? Math.random;
  let painter = makePainter();
  let layout = options.layout;
  let pixelRatio = options.pixelRatio;
  let disposed = false;
  let frames = 0;

  const scene = new Scene();
  const camera = new PerspectiveCamera(CAMERA.fovDeg, layout.sceneWidth / layout.sceneHeight, CAMERA.near, CAMERA.far);
  camera.position.set(...CAMERA.position);
  camera.lookAt(...CAMERA.target);
  let projector = createProjector(CAMERA, layout.sceneWidth, layout.sceneHeight);

  // ---- light: warm by day, cool by night (the mockup's values) ---------------------------
  const hemi = new HemisphereLight(DAY.sky.clone(), DAY.ground.clone(), 2.0);
  const key = new DirectionalLight(DAY.key.clone(), 2.4);
  key.position.set(3.5, 6.5, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 20 });
  key.shadow.radius = 5;
  key.shadow.bias = -0.0012;
  key.shadow.normalBias = 0.03;
  const rim = new DirectionalLight(DAY.rim.clone(), 1.3);
  rim.position.set(-4, 3, -5);
  scene.add(hemi, key, rim);

  // ---- the island and what hangs over it -------------------------------------------------
  const island = buildIsland();
  scene.add(island);
  const clouds = new Group();
  for (const [x, y, z, size] of [[-1.55, 2.62, -1.4, 1.05], [1.75, 2.2, -1.7, 0.72]] as const) {
    const cloud = buildCloud();
    cloud.position.set(x, y, z);
    cloud.scale.setScalar(size);
    clouds.add(cloud);
  }
  scene.add(clouds);
  const rainCloud = buildCloud();
  rainCloud.visible = false;
  scene.add(rainCloud);
  const materialsOf = (root: Object3D): MeshStandardMaterial[] => {
    const found = new Set<MeshStandardMaterial>();
    root.traverse((node) => { if ((node as Mesh).isMesh) found.add((node as Mesh).material as MeshStandardMaterial); });
    return [...found];
  };
  for (const material of materialsOf(rainCloud)) material.color.set(0xdfe6f5);
  const cloudMaterials = materialsOf(clouds);
  const cloudDay = new Color(0xffffff);
  const cloudNight = new Color(0x8f97d6);

  // ---- Doozer ----------------------------------------------------------------------------
  const actor = createDoozer3D(options.model, {
    palette: options.palette,
    reduceMotion: options.reduceMotion,
    timers: options.timers,
    random,
    invalidate: options.invalidate,
    onLand: options.onLand,
  });
  actor.object.scale.setScalar(DOOZER_SCALE);
  scene.add(actor.object);

  // ---- things that come and go -----------------------------------------------------------
  const things = new Group();
  scene.add(things);
  let ball: { toy: PlayToy; mesh: Mesh } | null = null;
  let snack: { serial: number; group: Group } | null = null;
  const duck = buildDuck();
  duck.visible = false;
  things.add(duck);
  const dressing = mulberry(23);

  const glyphs = new Map<Glyph, CanvasTexture>();
  const glyph = (kind: Glyph): CanvasTexture => {
    let texture = glyphs.get(kind);
    if (!texture) { texture = buildGlyph(kind); glyphs.set(kind, texture); }
    return texture;
  };
  const sprite = (kind: Glyph, extra: Partial<ConstructorParameters<typeof SpriteMaterial>[0]> = {}): Sprite =>
    new Sprite(new SpriteMaterial({ map: glyph(kind), transparent: true, depthWrite: false, ...extra }));

  // Crumbs, stars and raindrops: a small pool of sprites, reused.
  const fx = new Group();
  scene.add(fx);
  const pool: Sprite[] = [];
  function drawParticles(particles: readonly Particle[]): void {
    while (pool.length < particles.length) {
      const s = sprite('crumb', { depthTest: false });
      s.renderOrder = 10;
      pool.push(s);
      fx.add(s);
    }
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i] as Sprite;
      const p = particles[i];
      if (!p) { s.visible = false; continue; }
      s.visible = true;
      if (s.material.map !== glyph(p.kind)) { s.material.map = glyph(p.kind); s.material.needsUpdate = true; }
      s.position.set(p.x, p.y, p.z);
      const k = p.life / p.span;
      s.scale.setScalar(p.size * Math.min(1, (1 - k) * 6 + 0.3));
      s.material.opacity = Math.min(1, k * 2.2);
    }
  }

  // Night: a soft dark sky behind the island, the moon, stars and fireflies.
  const night = new Group();
  scene.add(night);
  // The sky fills the drawing exactly and is clear at its edge, so the window's own edge never shows.
  const sky = sprite('sky', { opacity: 0 });
  {
    const depth = -2.6;
    const [cx, cy, cz] = CAMERA.position;
    const [tx, ty, tz] = CAMERA.target;
    const along = (depth - cz) / (tz - cz);
    const reach = Math.hypot(tx - cx, ty - cy, tz - cz) * along;
    const half = reach * Math.tan((CAMERA.fovDeg * Math.PI) / 360);
    sky.position.set(cx + (tx - cx) * along, cy + (ty - cy) * along, depth);
    sky.scale.set(half * 2 * (layout.sceneWidth / layout.sceneHeight), half * 2, 1);
  }
  sky.renderOrder = -5;
  const moon = sprite('moon', { opacity: 0 });
  moon.position.set(0.9, 2.72, -1.5);
  moon.scale.setScalar(0.6);
  night.add(sky, moon);
  const stars = ([[-0.6, 2.78, 0.15], [0.15, 2.42, 0.09], [-1.65, 1.9, 0.12], [1.75, 1.7, 0.1], [1.5, 2.3, 0.11], [-1.0, 2.2, 0.08], [-0.05, 2.98, 0.1]] as const).map(([x, y, size], i) => {
    const s = sprite('star', { opacity: 0 });
    s.position.set(x, y, -1.5);
    s.scale.setScalar(size);
    night.add(s);
    return { s, phase: i * 1.7 };
  });
  const flies = Array.from({ length: 6 }, () => {
    const s = sprite('glow', { opacity: 0, blending: AdditiveBlending });
    s.scale.setScalar(0.2);
    night.add(s);
    return { s, a: dressing() * 6.28, r: 0.9 + dressing() * 0.8, h: 0.5 + dressing() * 1.1, speed: (0.25 + dressing() * 0.35) * (dressing() < 0.5 ? -1 : 1) };
  });
  let nightDrawn = -1;
  let ambientDrawn = -1;

  function drawNight(): void {
    const k = world.night;
    if (k === nightDrawn && world.ambient === ambientDrawn) return;
    const t = world.ambient;
    if (k !== nightDrawn) {
      hemi.color.copy(DAY.sky).lerp(NIGHT.sky, k);
      hemi.groundColor.copy(DAY.ground).lerp(NIGHT.ground, k);
      hemi.intensity = lerp(2.0, 1.35, k);
      key.color.copy(DAY.key).lerp(NIGHT.key, k);
      key.intensity = lerp(2.4, 1.0, k);
      rim.color.copy(DAY.rim).lerp(NIGHT.rim, k);
      for (const material of cloudMaterials) {
        material.color.copy(cloudDay).lerp(cloudNight, k);
        material.emissiveIntensity = lerp(0.35, 0.08, k);
      }
      sky.material.opacity = k;
      moon.material.opacity = k;
      night.visible = k > 0.002;
    }
    nightDrawn = k;
    ambientDrawn = t;
    if (!night.visible) return;
    for (const star of stars) star.s.material.opacity = k * 0.9 * (0.6 + 0.4 * Math.sin(t * 2 + star.phase));
    for (const fly of flies) {
      const a = fly.a + t * fly.speed;
      fly.s.position.set(Math.cos(a) * fly.r, fly.h + Math.sin(t * 1.3 + fly.a) * 0.25, Math.sin(a) * fly.r * 0.6 + 0.4);
      fly.s.material.opacity = k * 0.95 * (0.55 + 0.45 * Math.sin(t * 3 + fly.a * 2));
    }
  }

  function drawThings(): void {
    // The ball (or the yarn): made when the world has one, remade if the toy changed.
    const b = world.ball;
    if (ball && (!b || b.toy !== ball.toy)) {
      things.remove(ball.mesh);
      disposeTree(ball.mesh);
      ball = null;
    }
    if (b) {
      if (!ball) {
        ball = { toy: b.toy, mesh: buildBall(b.toy, BALL_RADIUS) };
        things.add(ball.mesh);
      }
      ball.mesh.position.set(b.x, b.y, b.z);
      ball.mesh.rotation.set(b.rollX, 0, b.rollZ);
    }
    // The snack: a new one each time, shrinking as it is eaten.
    const s = world.snack;
    if (snack && (!s || s.serial !== snack.serial)) {
      things.remove(snack.group);
      disposeTree(snack.group);
      snack = null;
    }
    if (s) {
      if (!snack) {
        const inner = buildSnack(s.food, mulberry(s.serial * 97 + 5));
        const group = new Group();
        group.add(inner);
        group.rotation.y = s.turn;
        snack = { serial: s.serial, group };
        things.add(group);
      }
      snack.group.position.set(s.x, s.y, s.z);
      snack.group.scale.setScalar(Math.max(0.02, s.size));
    }
    // The bath duck and the rain cloud follow Doozer.
    const d = world.doozer;
    duck.visible = world.duck > 0.02;
    if (duck.visible) {
      const side = d.x > 0.2 ? -1 : 1;
      const x = d.x + side * 1.04;
      const z = d.z + 0.28;
      duck.position.set(x, groundY(x, z), z);
      duck.rotation.y = side > 0 ? Math.PI * 0.85 : Math.PI * 0.15;
      duck.scale.setScalar(Math.max(0.02, world.duck));
    }
    rainCloud.visible = world.rain > 0.02;
    if (rainCloud.visible) {
      rainCloud.position.set(d.x, groundY(d.x, d.z) + 1.75 * DOOZER_SCALE + 0.5, d.z - 0.3);
      rainCloud.scale.setScalar(1.25 * world.rain);
    }
    drawParticles(world.particles);
  }

  function size(): void {
    painter.setSize(layout.sceneWidth, layout.sceneHeight, pixelRatio);
    camera.aspect = layout.sceneWidth / layout.sceneHeight;
    camera.updateProjectionMatrix();
    projector = createProjector(CAMERA, layout.sceneWidth, layout.sceneHeight);
  }

  function listen(): void {
    painter.onLost(() => { if (!disposed) options.onContextLost?.(); });
    painter.onRestored(() => {
      if (disposed) return;
      // Everything is uploaded again on the next frame; the shadow map has to be told.
      key.shadow.needsUpdate = true;
      options.onContextRestored?.();
    });
  }

  function frame(dt: number, draw: boolean): boolean {
    if (disposed) return false;
    world.update(dt, actor.body);
    const d = world.doozer;
    actor.object.position.set(d.x, groundY(d.x, d.z), d.z);
    const moving = actor.update(dt);
    if (draw) {
      drawThings();
      drawNight();
      painter.render(scene, camera);
      frames++;
    }
    return moving || world.moving;
  }

  size();
  listen();
  drawThings();
  drawNight();

  return {
    get canvas() { return painter.canvas; },
    actor,
    get projector() { return projector; },
    get contextLost() { return painter.lost; },
    get active() { return world.moving || actor.body.active || actor.busy; },
    resize(next, ratio) {
      layout = next;
      pixelRatio = ratio;
      size();
    },
    frame,
    capture() {
      frame(0, true);
      return painter.canvas.toDataURL('image/png');
    },
    info() {
      let objects = 0;
      scene.traverse(() => { objects++; });
      return { ...painter.info(), frames, objects };
    },
    resources() {
      const geometries = new Set<BufferGeometry>();
      const materials = new Set<Material>();
      const textures = new Set<Texture>(glyphs.values());
      scene.traverse((node) => {
        const item = node as Mesh;
        if (item.geometry) geometries.add(item.geometry);
        for (const material of Array.isArray(item.material) ? item.material : item.material ? [item.material] : []) {
          materials.add(material);
          for (const value of Object.values(material)) if (value && typeof value === 'object' && (value as Texture).isTexture) textures.add(value as Texture);
        }
      });
      return { geometries: [...geometries], materials: [...materials], textures: [...textures] };
    },
    loseContext() { painter.loseContext(); },
    restoreContext() { painter.restoreContext(); },
    rebuild() {
      painter.dispose();
      painter = makePainter();
      size();
      listen();
      nightDrawn = -1;
      return painter.canvas;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      actor.destroy();
      const all: Object3D[] = [island, clouds, rainCloud, things, fx, night];
      for (const root of all) { scene.remove(root); disposeTree(root); }
      for (const texture of glyphs.values()) texture.dispose();
      glyphs.clear();
      key.shadow.dispose();
      rim.shadow.dispose();
      scene.clear();
      painter.dispose();
    },
  };
}
