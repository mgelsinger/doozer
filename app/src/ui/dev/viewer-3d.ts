// Development viewer, part 3 (Phase 8): the 3D Doozer beside the 2D rig. One design, two
// renderings (DESIGN_SPEC.md section 7): same proportions, same face, same tuft, same
// expression names. This page is where that is checked by eye.
//
// THIS FILE IMPORTS three.js; viewer.ts loads it with a dynamic import, so the rest of the
// viewer does not pay for it. Nothing here ships in the app.
//
// Every still is drawn by one renderer and copied onto the tile's own small canvas, and
// every strip of frozen moments is stepped by hand, never by an animation frame: a
// browser pane that is not visible runs no frames, and the page must still come out right.

import { AmbientLight, DirectionalLight, HemisphereLight, OrthographicCamera, PerspectiveCamera, Scene, WebGLRenderer, type Camera } from 'three';
import modelUrl from '../../../assets/doozer/doozer.glb?url';
import type { HatId, PaletteId } from '../../core/contract';
import {
  EXPRESSION_NAMES, PALETTES, PALETTE_IDS, PERFORMANCE_NAMES, PERFORMANCES, POSES, VIEW_BOX, GROUND_Y, createDoozer,
  type Doozer, type ExpressionName, type PerformanceName, type Pose, type Timers,
} from '../../character';
import { createDoozer3D, loadDoozerModel, type Doozer3D, type DoozerModel } from '../../character/doozer3d';
import { el, section, type ViewerControls } from './viewer-rig';

type Cleanup = () => void;

/** One unit of the model is this many pixels of the 2D rig's drawing. */
const UNIT = 100;
/** The 2D rig's 200 x 200 drawing, in model units: what a front-on camera has to frame to match it. */
const FRAME = {
  left: -VIEW_BOX / 2 / UNIT, right: VIEW_BOX / 2 / UNIT,
  bottom: -(VIEW_BOX - GROUND_Y) / UNIT, top: GROUND_Y / UNIT,
};

/** Timers that only move when told to, so a performance can be frozen at any moment. */
function manualTimers(): Timers & { advance(ms: number): void } {
  let now = 0;
  let nextId = 0;
  const queue = new Map<number, { at: number; fn: () => void }>();
  return {
    set(fn, ms) { queue.set(++nextId, { at: now + Math.max(0, ms), fn }); return nextId; },
    clear(handle) { queue.delete(handle as number); },
    advance(ms) {
      const target = now + ms;
      for (;;) {
        let due: [number, { at: number; fn: () => void }] | null = null;
        for (const entry of queue) if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry;
        if (!due) break;
        queue.delete(due[0]);
        now = due[1].at;
        due[1].fn();
      }
      now = target;
    },
  };
}

interface Studio {
  /** Draw `doozer` with `camera` at `size` CSS pixels square and return the picture on a canvas of its own. */
  shoot(doozer: Doozer3D, camera: Camera, size: number, into?: HTMLCanvasElement): HTMLCanvasElement;
  front: OrthographicCamera;
  turned(yawDeg: number, pitchDeg: number): PerspectiveCamera;
  dispose(): void;
}

