// The Island view: the one you touch (DESIGN_SPEC.md 6.3). A soft 3D Doozer on a small
// floating island in a frameless, transparent window. Stroke it to pet it, click it to
// poke it and open the Radial, click the ball to bop it; snacks drop out of the sky and
// night falls when it sleeps.
//
// The view draws and forwards clicks. Every rule is the brain's; the window, the save and
// the clock are the host's (src/host/). three.js is loaded here, on mount, with a dynamic
// import, and given back on unmount (stage3d.ts).
//
// Never stuck, by construction rather than by repair:
//   - What is open is one variable mirrored in one attribute. Nothing waits for an
//     animation or a frame: scenes are timed by timers (director.ts), and the frame loop
//     falls back to a timer when frames do not come (loop.ts).
//   - A press on Doozer ends on pointerup, pointercancel, lost capture, the pointer
//     leaving, a move with no button held, the shell's `pointer-released`, and in any case
//     after a few seconds.
//   - Everything temporary has a named timer behind it, and `snapshot().timers` lists the
//     ones that are armed. Tucked away (`setAwake(false)`), that list is empty.
//   - A lost graphics context is waited for briefly, then the renderer is rebuilt; if
//     that fails too, Doozer goes back to the first view rather than sit on a dead canvas.
//
// Render on demand: at rest nothing is drawn. Doozer breathes, looks about and wanders
// only while `Attention` says someone is there or something just happened; otherwise the
// island is a still picture that blinks now and then.

import './island.css';
import modelUrl from '../../../assets/doozer/doozer.glb?url';
import type { SizeId, ViewId } from '../../core/contract';
import type { DoozerModel } from '../../character/doozer3d';
import { realTimers, type Timers } from '../../character/timers';
import type { View, ViewContext, WindowRequest } from '../../host/view';
import type { Region, WindowInfo, WindowMode } from '../../shell';
import { createCard, type Card } from '../../ui/card';
import { createMemo, h } from '../../ui/dom';
import { createEmoteLayer } from '../../ui/emotes';
import { createFocusChip } from '../../ui/focus-chip';
import { ICONS } from '../../ui/icons';
import { Scope } from '../../ui/lifecycle';
import { watchReduceMotion } from '../../ui/motion';
import { createRadial, type Radial } from '../../ui/radial';
import { createSettingsPanel, type SettingsPanel } from '../../ui/settings';
import { Attention } from '../pill/attention';
import { IslandDirector } from './director';
import { PANEL_MARGIN, islandLayout, islandWindow, panelTop, type IslandLayout } from './layout';
import { FrameLoop } from './loop';
import { ballRegion, doozerPoints, doozerRegions, islandSilhouette, pick, slabs, type Picked } from './regions';
import type { Painter, Stage3D } from './stage3d';
import { World } from './world';

type StageModule = typeof import('./stage3d');

export interface IslandViewOptions {
  timers?: Timers;
  random?: () => number;
  /** Milliseconds, monotonic. Default `performance.now`. */
  now?: () => number;
  /** Loads three.js and the model. Default: a dynamic import and a fetch, made on mount. */
  load?: () => Promise<{ stage: StageModule; model: DoozerModel }>;
  /** For tests: something that stands in for the WebGL renderer. */
  createPainter?: () => Painter;
  requestFrame?: (callback: () => void) => unknown;
  cancelFrame?: (handle: unknown) => void;
  pixelRatio?: () => number;
}

export type IslandOpen = 'none' | 'card' | 'settings';

/** What the view is doing right now. For tests and the scripted runs; nothing depends on it. */
export interface IslandSnapshot {
  open: IslandOpen;
  awake: boolean;
  /** Doozer is breathing and looking about (someone is there, or something just happened). */
  lively: boolean;
  /** The frame loop is running. */
  drawing: boolean;
  pressed: boolean;
  hover: boolean;
  /** Doozer is popped out for a window change. */
  gone: boolean;
  radial: boolean;
  /** The scene the director is playing, or null. */
  scene: string | null;
  /** Doozer is in the middle of a face or a performance. */
  busy: boolean;
  mood: string;
  showing: string;
  /** Anything on the island still moving. */
  moving: boolean;
  /** Doozer: where on the island, how high, and where that is in the window. */
  doozer: { x: number; z: number; y: number; stretch: number; screen: { x: number; y: number } };
  ball: { x: number; y: number; z: number; resting: boolean; screen: { x: number; y: number } } | null;
  snack: string | null;
  particles: number;
  night: number;
  emotes: number;
  /** The graphics context is lost and has not come back yet. */
  contextLost: boolean;
  rebuilds: number;
  /** Frames drawn, and steps taken without drawing, since mount. */
  frames: number;
  undrawn: number;
  /** The view's own timers that are armed. Tucked away, this must be empty. */
  timers: string[];
}

export interface IslandView extends View {
  /** Null when not mounted. */
  snapshot(): IslandSnapshot | null;
  setOpen(open: IslandOpen): void;
  /** The pieces, for tests and the scripted runs. Null when not mounted. (`card` and `settings` are made when first asked for.) */
  parts(): { root: HTMLElement; scene: HTMLElement; touch: HTMLElement; grip: HTMLElement; radial: Radial; card: Card; settings: SettingsPanel; stage: Stage3D; world: World } | null;
  /** Take `ms` of frames now, without waiting for the screen (tests, and stills from a page that is not being drawn). */
  advance(ms: number): void;
}

const ALL_VIEWS: readonly ViewId[] = ['pill', 'room', 'island', 'desktop'];
/** The loading of three.js and the model may take this long before the view gives up. */
export const LOAD_LIMIT_MS = 8000;
/** A lost graphics context is given this long to come back before the renderer is rebuilt. */
export const CONTEXT_LIMIT_MS = 2500;
const ACTIVE_FPS = 60;
const AMBIENT_FPS = 30;
/** How long Doozer stays lively after something happened, and after the pointer was last seen resting here. */
const EVENT_MS = 6000;
const HOVER_MS = 3500;
/** The pointer has to stay this long before it counts as a visit rather than a crossing. */
const DWELL_MS = 180;
const VISIT_GAP_MS = 600;
/** Stroking this far across Doozer is one pet, at most this often (as on the Card). */
const STROKE_PX = 130;
const STROKE_GAP_MS = 600;
/** A press that moved less than this is a click. */
const CLICK_SLOP_PX = 8;
const DOUBLE_PRESS_MS = 320;
const HOVER_LIMIT_MS = 4000;
export const PRESS_LIMIT_MS = 6000;
const GONE_LIMIT_MS = 1500;
const DRAG_LIMIT_MS = 30_000;
/** Hit regions follow Doozer and the ball at most this often while they move. */
const REGIONS_MS = 90;
/** With nobody there: a blink this often, a firefly's wink this often asleep, and a small stir this often. */
const BLINK_MIN_MS = 4000;
const BLINK_SPREAD_MS = 5000;
const WINK_MS = 2600;
const STIR_MIN_MS = 50_000;
const STIR_SPREAD_MS = 60_000;
/** With someone there: Doozer does something of its own this often. */
const WANDER_MIN_MS = 2200;
const WANDER_SPREAD_MS = 2600;
/** The Radial as the kit lays it out: its radius and its buttons, in CSS pixels. */
const RADIAL = { radius: 94, button: 50, centre: -90, span: 200, count: 6 } as const;
const PANEL_WIDTH = 320;
const PANEL_FALLBACK_HEIGHT = 540;

const defaultLoad = async (): Promise<{ stage: StageModule; model: DoozerModel }> => {
  // The only place three.js enters the app.
  const [stage, rig] = await Promise.all([import('./stage3d'), import('../../character/doozer3d')]);
  return { stage, model: await rig.loadDoozerModel(modelUrl) };
};

function withLimit<T>(promise: Promise<T>, ms: number, timers: Timers, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const limit = timers.set(() => reject(new Error(`${what} took longer than ${ms} ms`)), ms);
    promise.then(
      (value) => { timers.clear(limit); resolve(value); },
      (error: unknown) => { timers.clear(limit); reject(error instanceof Error ? error : new Error(String(error))); },
    );
  });
}