function createStudio(): Studio {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setClearColor(0x000000, 0);
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const scene = new Scene();
  // The Island's daylight, so the model is judged in the light it is seen in.
  const hemi = new HemisphereLight(0xffffff, 0xffd9c2, 2.0);
  const key = new DirectionalLight(0xfff4e6, 2.2);
  key.position.set(3.5, 6.5, 5);
  const rim = new DirectionalLight(0xffc4dc, 1.0);
  rim.position.set(-4, 3, -5);
  scene.add(hemi, key, rim, new AmbientLight(0xffffff, 0.15));

  const front = new OrthographicCamera(FRAME.left, FRAME.right, FRAME.top, FRAME.bottom, 0.1, 30);
  front.position.set(0, 0, 8);

  return {
    front,
    turned(yawDeg, pitchDeg) {
      const camera = new PerspectiveCamera(22, 1, 0.1, 40);
      const yaw = (yawDeg * Math.PI) / 180;
      const pitch = (pitchDeg * Math.PI) / 180;
      const distance = 5.4;
      const target = (FRAME.top + FRAME.bottom) / 2;
      camera.position.set(Math.sin(yaw) * Math.cos(pitch) * distance, target + Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance);
      camera.lookAt(0, target, 0);
      return camera;
    },
    shoot(doozer, camera, size, into) {
      const pixels = Math.round(size * ratio);
      renderer.setPixelRatio(1);
      renderer.setSize(pixels, pixels, false);
      scene.add(doozer.object);
      renderer.render(scene, camera);
      scene.remove(doozer.object);
      const canvas = into ?? document.createElement('canvas');
      canvas.width = pixels;
      canvas.height = pixels;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      canvas.className = 'vw-3d';
      const g = canvas.getContext('2d');
      g?.clearRect(0, 0, pixels, pixels);
      g?.drawImage(renderer.domElement, 0, 0);
      return canvas;
    },
    dispose() {
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

export function mount3D(host: HTMLElement, controls: ViewerControls): Cleanup {
  const intro = section('three-d', '2D and 3D, side by side',
    'One design, two renderings. On each tile the drawn Doozer (left) and the modelled one (right), framed alike: the model is seen square-on by a camera that takes in exactly the 200 by 200 drawing. Loading three.js and the model…');
  host.append(intro.root);
  const cleanups: Cleanup[] = [() => intro.root.remove()];
  let gone = false;
  cleanups.push(() => { gone = true; });

  void loadDoozerModel(modelUrl).then((model) => {
    if (gone) { model.dispose(); return; }
    try {
      build(host, intro, model, controls, cleanups);
    } catch (error) {
      intro.body.append(el('p', {}, [`The 3D Doozer could not be shown: ${String(error)}`]));
      model.dispose();
    }
  }, (error: unknown) => {
    intro.body.append(el('p', {}, [`The model could not be loaded: ${String(error)}`]));
  });

  return () => { for (const cleanup of cleanups.splice(0).reverse()) cleanup(); };
}

function build(host: HTMLElement, intro: ReturnType<typeof section>, model: DoozerModel, controls: ViewerControls, cleanups: Cleanup[]): void {
  const studio = createStudio();
  cleanups.push(() => { studio.dispose(); model.dispose(); });
  const size = Math.max(112, controls.size);
  const rigs: Doozer[] = [];
  const models: Doozer3D[] = [];
  cleanups.push(() => { for (const rig of rigs.splice(0)) rig.destroy(); for (const m of models.splice(0)) m.destroy(); });

  /** A 3D Doozer that stands still: no idle loops, everything snapped into place. */
  const still = (options: Parameters<typeof createDoozer3D>[1] = {}): Doozer3D => {
    const doozer = createDoozer3D(model, { palette: controls.palette, ...options });
    doozer.setLive(false);
    doozer.settle();
    models.push(doozer);
    return doozer;
  };
  const drawn = (options: Parameters<typeof createDoozer>[0] = {}): Doozer => {
    const rig = createDoozer({ palette: controls.palette, style: controls.style, size, reduceMotion: controls.reduceMotion, ...options });
    rig.setLive(false);
    rigs.push(rig);
    return rig;
  };
  interface Look { mood?: ExpressionName; palette?: PaletteId; hat?: HatId | null; glasses?: boolean; dirt?: boolean }
  const one = still();
  /** A pair: the 2D rig and the model in the same state, framed the same way. */
  const pair = (caption: string, look: Look, px = size): HTMLElement => {
    const rig = drawn({ palette: look.palette ?? controls.palette, size: px });
    rig.setMood(look.mood ?? 'content');
    rig.setHat(look.hat ?? null);
    rig.setGlasses(look.glasses ?? false);
    rig.setDirt(look.dirt ?? false);
    one.setPalette(look.palette ?? controls.palette);
    one.setMood(look.mood ?? 'content');
    one.setHat(look.hat ?? null);
    one.setGlasses(look.glasses ?? false);
    one.setDirt(look.dirt ?? false);
    one.settle();
    const picture = studio.shoot(one, studio.front, px);
    return el('div', { class: 'vw-tile' }, [el('div', { class: 'vw-pair' }, [rig.el, picture]), el('div', { class: 'vw-cap' }, [caption])]);
  };

  // ---- every expression ---------------------------------------------------------------
  intro.root.querySelector('p')?.replaceChildren(
    'One design, two renderings. On each tile the drawn Doozer (left) and the modelled one (right), framed alike: the model is seen square-on by a camera that takes in exactly the 200 by 200 drawing, so the two can be compared feature for feature. The eyes and mouths are the model\'s shape keys, chosen by the same table of expressions the drawing uses.');
  const faces = el('div', { class: 'vw-grid vw-bg' });
  for (const name of EXPRESSION_NAMES) faces.append(pair(name, { mood: name }));
  intro.body.append(faces);

  // ---- laid over one another ------------------------------------------------------------
  const overlay = section('three-d-overlay', 'Proportions: one laid over the other',
    'The drawing at half strength on top of the model, both at 320 px. Where they agree, outlines, ears, eyes, cheeks, mouth and tuft sit on one another. (The drawn tail and feet are flat shapes placed for the front view; the model\'s are solid and sit a little differently.)');
  const laid = el('div', { class: 'vw-grid vw-bg' });
  for (const [caption, mood] of [['content', 'content'], ['joyful', 'joyful'], ['sleepy', 'sleepy'], ['wow', 'wow']] as const) {
    const rig = drawn({ size: 320, style: 'bold' });
    rig.setMood(mood);
    one.setPalette(controls.palette); one.setMood(mood); one.setHat(null); one.setGlasses(false); one.setDirt(false); one.settle();
    const picture = studio.shoot(one, studio.front, 320);
    rig.el.style.cssText += 'position:absolute;left:0;top:0;opacity:.5;';
    const stack = el('div', {}, [picture, rig.el]);
    stack.style.cssText = 'position:relative;width:320px;height:320px;';
    laid.append(el('div', { class: 'vw-tile' }, [stack, el('div', { class: 'vw-cap' }, [caption])]));
  }
  overlay.body.append(laid);
  host.append(overlay.root);
  cleanups.push(() => overlay.root.remove());

  // ---- palettes, hats, glasses, grime ---------------------------------------------------
  const colours = section('three-d-palettes', 'Palettes, hats, glasses and grime',
    'The five palettes are parameters of the model\'s materials (the body\'s belly is a mask painted into its vertices), set from the same table as the drawing.');
  const swatches = el('div', { class: 'vw-grid vw-bg' });
  for (const id of PALETTE_IDS) swatches.append(pair(PALETTES[id].name, { palette: id, mood: 'content' }));
  swatches.append(
    pair('nightcap (asleep)', { mood: 'asleep', hat: 'nightcap' }),
    pair('bow', { mood: 'joyful', hat: 'bow' }),
    pair('glasses (focus)', { mood: 'focus' }),
    pair('glasses, a need urgent', { mood: 'hungry', glasses: true }),
    pair('grubby but happy', { mood: 'joyful', dirt: true }),
  );
  colours.body.append(swatches);
  host.append(colours.root);
  cleanups.push(() => colours.root.remove());

  // ---- all the way round ------------------------------------------------------------------
  const round = section('three-d-angles', 'All the way round',
    'The model from other sides, which the drawing cannot show: it is one solid creature, not a front with a back painted on.');
  const angles = el('div', { class: 'vw-grid vw-bg' });
  one.setPalette(controls.palette); one.setMood('content'); one.setHat(null); one.setGlasses(false); one.setDirt(false); one.settle();
  for (const [caption, yaw, pitch] of [['front', 0, 6], ['three-quarter', 35, 12], ['side', 90, 6], ['from behind', 150, 12], ['back', 180, 6], ['from above', 20, 50]] as const) {
    angles.append(el('div', { class: 'vw-tile' }, [studio.shoot(one, studio.turned(yaw, pitch), 190), el('div', { class: 'vw-cap' }, [caption])]));
  }
  for (const [caption, hat, mood] of [['nightcap, three-quarter', 'nightcap', 'asleep'], ['bow, three-quarter', 'bow', 'joyful']] as const) {
    one.setHat(hat); one.setMood(mood); one.settle();
    angles.append(el('div', { class: 'vw-tile' }, [studio.shoot(one, studio.turned(-32, 12), 190), el('div', { class: 'vw-cap' }, [caption])]));
  }
  round.body.append(angles);
  host.append(round.root);
  cleanups.push(() => round.root.remove());

  // ---- frozen moments: the spring, the hop, every one-shot -----------------------------------
  const frozen = section('three-d-frames', 'Squash and stretch, frame by frame',
    'The Island\'s body is a spring, not keyframes (as in the mockup the owner liked). Each strip is the model stepped by hand to the moments shown, so it can be judged without watching it move.');
  const strip = (title: string, moments: readonly number[], start: (doozer: Doozer3D, timers: ReturnType<typeof manualTimers>) => void, camera: Camera = studio.turned(18, 10)): void => {
    const timers = manualTimers();
    const doozer = createDoozer3D(model, { palette: controls.palette, timers });
    models.push(doozer);
    doozer.setLive(false);
    doozer.settle();
    start(doozer, timers);
    const row = el('div', { class: 'vw-grid vw-bg vw-strip' });
    let at = 0;
    for (const moment of moments) {
      // Small steps, so the spring is integrated as it would be on screen.
      while (at < moment) {
        const step = Math.min(1000 / 120, moment - at);
        timers.advance(step);
        doozer.update(step / 1000);
        at += step;
      }
      row.append(el('div', { class: 'vw-tile' }, [studio.shoot(doozer, camera, 132), el('div', { class: 'vw-cap' }, [`${moment} ms`])]));
    }
    frozen.body.append(el('div', { class: 'vw-cap vw-strip-cap' }, [title]), row);
  };
  strip('a poke', [0, 40, 90, 150, 220, 300, 420, 600, 900], (d) => d.squish(1));
  strip('held under a finger, then let go at 400 ms', [0, 80, 200, 400, 440, 500, 580, 700, 1000], (d, t) => { d.body.press(true); t.set(() => d.body.press(false), 400); });
  strip('a hop', [0, 60, 140, 230, 330, 420, 470, 540, 700], (d) => { d.body.hop(3.4); });
  for (const name of PERFORMANCE_NAMES) {
    const duration = PERFORMANCES[name].duration;
    const moments = [0, 0.12, 0.25, 0.4, 0.55, 0.7, 0.85, 1, 1.25].map((f) => Math.round(duration * f));
    strip(`${name} (${duration} ms; the last tile is after it has ended)`, moments, (d) => {
      if (name === 'wake' || name === 'stir') { d.setMood('asleep'); d.settle(); if (name === 'wake') d.setMood('content'); }
      if (name === 'fall-asleep') d.setMood('asleep');
      void d.perform(name as PerformanceName);
    });
  }
  host.append(frozen.root);
  cleanups.push(() => frozen.root.remove());

  // ---- poses, held ---------------------------------------------------------------------------
  const held = section('three-d-poses', 'Poses',
    'Each looping pose a moment into its loop. The same names as the drawing\'s; the Island uses idle, settle, sulk, drowsy, sleep, hop, eat, play, shake, no and wave.');
  const poses = el('div', { class: 'vw-grid vw-bg' });
  const moods: Partial<Record<Pose, ExpressionName>> = { sulk: 'hungry', drowsy: 'sleepy', sleep: 'asleep', settle: 'focus', eat: 'eat', hop: 'cheer', play: 'cheer', shake: 'shake', no: 'no', wave: 'joyful' };
  for (const pose of POSES) {
    if (pose === 'none') continue;
    const timers = manualTimers();
    const doozer = createDoozer3D(model, { palette: controls.palette, timers });
    models.push(doozer);
    doozer.setMood(moods[pose] ?? 'content');
    doozer.settle();
    doozer.setPose(pose);
    for (let t = 0; t < 640; t += 1000 / 120) { timers.advance(1000 / 120); doozer.update(1 / 120); }
    poses.append(el('div', { class: 'vw-tile' }, [studio.shoot(doozer, studio.turned(18, 10), 150), el('div', { class: 'vw-cap' }, [pose])]));
  }
  held.body.append(poses);
  host.append(held.root);
  cleanups.push(() => held.root.remove());

  // ---- live ---------------------------------------------------------------------------------
  const live = section('three-d-live', 'Live',
    'One modelled Doozer, drawn only while it is moving. Press a button; "Step 100 ms" moves it by hand when the page is not being drawn.');
  const actor = createDoozer3D(model, { palette: controls.palette });
  models.push(actor);
  actor.setLive(controls.live);
  const view = studio.shoot(actor, studio.turned(18, 10), 300);
  const camera = studio.turned(18, 10);
  let frame = 0;
  let last = performance.now();
  let running = true;
  const draw = (): void => { studio.shoot(actor, camera, 300, view); };
  const loop = (): void => {
    if (!running) return;
    const now = performance.now();
    const moving = actor.update(Math.min(0.05, (now - last) / 1000));
    last = now;
    if (moving) draw();
    frame = requestAnimationFrame(loop);
  };
  frame = requestAnimationFrame(loop);
  cleanups.push(() => { running = false; cancelAnimationFrame(frame); });
  const button = (label: string, fn: () => void): HTMLButtonElement => {
    const b = el('button', { type: 'button', textContent: label });
    b.addEventListener('click', fn);
    return b;
  };
  const tools = el('div', { class: 'vw-tools' }, [
    button('Poke', () => actor.squish(1)),
    button('Hop', () => void actor.body.hop(3.4)),
    button('Blink', () => actor.blink()),
    ...PERFORMANCE_NAMES.map((name) => button(name, () => void actor.perform(name))),
    button('Step 100 ms', () => { for (let i = 0; i < 12; i++) actor.update(1 / 120); draw(); }),
  ]);
  const faceTools = el('div', { class: 'vw-tools' }, EXPRESSION_NAMES.map((name) => button(name, () => { actor.setMood(name); })));
  view.addEventListener('pointerdown', () => { actor.body.press(true); actor.squish(0.55); });
  for (const type of ['pointerup', 'pointerleave', 'pointercancel'] as const) view.addEventListener(type, () => actor.body.press(false));
  view.addEventListener('pointermove', (event) => {
    const box = view.getBoundingClientRect();
    actor.lookAt(((event.clientX - box.left) / box.width - 0.5) * 2.4, (0.45 - (event.clientY - box.top) / box.height) * 2.4);
  });
  view.style.cursor = 'pointer';
  live.body.append(tools, faceTools, el('div', { class: 'vw-bg' }, [view]));
  host.append(live.root);
  cleanups.push(() => live.root.remove());
}