export function createIslandView(options: IslandViewOptions = {}): IslandView {
  const timers = options.timers ?? realTimers;
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => performance.now());
  const load = options.load ?? defaultLoad;
  const requestFrame = options.requestFrame ?? ((callback: () => void) => requestAnimationFrame(callback));
  const cancelFrame = options.cancelFrame ?? ((handle: unknown) => cancelAnimationFrame(handle as number));
  const pixelRatio = options.pixelRatio ?? (() => Math.min(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1, 2));

  /** Everything that exists only while mounted. */
  let live: Mounted | null = null;
  /** Goes up with every mount and unmount, so a load that finishes late knows it is not wanted. */
  let generation = 0;
  /** What a view under construction has made so far, so that a failure half-way leaves nothing behind. */
  let building: Scope | null = null;

  interface Mounted {
    hitRegions(): Region[];
    leave(): Promise<unknown>;
    enter(): Promise<unknown>;
    setAwake(awake: boolean): void;
    windowChanged(info: WindowInfo): void;
    openSettings(): void;
    setOpen(open: IslandOpen): void;
    snapshot(): IslandSnapshot;
    parts(): NonNullable<ReturnType<IslandView['parts']>>;
    advance(ms: number): void;
    unmount(): void;
  }

  function build(host: HTMLElement, context: ViewContext, loaded: { stage: StageModule; model: DoozerModel }): Mounted {
    const { brain, shell } = context;
    const services = context.host;
    const scope = new Scope();
    building = scope;
    const memo = createMemo();
    /** Named timers, so that "nothing is running" can be checked. */
    const armed = new Map<string, unknown>();
    const disarm = (name: string): void => {
      if (armed.has(name)) timers.clear(armed.get(name));
      armed.delete(name);
    };
    const arm = (name: string, ms: number, fn: () => void): void => {
      disarm(name);
      if (scope.disposed) return;
      armed.set(name, timers.set(() => { armed.delete(name); fn(); }, ms));
    };
    scope.add(() => { for (const name of [...armed.keys()]) disarm(name); });

    // ---- state ---------------------------------------------------------------------
    let layout: IslandLayout = islandLayout(brain.settings.size.island);
    let info = context.info;
    let open: IslandOpen = 'none';
    let settingsFrom: IslandOpen = 'none';
    let awake = true;
    let gone = false;
    let hover = false;
    let dragging = false;
    let rebuilds = 0;
    let missedCelebration = false;
    /** A press that started on Doozer: how far it has moved, and whether it turned into a stroke. */
    let press: { moved: number; stroked: boolean; held: boolean; pointer: number } | null = null;
    let outline: Region[] = [];
    let regionsAt = -Infinity;
    let regionsDirty = false;

    // ---- the frame loop: only while something moves ------------------------------------
    let stage: Stage3D | null = null;
    const loop = new FrameLoop({
      step: (seconds, draw) => {
        if (!stage || scope.disposed || !awake) return false;
        const moving = stage.frame(seconds, draw);
        follow();
        if (!moving) flushRegions();
        return moving;
      },
      fps: () => (stage?.active ? ACTIVE_FPS : AMBIENT_FPS),
      requestFrame,
      cancelFrame,
      timers,
      now,
    });
    scope.add(() => loop.destroy());
    const wake = (): void => { if (awake) loop.wake(); };

    // ---- the world and the stage -------------------------------------------------------
    const world = new World({ random, invalidate: wake });
    const theStage = loaded.stage.createStage3D({
      world,
      model: loaded.model,
      layout,
      palette: brain.settings.palette,
      reduceMotion: false,
      pixelRatio: pixelRatio(),
      createPainter: options.createPainter,
      timers,
      random,
      invalidate: wake,
      onContextLost: () => contextLost(),
      onContextRestored: () => contextRestored(),
    });
    stage = theStage;
    // Newest first: the stage goes before the model it was made from.
    scope.add(() => loaded.model.dispose());
    scope.add(() => { stage = null; theStage.dispose(); });
    const actor = theStage.actor;

    // ---- elements ----------------------------------------------------------------------
    const touch = h('div', { class: 'islv-touch', 'data-radial-toggle': true });
    const emotes = createEmoteLayer({ timers, random, max: 12, origin: { x: 0.5, y: 0.42, spreadX: 0.2, spreadY: 0.1 } });
    scope.add(() => emotes.destroy());
    const emoteBox = h('div', { class: 'islv-emotes', 'aria-hidden': 'true' }, [emotes.el]);
    const grip = h('button', { type: 'button', class: 'islv-grip', 'aria-label': 'Move the island', tabindex: '-1' });
    const chip = createFocusChip(brain);
    scope.add(() => chip.destroy());
    const chipBox = h('div', { class: 'islv-chip' }, [chip.el]);
    const scene = h('div', { class: 'islv-scene' }, [theStage.canvas, touch, emoteBox, grip, chipBox]);
    const close = h('button', { type: 'button', class: 'islv-close', 'aria-label': 'Back to the island', html: ICONS.close });
    const panel = h('div', { class: 'islv-panel' });
    const root = h('div', { class: 'dzk islv', 'data-open': 'none', 'data-size': layout.size }, [scene, panel]);

    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): void => {
      target.addEventListener(type, handler);
      scope.add(() => target.removeEventListener(type, handler));
    };

    // ---- liveliness ----------------------------------------------------------------------
    // Declared before the director, so that when the brain announces something the view
    // is already lively by the time the director reacts to it.
    let director: IslandDirector | null = null;
    let card: Card | null = null;
    const attention = new Attention({
      timers,
      now,
      onChange: (lively) => {
        actor.setLive(lively);
        world.setLively(lively);
        director?.setLively(lively);
        card?.setLively(lively);
        syncTimers();
        wake();
      },
    });
    scope.add(() => attention.destroy());
    scope.add(brain.on('action', () => attention.poke(EVENT_MS)));
    scope.add(brain.on('refuse', () => attention.poke(2500)));
    scope.add(brain.on('mood', () => { if (!brain.state.quiet) attention.poke(3000); }));
    scope.add(brain.on('away', () => attention.poke(4000)));
    scope.add(brain.on('focus', (event) => {
      if (event.type !== 'start' && event.type !== 'complete') return;
      attention.poke(EVENT_MS);
      if (event.type !== 'complete') return;
      // Spec 4.5: Doozer celebrates; optionally the Card opens. Never keyboard focus.
      if (!awake) { missedCelebration = true; return; }
      if (brain.settings.onFocusEnd === 'open-card') setOpen('card');
    }));

    // ---- Doozer's scenes -------------------------------------------------------------------
    const theDirector = new IslandDirector(brain, actor, world, {
      emote: (kind, emoteOptions) => {
        placeEmotes();
        emotes.emit(kind, emoteOptions);
      },
    }, { timers, random });
    director = theDirector;
    scope.add(() => theDirector.destroy());
    scope.add(brain.on('change', () => { syncTimers(); wake(); }));

    // ---- the Radial, the Card and the settings panel -----------------------------------------
    const radial = createRadial(brain, {
      timers,
      onMore: () => setOpen('card'),
      onOpenChange: (isOpen) => {
        if (isOpen) placeRadial();
        root.dataset.radial = isOpen ? '1' : '0';
        services.regionsChanged();
      },
    });
    scope.add(() => radial.destroy());
    scene.append(radial.el);

    // The Card and the settings panel are only made when one of them is first opened, and
    // are taken down again when the view is tucked away: an island nobody has asked
    // anything of carries neither, nor the timers their own little Doozer keeps.
    let settings: SettingsPanel | null = null;
    let observer: ResizeObserver | null = null;
    function panels(): { card: Card; settings: SettingsPanel } {
      if (card && settings) return { card, settings };
      const theCard = createCard(brain, {
        open: false,
        timers,
        random,
        onSwitchView: (view) => services.switchView(view),
        onOpenSettings: () => { settingsFrom = 'card'; setOpen('settings'); },
        // The Card can close itself (Escape). Follow it.
        onOpenChange: (isOpen) => { if (!isOpen && open === 'card') setOpen('none'); },
        currentView: () => services.currentView(),
        unavailableViews: ALL_VIEWS.filter((view) => !services.availableViews.includes(view)),
      });
      const theSettings = createSettingsPanel(brain, {
        open: false,
        onClose: () => setOpen(settingsFrom === 'card' ? 'card' : 'none'),
        onQuit: () => services.quit(),
        currentView: () => services.currentView(),
      });
      card = theCard;
      settings = theSettings;
      panel.prepend(theCard.el, theSettings.el);
      theCard.setLively(attention.lively);
      // Sizes change without anyone telling us: the Card grows a row, the screen changes scale.
      if (typeof ResizeObserver === 'function') {
        observer = new ResizeObserver(() => { if (open !== 'none') { placePanel(); services.regionsChanged(); } });
        for (const node of [theCard.el, theSettings.el]) observer.observe(node);
      }
      return { card: theCard, settings: theSettings };
    }
    function dropPanels(): void {
      observer?.disconnect();
      observer = null;
      card?.destroy();
      settings?.destroy();
      card = null;
      settings = null;
    }
    scope.add(dropPanels);
    panel.append(close);
    actor.setLive(false);

    // ---- where things are on screen -----------------------------------------------------------
    const doozerAt = () => ({ x: world.doozer.x, z: world.doozer.z, y: actor.body.height });
    const points = () => doozerPoints(theStage.projector, doozerAt());

    function placeEmotes(): void {
      const { head } = points();
      memo('emotes', `${Math.round(head.x)}:${Math.round(head.y)}`, () => {
        emoteBox.style.left = `${Math.round(head.x)}px`;
        emoteBox.style.top = `${Math.round(head.y)}px`;
      });
    }

    function placeRadial(): void {
      const { middle } = points();
      const reach = RADIAL.radius + RADIAL.button / 2 + 4;
      const x = Math.max(reach, Math.min(layout.sceneWidth - reach, middle.x));
      const y = Math.max(reach, Math.min(layout.sceneHeight - 30, middle.y));
      radial.el.style.left = `${Math.round(x)}px`;
      radial.el.style.top = `${Math.round(y)}px`;
    }

    /** The part of the window that is on the screen, top and bottom, in window pixels. */
    function visibleSpan(): { top: number; bottom: number } {
      const scale = info.scale > 0 ? info.scale : 1;
      const work = info.monitor.work;
      if (!(info.height > 0) || !(work.h > 0)) return { top: 0, bottom: layout.windowHeight };
      return {
        top: Math.max(0, (work.y - info.y) / scale),
        bottom: Math.min(layout.windowHeight, (work.y + work.h - info.y) / scale),
      };
    }

    const panelHeight = (): number => {
      const el = open === 'settings' ? settings?.el : card?.el;
      return el?.offsetHeight || PANEL_FALLBACK_HEIGHT;
    };

    function placePanel(): void {
      const span = visibleSpan();
      const room = Math.max(200, span.bottom - span.top - PANEL_MARGIN * 2);
      const height = Math.min(panelHeight(), room);
      const top = panelTop(layout, height, span.top, span.bottom);
      panel.style.top = `${top}px`;
      panel.style.left = `${Math.round((layout.windowWidth - PANEL_WIDTH) / 2)}px`;
      panel.style.setProperty('--islv-panel-max', `${Math.floor(room)}px`);
      panel.dataset.tight = panelHeight() > room ? '1' : '0';
      // The panel unfolds from Doozer.
      const { middle } = points();
      const origin = `${Math.round(layout.sceneLeft + middle.x - (layout.windowWidth - PANEL_WIDTH) / 2)}px ${Math.round(layout.sceneTop + middle.y - top)}px`;
      for (const el of [card?.el, settings?.el]) el?.style.setProperty('--dzk-origin', origin);
    }

    function applyLayout(): void {
      layout = islandLayout(brain.settings.size.island);
      root.dataset.size = layout.size;
      scene.style.left = `${layout.sceneLeft}px`;
      scene.style.top = `${layout.sceneTop}px`;
      scene.style.width = `${layout.sceneWidth}px`;
      scene.style.height = `${layout.sceneHeight}px`;
      theStage.resize(layout, pixelRatio());
      outline = slabs(islandSilhouette(theStage.projector), 16, 3);
      placeEmotes();
      if (radial.isOpen) placeRadial();
      placePanel();
      wake();
    }

    // ---- hit regions: the island's outline, Doozer, the ball, and whatever is open ------------
    function hitRegions(): Region[] {
      const dx = layout.sceneLeft;
      const dy = layout.sceneTop;
      const shift = (r: Region): Region => ({ ...r, x: r.x + dx, y: r.y + dy });
      const regions = outline.map(shift);
      if (!gone) regions.push(...doozerRegions(theStage.projector, doozerAt()).map(shift));
      if (world.ball) regions.push(shift(ballRegion(theStage.projector, world.ball)));
      if (radial.isOpen) {
        const left = Number.parseFloat(radial.el.style.left) || 0;
        const top = Number.parseFloat(radial.el.style.top) || 0;
        const half = RADIAL.button / 2 + 3;
        for (let i = 0; i < RADIAL.count; i++) {
          const a = ((RADIAL.centre - RADIAL.span / 2 + (RADIAL.span / (RADIAL.count - 1)) * i) * Math.PI) / 180;
          regions.push(shift({ x: left + Math.cos(a) * RADIAL.radius - half, y: top + Math.sin(a) * RADIAL.radius - half, w: half * 2, h: half * 2, r: half }));
        }
      }
      if (hover || dragging) regions.push(shift({ x: layout.sceneWidth / 2 - 31, y: 0, w: 62, h: 26, r: 13 }));
      if (open !== 'none') {
        const left = Number.parseFloat(panel.style.left) || 0;
        const top = Number.parseFloat(panel.style.top) || 0;
        const height = Math.min(panelHeight(), Number.parseFloat(panel.style.getPropertyValue('--islv-panel-max')) || Infinity);
        regions.push({ x: left, y: top, w: PANEL_WIDTH, h: height, r: 26 });
        regions.push({ x: left + PANEL_WIDTH - 18, y: top - 14, w: 34, h: 34, r: 17 });
      }
      return regions;
    }

    function flushRegions(): void {
      if (!regionsDirty) return;
      regionsDirty = false;
      regionsAt = now();
      services.regionsChanged();
    }

    /** After a frame: keep what sits on top of the drawing, and the hit regions, with Doozer. */
    function follow(): void {
      const d = points();
      const b = world.ball ? theStage.projector.project([world.ball.x, world.ball.y, world.ball.z]) : null;
      memo('follow', `${Math.round(d.middle.x / 3)}:${Math.round(d.middle.y / 3)}:${b ? `${Math.round(b.x / 3)}:${Math.round(b.y / 3)}` : '-'}`, () => { regionsDirty = true; });
      if (emotes.count > 0) placeEmotes();
      if (regionsDirty && now() - regionsAt >= REGIONS_MS) flushRegions();
    }

    // ---- open and closed ------------------------------------------------------------------
    function setOpen(next: IslandOpen): void {
      if (scope.disposed) return;
      if (!awake && next !== 'none') return;
      if (open === next) return;
      open = next;
      root.dataset.open = next;
      if (next !== 'none') {
        radial.interrupt();
        panels();
      }
      placePanel();
      if (next === 'card') card?.open(); else card?.close();
      if (next === 'settings') settings?.open(); else settings?.close();
      // Only the settings panel may take the keyboard: feeding and petting never do.
      services.setFocusable(next === 'settings');
      if (next !== 'none') attention.poke(EVENT_MS);
      services.regionsChanged();
    }
    on(close, 'click', () => setOpen('none'));

    // ---- touching Doozer: stroke, poke, press ----------------------------------------------
    let acceptedAt = -Infinity;
    let strokePx = 0;
    let lastPetAt = -Infinity;
    let lastPokeAt = -Infinity;
    let visitSince = -Infinity;
    let lastSeenAt = -Infinity;

    const local = (event: MouseEvent): { x: number; y: number } => {
      const box = touch.getBoundingClientRect();
      return { x: event.clientX - box.left, y: event.clientY - box.top };
    };
    const pickAt = (at: { x: number; y: number }): Picked => {
      const body = actor.body;
      return pick(theStage.projector.ray(at.x, at.y), {
        doozer: gone ? { x: 99, z: 99, y: 0 } : { ...doozerAt(), stretch: body.pose.stretch, bulge: body.pose.bulge },
        ball: world.ball,
        snack: world.snack,
      });
    };

    const setHover = (next: boolean): void => {
      if (next) arm('hover', HOVER_LIMIT_MS, () => setHover(false));
      else disarm('hover');
      if (hover === next) return;
      hover = next;
      root.dataset.hover = next ? '1' : '0';
      // Nobody there any more: Doozer stops looking at where the pointer was.
      if (!next) actor.lookAt(0, 0);
      services.regionsChanged();
    };
    /** A pointer event arrived. True once the pointer has stayed long enough to be a visit, not a crossing. */
    const visiting = (): boolean => {
      const t = now();
      if (t - lastSeenAt > VISIT_GAP_MS) visitSince = t;
      lastSeenAt = t;
      return t - visitSince >= DWELL_MS;
    };
    const noticed = (): void => {
      if (!visiting()) return;
      const t = now();
      if (t - lastPokeAt < 400) return;
      lastPokeAt = t;
      attention.poke(HOVER_MS);
    };

    /** The hold is over: Doozer springs back. The press itself may still turn out to be a click. */
    const letGo = (): void => {
      if (!press || !press.held) return;
      press.held = false;
      actor.body.press(false);
      wake();
    };
    const endPress = (): void => {
      if (!press) return;
      letGo();
      const pointer = press.pointer;
      press = null;
      disarm('press');
      try { touch.releasePointerCapture?.(pointer); } catch { /* it was not captured */ }
    };

    on(touch, 'pointerdown', (event) => {
      if (event.button !== 0 || !awake) return;
      // Under an open panel the island only closes it.
      if (open !== 'none') { setOpen('none'); return; }
      visitSince = -Infinity;
      visiting();
      setHover(true);
      attention.poke(HOVER_MS);
      const hit = pickAt(local(event));
      if (hit === 'doozer') {
        endPress();
        press = { moved: 0, stroked: false, held: true, pointer: event.pointerId };
        // Squashed under the finger for as long as it is held; a jiggle to start with.
        actor.body.press(true);
        actor.squish(0.55);
        arm('press', PRESS_LIMIT_MS, endPress);
        try { touch.setPointerCapture?.(event.pointerId); } catch { /* no capture: the other endings still apply */ }
        wake();
        return;
      }
      radial.close();
      if (hit === 'ball') world.bopBall();
      else if (hit === 'snack') world.bopSnack();
    });
    on(touch, 'pointerup', (event) => {
      const p = press;
      if (!p) return;
      endPress();
      // A press that stayed put is a click: the Radial opens, or closes.
      if (p.moved >= CLICK_SLOP_PX || p.stroked || event.timeStamp - acceptedAt < DOUBLE_PRESS_MS) return;
      acceptedAt = event.timeStamp;
      if (!gone) radial.toggle();
    });
    on(touch, 'pointercancel', endPress);
    on(touch, 'lostpointercapture', () => { if (press?.held) endPress(); });
    on(touch, 'pointerleave', () => {
      if (press && !touch.hasPointerCapture?.(press.pointer)) endPress();
      strokePx = 0;
      actor.lookAt(0, 0);
    });
    on(touch, 'pointermove', (event) => {
      if (!awake) return;
      noticed();
      // A button is up that we thought was down: the release happened somewhere we never heard about.
      if (event.buttons === 0 && press) endPress();
      const travelled = Math.hypot(event.movementX, event.movementY);
      if (press) press.moved += travelled;
      // The pointer is only passing: no hover look, no glance, no stroke.
      if (now() - visitSince < DWELL_MS && !press) return;
      setHover(true);
      const at = local(event);
      const hit = open === 'none' ? pickAt(at) : null;
      memo('cursor', hit, () => { touch.style.cursor = hit === 'doozer' || hit === 'ball' || hit === 'snack' ? 'pointer' : 'default'; });
      const s = brain.state;
      if (!s.asleep && !s.quiet && theDirector.scene === null && open === 'none') {
        const { head } = points();
        actor.lookAt((at.x - head.x) / (layout.sceneWidth * 0.32), (head.y - at.y) / (layout.sceneHeight * 0.3));
      }
      // Stroking across Doozer is a pet (spec 5.4), with the button held or not.
      if (hit !== 'doozer') { strokePx = 0; return; }
      strokePx += travelled;
      const t = now();
      if (strokePx > STROKE_PX && t - lastPetAt > STROKE_GAP_MS) {
        strokePx = 0;
        lastPetAt = t;
        if (press) press.stroked = true;
        brain.pet();
      }
    });
    // The backstop: the shell says every button is up, whether or not a pointerup came.
    // The hold ends at once; the press itself is given a moment in case its pointerup is
    // only late, so that a click is not lost to the order two messages arrived in.
    scope.add(shell.on('pointer-released', () => {
      letGo();
      if (press) arm('press', 250, endPress);
      endDrag();
    }));
    on(root, 'pointermove', () => { if (awake) noticed(); });
    on(root, 'contextmenu', (event) => {
      event.preventDefault();
      services.showMenu();
    });

    // ---- the grip: moving the window ------------------------------------------------------
    const endDrag = (): void => {
      if (!dragging) return;
      dragging = false;
      delete root.dataset.dragging;
      disarm('drag');
      services.regionsChanged();
    };
    on(grip, 'pointerdown', (event) => {
      if (event.button !== 0 || !awake) return;
      radial.interrupt();
      dragging = true;
      root.dataset.dragging = '1';
      arm('drag', DRAG_LIMIT_MS, endDrag);
      setHover(true);
      void shell.beginDrag({ clientX: event.clientX, clientY: event.clientY }).catch(() => endDrag());
    });
    on(grip, 'pointerup', endDrag);
    on(grip, 'pointercancel', endDrag);
    scope.add(shell.on('drag-end', (next) => {
      info = next;
      endDrag();
      placePanel();
      services.regionsChanged();
    }));

    // ---- at rest: small signs of life, each a timer that exists only while its reason does -----
    function syncTimers(): void {
      const asleep = brain.state.asleep;
      const want = (name: string, on: boolean, start: () => void): void => {
        if (!on) disarm(name);
        else if (!armed.has(name)) start();
      };
      want('blink', awake && !asleep, armBlink);
      want('wink', awake && asleep, armWink);
      want('wander', awake && attention.lively && !asleep, armWander);
      want('stir', awake && !asleep && !brain.state.quiet, armStir);
    }
    function armBlink(): void {
      const lively = attention.lively;
      arm('blink', lively ? 1800 + random() * 3700 : BLINK_MIN_MS + random() * BLINK_SPREAD_MS, () => {
        if (!gone && actor.showing !== 'asleep') actor.blink();
        syncTimers();
      });
    }
    function armWink(): void {
      // Asleep with nobody there: the fireflies have moved a little, once in a while.
      arm('wink', WINK_MS, () => {
        if (!attention.lively) world.wink();
        syncTimers();
      });
    }
    function armWander(): void {
      arm('wander', WANDER_MIN_MS + random() * WANDER_SPREAD_MS, () => {
        if (open === 'none' && !radial.isOpen && !press && !gone) theDirector.wander();
        syncTimers();
      });
    }
    function armStir(): void {
      arm('stir', STIR_MIN_MS + random() * STIR_SPREAD_MS, () => {
        if (!attention.lively && open === 'none' && !gone && theDirector.idle) {
          attention.poke(2600);
          theDirector.stir();
        }
        syncTimers();
      });
    }

    // ---- a lost graphics context -------------------------------------------------------------
    function contextLost(): void {
      root.dataset.lost = '1';
      // Tucked away, no timer may run: it is dealt with on coming back (setAwake).
      if (awake) arm('context', CONTEXT_LIMIT_MS, rebuild);
    }
    function contextRestored(): void {
      delete root.dataset.lost;
      disarm('context');
      wake();
    }
    /** The context did not come back: start again with a new canvas. */
    function rebuild(): void {
      if (scope.disposed) return;
      try {
        const old = theStage.canvas;
        const fresh = theStage.rebuild();
        old.replaceWith(fresh);
        rebuilds++;
        if (theStage.contextLost) throw new Error('the new canvas has no graphics context either');
        delete root.dataset.lost;
        wake();
      } catch (error) {
        console.error('[island] the drawing could not be brought back', error);
        // Better a Doozer in its pill than a dead island.
        const home = services.availableViews.find((view) => view !== 'island');
        if (home) services.switchView(home);
      }
    }

    // ---- what the host asks ---------------------------------------------------------------
    function setGone(next: boolean): void {
      gone = next;
      actor.object.visible = !next;
      if (next) arm('gone', GONE_LIMIT_MS, () => setGone(false));
      else disarm('gone');
      root.dataset.gone = next ? '1' : '0';
      regionsDirty = true;
      wake();
      flushRegions();
    }

    function celebrateLate(): void {
      missedCelebration = false;
      attention.poke(EVENT_MS);
      emotes.emit('sparkle', { count: 5 });
      void actor.perform('celebrate');
      if (brain.settings.onFocusEnd === 'open-card') setOpen('card');
    }

    function setAwake(next: boolean): void {
      if (awake === next) return;
      awake = next;
      if (!awake) {
        // Hidden behind a fullscreen app. The page is not told, so stop everything here.
        theDirector.setActive(false);
        radial.interrupt();
        setOpen('none');
        endPress();
        endDrag();
        setHover(false);
        setGone(false);
        attention.setEnabled(false);
        emotes.clear();
        dropPanels();
        loop.sleep();
        actor.settle();
        world.settle();
        for (const name of [...armed.keys()]) disarm(name);
      } else {
        theDirector.setActive(true);
        attention.setEnabled(true);
        syncTimers();
        if (theStage.contextLost) contextLost();
        attention.poke(3000);
        regionsDirty = true;
        wake();
        if (missedCelebration) celebrateLate();
      }
    }

    scope.add(watchReduceMotion(brain, (reduce) => {
      root.dataset.motion = reduce ? 'reduce' : 'full';
      actor.setReduceMotion(reduce);
      world.setReduceMotion(reduce);
      emotes.setReduceMotion(reduce);
      wake();
    }));

    host.append(root);
    scope.add(() => root.remove());
    applyLayout();
    syncTimers();
    attention.poke(4000);
    wake();

    return {
      hitRegions,
      leave: () => {
        // Tucked away there is nothing to see leave, and no timer may be started.
        if (!awake) return Promise.resolve();
        radial.interrupt();
        endPress();
        return actor.perform('pop-out').then(() => { if (awake) setGone(true); });
      },
      enter: () => {
        setGone(false);
        if (!awake) return Promise.resolve();
        attention.poke(3000);
        return actor.perform('pop-in');
      },
      setAwake,
      windowChanged(next) {
        info = next;
        applyLayout();
      },
      openSettings() {
        if (open !== 'settings') settingsFrom = open;
        setOpen('settings');
      },
      setOpen,
      snapshot: () => {
        const p = points();
        const ball = world.ball;
        const ballAt = ball ? theStage.projector.project([ball.x, ball.y, ball.z]) : null;
        const stageInfo = theStage.info();
        return {
          open,
          awake,
          lively: attention.lively,
          drawing: loop.running,
          pressed: press?.held === true,
          hover,
          gone,
          radial: radial.isOpen,
          scene: theDirector.scene,
          busy: actor.busy,
          mood: actor.mood,
          showing: actor.showing,
          moving: world.moving || actor.body.moving,
          doozer: {
            x: world.doozer.x, z: world.doozer.z, y: actor.body.height, stretch: actor.body.pose.stretch,
            screen: { x: layout.sceneLeft + p.middle.x, y: layout.sceneTop + p.middle.y },
          },
          ball: ball && ballAt ? { x: ball.x, y: ball.y, z: ball.z, resting: ball.resting, screen: { x: layout.sceneLeft + ballAt.x, y: layout.sceneTop + ballAt.y } } : null,
          snack: world.snack ? world.snack.food : null,
          particles: world.particles.length,
          night: world.night,
          emotes: emotes.count,
          contextLost: theStage.contextLost,
          rebuilds,
          frames: stageInfo.frames,
          undrawn: loop.undrawn,
          timers: [...armed.keys()],
        };
      },
      parts: () => ({
        root, scene, touch, grip, radial, stage: theStage, world,
        // Asking for one of the panels makes them, as opening one would.
        get card() { return panels().card; },
        get settings() { return panels().settings; },
      }),
      advance(ms) {
        if (!awake) return;
        for (let left = ms; left > 0; left -= 1000 / 60) theStage.frame(Math.min(left, 1000 / 60) / 1000, true);
        follow();
        flushRegions();
      },
      unmount: () => scope.dispose(),
    };
  }

  return {
    id: 'island',
    windowSettings: ['size'],
    window: (request: WindowRequest): WindowMode => islandWindow((request.settings.size.island ?? 'medium') as SizeId, request.position),
    async mount(host, context) {
      live?.unmount();
      live = null;
      const mine = ++generation;
      const loaded = await withLimit(load(), LOAD_LIMIT_MS, timers, 'loading the island');
      // Unmounted, or mounted again, while the island was loading: this one is not wanted.
      if (mine !== generation) { loaded.model.dispose(); return; }
      try {
        live = build(host, context, loaded);
      } catch (error) {
        // Whatever was made before it failed is taken down again; the host then shows another view.
        building?.dispose();
        loaded.model.dispose();
        throw error;
      } finally {
        building = null;
      }
    },
    unmount() {
      generation++;
      live?.unmount();
      live = null;
    },
    hitRegions: () => live?.hitRegions() ?? [],
    leave: () => live?.leave() ?? Promise.resolve(),
    enter: () => live?.enter() ?? Promise.resolve(),
    setAwake: (awake) => live?.setAwake(awake),
    windowChanged: (info) => live?.windowChanged(info),
    openSettings: () => live?.openSettings(),
    setOpen: (open) => live?.setOpen(open),
    snapshot: () => live?.snapshot() ?? null,
    parts: () => live?.parts() ?? null,
    advance: (ms) => live?.advance(ms),
  };
}
