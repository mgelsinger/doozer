// The Desktop view: the calm roamer (DESIGN_SPEC.md 6.4). An invisible overlay over one
// monitor's work area, click-through everywhere except Doozer and its menus. Doozer lives
// on the top edge of the taskbar: it stands there, strolls a little, peeks in from the
// edge of the screen now and then, and can be picked up and put down somewhere else.
//
// The view draws and forwards clicks. Every rule about the pet is the brain's; the window,
// the save and the clock are the host's (src/host/).
//
// How it is put together:
//   stage.ts     where things are: the ground line, the walking range, the hit area
//   pace.ts      Still / Calm / Lively, as numbers
//   body.ts      standing, walking, carried, floating down
//   director.ts  what Doozer does: strolls, peekaboo, and the scenes for what the brain says
//   index.ts     this file: the elements, the pointer, the menus, the watchdog
//
// Never stuck. The owner's one complaint about the mockup was that Doozer "would get
// stuck randomly", so this is the first thing the view is built around:
//   - Every behaviour has a time limit and one way back: a scene ends through
//     `Director.sceneEnded`, a carry through `Body.drop`, a float by landing, and anything
//     at all through `recover()`, which puts Doozer on the line, idle, with nothing open.
//   - A carry ends on pointerup, pointercancel, lost pointer capture, the shell's
//     `pointer-released`, the window losing focus, a pointer that moves with no button
//     held, and in any case after a time limit (body.ts).
//   - The watchdog asks, once a second while anything is going on, whether everything is
//     as it should be (`Body.check`, `Director.check`, `check` below). If not, `recover()`.
//     Each rescue is counted and described: it is a bug that got past the rules above.
//   - Tucked away (`setAwake(false)`) stops every timer this view owns.
//
// Render on demand: at rest Doozer is perfectly still apart from a two-redraw blink every
// few seconds and a glance now and then. It breathes and moves only while it is doing
// something or while someone is at it (`Attention`, shared with the Pill).

import './desktop.css';
import type { UnlockId, ViewId } from '../../core/contract';
import { createDoozer, type Doozer } from '../../character/doozer';
import { realTimers, type Timers } from '../../character/timers';
import type { View, ViewContext } from '../../host/view';
import type { Region, WindowInfo, WindowMode } from '../../shell';
import { createCard, type Card } from '../../ui/card';
import { h } from '../../ui/dom';
import { createEmoteLayer } from '../../ui/emotes';
import { createFocusChip } from '../../ui/focus-chip';
import { Scope } from '../../ui/lifecycle';
import { watchReduceMotion } from '../../ui/motion';
import { createRadial, type Radial } from '../../ui/radial';
import { createSettingsPanel, type SettingsPanel } from '../../ui/settings';
import { Attention } from '../pill/attention';
import { Body, type BodyMode, type DropCause, type FrameSource } from './body';
import { Director, type Overrun, type SceneTally } from './director';
import { NamedTimers } from './named-timers';
import type { PaceId } from './pace';
import { BALL_RADIUS, createProps } from './props';
import {
  SIZE_PX, boxAt, clipRegion, hitRegion, panelPlace, radialAnchor, radialArc, readSpots, spotOn, spotsDocument,
  stageFor, standAt, withSpot, type Stage,
} from './stage';

export interface DesktopViewOptions {
  timers?: Timers;
  random?: () => number;
  /** Milliseconds, monotonic. Default `performance.now`. */
  now?: () => number;
  /** Animation frames, for smooth movement. Null: none; everything still happens, on timers. */
  frame?: FrameSource | null;
  /** The page's size, when it is not what the shell reported (a plain browser tab). */
  viewport?: () => { w: number; h: number } | null;
}

export type DesktopOpen = 'none' | 'radial' | 'card' | 'settings';

/** Something the watchdog found wrong and put right. */
export interface Rescue {
  at: number;
  problems: string[];
}

/** What the view is doing right now. For tests and the scripted runs; nothing depends on it. */
export interface DesktopSnapshot {
  /** One word for it: idle, carried, float, the name of the scene, gone, or away (tucked). */
  state: string;
  mode: BodyMode;
  scene: string | null;
  /** Doozer's middle and the soles of its feet, in CSS pixels. */
  x: number;
  y: number;
  /** The taskbar line. */
  ground: number;
  /** Standing on the line, at a place it may stand, doing nothing, with nothing open or left out. */
  atRest: boolean;
  home: number;
  open: DesktopOpen;
  awake: boolean;
  gone: boolean;
  /** Doozer is animating. */
  lively: boolean;
  hover: boolean;
  /** A press on Doozer is in progress. */
  pressed: boolean;
  /** The time left is showing over Doozer's head. */
  chip: boolean;
  pace: PaceId;
  pose: string;
  mood: string;
  /** The rig is in the middle of a face or a performance. */
  busy: boolean;
  emotes: number;
  props: number;
  ball: boolean;
  /** The view's own timers that are armed. Tucked away, this must be empty. */
  timers: string[];
  /** What the watchdog had to put right. Each one is a bug. */
  rescues: Rescue[];
  /** Scenes ended by their time limit, or that threw. Each one is a bug. */
  overruns: Overrun[];
  scenes: Record<string, SceneTally>;
  /** How each carry ended. */
  drops: Partial<Record<DropCause, number>>;
  stage: Stage;
}

export interface DesktopParts {
  root: HTMLElement;
  pet: HTMLElement;
  hit: HTMLElement;
  world: HTMLElement;
  panel: HTMLElement;
  doozer: Doozer;
  radial: Radial;
  card: Card;
  settings: SettingsPanel;
  chip: HTMLElement;
}

/** Things Doozer does by itself, on request. For tests and the scripted runs. */
export type DesktopAct = 'stroll' | 'peek' | 'gesture' | 'welcome';
/** Ways to break the view on purpose, to see the watchdog put it right. */
export type Sabotage = 'off-the-line' | 'stuck-pose' | 'lost-timers' | 'ghost-carry' | 'litter';

export interface DesktopView extends View {
  /** Null when not mounted. */
  snapshot(): DesktopSnapshot | null;
  parts(): DesktopParts | null;
  setOpen(open: DesktopOpen): void;
  /** Have Doozer do one of the things it does by itself, now. False if it may not just now. */
  act(what: DesktopAct): boolean;
  /** Run the watchdog now. Returns what it found (and has already put right). */
  watch(): string[];
  /** Break something on purpose. For the checks that prove the watchdog works. */
  sabotage(what: Sabotage): void;
}

const ALL_VIEWS: readonly ViewId[] = ['pill', 'room', 'island', 'desktop'];
/** Long enough for any scene the director plays to get going; scenes keep Doozer lively themselves. */
const SCENE_MS = 4000;
/** How long Doozer stays lively after the pointer was last seen resting on it. */
const HOVER_MS = 3500;
/**
 * The pointer has to stay this long before it counts as a visit. Doozer stands right
 * above the taskbar, where the pointer passes all day on its way to a button: a crossing
 * must cost nothing and start nothing.
 */
const DWELL_MS = 180;
/** No pointer event for this long means the visit is over; the next one starts a new one. */
const VISIT_GAP_MS = 600;
/** Stroking this far across Doozer is one pet, at most this often (as on the Card). */
const STROKE_PX = 130;
const STROKE_GAP_MS = 600;
/** A second click sooner than this is the same click (as on the Card). */
const DOUBLE_PRESS_MS = 320;
/** The pointer has to travel this far with the button down before Doozer is picked up. */
const CARRY_SLOP_PX = 7;
/** The click that ends a carry is not a poke. */
const AFTER_CARRY_MS = 350;
/** The hover look gives up after this long without a pointer event. */
const HOVER_LIMIT_MS = 4000;
/** A press that is neither moved nor released is forgotten after this long. */
const PRESS_LIMIT_MS = 10_000;
/** Doozer stays popped out no longer than this, whatever the host does next. */
const GONE_LIMIT_MS = 1500;
/** Menus close by themselves after this long with no pointer event anywhere on the view. */
const OPEN_LIMIT_MS: Readonly<Record<Exclude<DesktopOpen, 'none'>, number>> = { radial: 12_000, card: 120_000, settings: 180_000 };
const BLINK_MIN_MS = 4000;
const BLINK_SPREAD_MS = 5000;
const SNORE_MS = 2600;
/** How often the watchdog looks: while something is going on, and at rest. */
const WATCH_BUSY_MS = 1000;
const WATCH_REST_MS = 5000;
/** The Card and the Radial's buttons before the page has laid them out (and in a test DOM). */
const PANEL_FALLBACK = { w: 320, h: 540 } as const;
const RADIAL_BUTTON_PX = 50;

const defaultFrame: FrameSource | null = typeof requestAnimationFrame === 'function'
  ? (callback) => {
      const id = requestAnimationFrame(() => callback());
      return () => cancelAnimationFrame(id);
    }
  : null;

export function createDesktopView(options: DesktopViewOptions = {}): DesktopView {
  const timers = options.timers ?? realTimers;
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => performance.now());
  const frame = options.frame === undefined ? defaultFrame : options.frame;

  /** Everything that exists only while mounted. */
  let live: Mounted | null = null;

  // What went wrong and what was played, counted for as long as this view object lives:
  // through being switched away from and back, which unmounts and mounts it again.
  const rescues: Rescue[] = [];
  const overruns: Overrun[] = [];
  const tally: Record<string, SceneTally> = {};
  const drops: Partial<Record<DropCause, number>> = {};

  interface Mounted {
    hitRegions(): Region[];
    leave(): Promise<unknown>;
    enter(): Promise<unknown>;
    setAwake(awake: boolean): void;
    windowChanged(info: WindowInfo): void;
    openSettings(): void;
    setOpen(open: DesktopOpen): void;
    snapshot(): DesktopSnapshot;
    parts(): DesktopParts;
    act(what: DesktopAct): boolean;
    watch(): string[];
    sabotage(what: Sabotage): void;
    unmount(): void;
  }

  interface Press { id: number; x: number; y: number; carrying: boolean }

  function mount(host: HTMLElement, context: ViewContext): void {
    const { brain, shell } = context;
    const services = context.host;
    const scope = new Scope();
    const clock = new NamedTimers(timers);
    scope.add(() => clock.dispose());

    const sizeNow = (): number => SIZE_PX[brain.settings.size.desktop] ?? SIZE_PX.medium;
    const viewport = (): { w: number; h: number } | undefined => {
      const given = options.viewport?.();
      if (given) return given;
      // A plain browser tab has no shell to say how big the page is.
      if (!shell.native && options.viewport === undefined && typeof window !== 'undefined' && window.innerWidth > 0) {
        return { w: window.innerWidth, h: window.innerHeight };
      }
      return undefined;
    };

    // ---- state ---------------------------------------------------------------------
    let info = context.info;
    let stage = stageFor(info, sizeNow(), viewport());
    let spots = readSpots(context.memory?.read());
    let home = spotOn(spots, stage);
    let open: DesktopOpen = 'none';
    /** What to go back to when the settings panel closes. */
    let settingsFrom: DesktopOpen = 'none';
    let awake = true;
    /** Popped out for a window change: hidden. */
    let gone = false;
    /** Popping out: still drawn, but no longer to be touched or to start anything. */
    let leaving = false;
    let hover = false;
    /** A press on Doozer that has not ended yet. */
    let press: Press | null = null;
    let reduce = false;
    let watchFast = false;
    let missed: { treats: number; unlocked: readonly UnlockId[] } | null = null;
    let drawn = { x: NaN, y: NaN };
    /** Not there to be touched: popped out, or on the way out. */
    const away = (): boolean => gone || leaving;

    // ---- elements ------------------------------------------------------------------
    const doozer = createDoozer({ style: 'bold', size: stage.size, palette: brain.settings.palette, timers, random });
    scope.add(() => doozer.destroy());
    const hit = h('div', { class: 'deskv-hit', role: 'button', 'aria-label': 'Doozer', 'data-radial-toggle': true });
    const emotes = createEmoteLayer({ timers, random, max: 12, origin: { x: 0.5, y: 0.52, spreadX: 0.14, spreadY: 0.06 } });
    emotes.el.classList.add('deskv-emotes');
    scope.add(() => emotes.destroy());
    const focusChip = createFocusChip(brain);
    focusChip.setRevealed(false);
    scope.add(() => focusChip.destroy());
    const chip = h('div', { class: 'deskv-chip', 'aria-hidden': 'true' }, [focusChip.el]);
    const pet = h('div', { class: 'deskv-pet' }, [doozer.el, hit, emotes.el, chip]);
    const world = h('div', { class: 'deskv-world', 'aria-hidden': 'true' });
    const panel = h('div', { class: 'deskv-panel' });
    const root = h('div', { class: 'dzk deskv', 'data-open': 'none' }, [world, pet, panel]);

    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): void => {
      target.addEventListener(type, handler);
      scope.add(() => target.removeEventListener(type, handler));
    };
    const onWindow = <K extends keyof WindowEventMap>(type: K, handler: (event: WindowEventMap[K]) => void, capture = false): void => {
      if (typeof window === 'undefined') return;
      window.addEventListener(type, handler, capture);
      scope.add(() => window.removeEventListener(type, handler, capture));
    };

    const draw = (x: number, y: number): void => {
      drawn = { x, y };
      const box = boxAt(stage.size, x, y);
      pet.style.transform = `translate(${box.left.toFixed(2)}px, ${box.top.toFixed(2)}px)`;
    };

    const applySize = (): void => {
      root.style.setProperty('--deskv-size', `${stage.size}px`);
      doozer.setSize(stage.size);
    };
    applySize();

    // ---- liveliness ----------------------------------------------------------------
    let director: Director | null = null;
    let body: Body | null = null;
    let card: Card | null = null;

    /** Doozer is in the middle of something. */
    const doing = (): boolean => !!body && !!director && (director.scene !== null || body.mode !== 'ground' || body.moving);

    function syncLive(): void {
      const lively = awake && !away() && (attention.lively || doing());
      doozer.setLive(lively);
      card?.setLively(awake && attention.lively);
      // The watchdog looks more often while something is going on.
      if (awake && doing() && !watchFast) armWatch();
    }

    const attention = new Attention({
      timers,
      now,
      onChange: () => {
        syncLive();
        syncSnore();
      },
    });
    scope.add(() => attention.destroy());

    // ---- the body, the props, the director -----------------------------------------
    const props = createProps(world, { timers });
    scope.add(() => props.destroy());

    const theBody = new Body({
      rig: doozer,
      clock,
      now,
      frame,
      stage,
      x: home,
      draw,
      changed: () => {
        syncLive();
        services.regionsChanged();
      },
      landed: (x) => rememberHome(x),
      dropped: (cause) => endPress(cause),
      carriedFace: () => (brain.state.asleep ? 'asleep' : 'wow'),
      reduceMotion: () => reduce,
      drops,
    });
    body = theBody;
    scope.add(() => theBody.dispose());

    const theDirector = new Director({
      brain,
      doozer,
      body: theBody,
      props,
      clock,
      timers,
      random,
      now,
      emote: (kind, emoteOptions) => emotes.emit(kind, emoteOptions),
      awake: () => awake && !away(),
      free: () => open === 'none' && !hover && press === null,
      staysPut: () => open !== 'none',
      reduceMotion: () => reduce,
      home: () => home,
      stir: (ms) => attention.poke(ms),
      changed: () => {
        syncLive();
        services.regionsChanged();
      },
      welcomed: () => services.welcomed(),
      tally,
      overruns,
    });
    director = theDirector;
    scope.add(() => theDirector.destroy());

    scope.add(brain.on('action', () => attention.poke(SCENE_MS)));
    scope.add(brain.on('mood', () => { if (!brain.state.quiet) attention.poke(3000); }));
    scope.add(brain.on('change', () => {
      syncSnore();
      syncChip();
    }));
    scope.add(brain.on('focus', (event) => {
      syncChip();
      if (event.type !== 'complete') return;
      // Spec 4.5: Doozer celebrates; optionally the Card opens. Never keyboard focus.
      if (!awake || away()) {
        missed = { treats: event.treats, unlocked: event.unlocked };
        return;
      }
      if (brain.settings.onFocusEnd === 'open-card') setOpen('card');
    }));
    scope.add(brain.on('settings', ({ key }) => {
      if (key === 'size' && sizeNow() !== stage.size) restage();
    }));

    // ---- the Radial, the Card, the settings panel ----------------------------------
    const radial = createRadial(brain, {
      timers,
      onMore: () => setOpen('card'),
      // The Radial closes itself: a choice, a press elsewhere, being left alone, Doozer doing something.
      onOpenChange: (isOpen) => { if (!isOpen && open === 'radial') setOpen('none'); },
    });
    scope.add(() => radial.destroy());
    pet.append(radial.el);

    const theCard = createCard(brain, {
      open: false,
      timers,
      random,
      onSwitchView: (view) => services.switchView(view),
      onOpenSettings: () => {
        settingsFrom = 'card';
        setOpen('settings');
      },
      // The Card can close itself (Escape). Follow it.
      onOpenChange: (isOpen) => { if (!isOpen && open === 'card') setOpen('none'); },
      currentView: () => services.currentView(),
      unavailableViews: ALL_VIEWS.filter((view) => !services.availableViews.includes(view)),
    });
    card = theCard;
    scope.add(() => theCard.destroy());
    const settings = createSettingsPanel(brain, {
      open: false,
      onClose: () => setOpen(settingsFrom === 'card' ? 'card' : 'none'),
      onQuit: () => services.quit(),
      currentView: () => services.currentView(),
    });
    scope.add(() => settings.destroy());
    panel.append(theCard.el, settings.el);
    theCard.setLively(false);

    let panelBox: Region | null = null;

    function placePanel(): void {
      const node = open === 'settings' ? settings.el : theCard.el;
      const w = node.offsetWidth || PANEL_FALLBACK.w;
      const tall = node.scrollHeight || node.offsetHeight || PANEL_FALLBACK.h;
      const place = panelPlace(stage, theBody.x, theBody.y, { w, h: tall });
      panel.style.left = `${Math.round(place.left)}px`;
      panel.style.top = `${Math.round(place.top)}px`;
      panel.style.setProperty('--deskv-panel-max', `${place.maxHeight}px`);
      for (const each of [theCard.el, settings.el]) each.style.setProperty('--dzk-origin', place.origin);
      panelBox = { x: Math.round(place.left), y: Math.round(place.top), w, h: Math.min(tall, place.maxHeight), r: 26 };
    }

    function radialRegions(): Region[] {
      const anchor = radialAnchor(stage.size, theBody.x, theBody.y);
      const regions: Region[] = [];
      for (const button of radial.el.querySelectorAll<HTMLElement>('.dzk-rb')) {
        // Where the button comes to rest, not where its opening spring has got to.
        const w = button.offsetWidth || RADIAL_BUTTON_PX;
        const height = button.offsetHeight || RADIAL_BUTTON_PX;
        regions.push({ x: anchor.x + button.offsetLeft, y: anchor.y + button.offsetTop, w, h: height, r: Math.min(w, height) / 2 });
      }
      return regions;
    }

    function hitRegions(): Region[] {
      if (!awake || away() || scope.disposed) return [];
      const regions: Region[] = [hitRegion(stage.size, theBody.x, theBody.y)];
      if (open === 'radial') regions.push(...radialRegions());
      if ((open === 'card' || open === 'settings') && panelBox) regions.push(panelBox);
      const inPlay = props.inPlay;
      if (inPlay) {
        const r = BALL_RADIUS;
        regions.push({ x: inPlay.ball.x - r, y: inPlay.ball.y - r, w: r * 2, h: r * 2, r });
      }
      const clipped: Region[] = [];
      for (const region of regions) {
        const inside = clipRegion(region, stage.w, stage.h);
        if (inside) clipped.push(inside);
      }
      return clipped;
    }

    // ---- open and closed -----------------------------------------------------------
    function armOpenLimit(): void {
      if (open === 'none') clock.disarm('open-limit');
      else clock.arm('open-limit', OPEN_LIMIT_MS[open], () => setOpen('none'));
    }

    function setOpen(next: DesktopOpen): void {
      if (scope.disposed) return;
      if (next !== 'none' && (!awake || away() || !theBody.onGround || theBody.offstage)) return;
      if (open === next) return;
      open = next;
      root.dataset.open = next;
      if (next !== 'none') {
        // Doozer has your attention: it stops wandering off.
        if (theDirector.scene === 'stroll' || theDirector.scene === 'peek') theDirector.interrupt();
        attention.poke(SCENE_MS);
      }
      if (next === 'radial') {
        const arc = radialArc(stage, theBody.x);
        radial.setArc(arc.center, arc.span);
        radial.open();
      } else {
        radial.close();
      }
      if (next === 'card' || next === 'settings') placePanel();
      if (next === 'card') theCard.open(); else theCard.close();
      if (next === 'settings') settings.open(); else settings.close();
      // Only the settings panel may take the keyboard: feeding and petting never do.
      services.setFocusable(next === 'settings');
      armOpenLimit();
      theDirector.syncAutonomy();
      syncLive();
      services.regionsChanged();
    }

    // ---- the spot Doozer lives at, per monitor -------------------------------------
    function rememberHome(x: number): void {
      home = standAt(stage, x);
      const next = withSpot(spots, stage, home, Date.now());
      if (spots[stage.monitor]?.f === next[stage.monitor]?.f) return;
      spots = next;
      context.memory?.write(spotsDocument(spots));
    }

    /** The screen, the taskbar or Doozer's size changed. */
    function restage(): void {
      const before = stage;
      stage = stageFor(info, sizeNow(), viewport());
      applySize();
      const sameMonitor = stage.monitor === before.monitor;
      const across = before.w > 0 ? stage.w / before.w : 1;
      if (theBody.onGround) {
        // A scene measured against the old screen ends here.
        theDirector.interrupt();
        const x = sameMonitor ? theBody.x * across : spotOn(spots, stage);
        home = sameMonitor ? standAt(stage, home * across) : spotOn(spots, stage);
        theBody.setStage(stage);
        theBody.settle();
        theBody.standAt(x);
      } else {
        home = sameMonitor ? standAt(stage, home * across) : spotOn(spots, stage);
        theBody.setStage(stage);
      }
      // What is open stays open (the Size row is in the settings panel) and moves with Doozer.
      if (open === 'radial') {
        const arc = radialArc(stage, theBody.x);
        radial.setArc(arc.center, arc.span);
      } else if (open === 'card' || open === 'settings') {
        placePanel();
      }
      services.regionsChanged();
    }

    // ---- the pointer: poke, carry, stroke --------------------------------------------
    let carryEndedAt = -Infinity;
    let acceptedAt = -Infinity;
    let strokePx = 0;
    let lastPetAt = -Infinity;
    let lastPokeAt = -Infinity;
    let visitSince = -Infinity;
    let lastSeenAt = -Infinity;

    /** The press is over, however it ended. A carry in progress has already been put down, or is now. */
    function endPress(cause: DropCause = 'interrupted'): void {
      const was = press;
      if (!was) return;
      press = null;
      clock.disarm('press');
      delete pet.dataset.held;
      try { hit.releasePointerCapture(was.id); } catch { /* it was never captured, or is already gone */ }
      if (was.carrying) {
        carryEndedAt = now();
        theBody.drop(cause);
      }
      theDirector.syncAutonomy();
    }

    function beginCarry(at: Press): void {
      at.carrying = true;
      clock.disarm('press');
      // Whatever Doozer was in the middle of ends first, and tidies up after itself.
      theDirector.interrupt();
      setOpen('none');
      setHover(false);
      doozer.stop();
      doozer.lookAt(0, 0);
      pet.dataset.held = '1';
      attention.poke(SCENE_MS);
      theBody.pickUp(at.x, at.y);
    }

    /** A click on Doozer: a poke, and the Radial (or away with whatever is open). */
    function poke(): void {
      attention.poke(HOVER_MS);
      doozer.squish(0.8);
      if (open === 'card' || open === 'settings') {
        setOpen('none');
        return;
      }
      setOpen(open === 'radial' ? 'none' : 'radial');
    }

    const setHover = (next: boolean): void => {
      if (next) {
        // No more pointer events means the pointer has stopped or gone: relax either way.
        clock.arm('hover', HOVER_LIMIT_MS, () => setHover(false));
      } else {
        clock.disarm('hover');
      }
      if (hover === next) return;
      hover = next;
      if (next) pet.dataset.hover = '1'; else delete pet.dataset.hover;
      syncChip();
      theDirector.syncAutonomy();
    };

    function syncChip(): void {
      focusChip.setRevealed(awake && !away() && hover && theBody.onGround && brain.state.focus.status !== 'idle');
    }

    /** A pointer event arrived. True once the pointer has stayed long enough to be a visit, not a crossing. */
    const visiting = (): boolean => {
      const t = now();
      if (t - lastSeenAt > VISIT_GAP_MS) visitSince = t;
      lastSeenAt = t;
      return t - visitSince >= DWELL_MS;
    };

    on(hit, 'pointerdown', (event) => {
      if (event.button !== 0 || !awake || away()) return;
      endPress();
      press = { id: event.pointerId ?? 0, x: event.clientX, y: event.clientY, carrying: false };
      try { hit.setPointerCapture(press.id); } catch { /* a pointer made up by a test cannot be captured */ }
      clock.arm('press', PRESS_LIMIT_MS, () => endPress('limit'));
      // A press is a visit however briefly the pointer has been here.
      visitSince = -Infinity;
      lastSeenAt = now();
      attention.poke(HOVER_MS);
      theDirector.syncAutonomy();
    });

    onWindow('pointermove', (event) => {
      if (open !== 'none') armOpenLimit();
      const held = press;
      if (!held) return;
      // The button is up and nobody told us: the release happened somewhere we never heard about.
      if (event.buttons === 0) {
        endPress('no-button');
        return;
      }
      if (!held.carrying) {
        if (Math.hypot(event.clientX - held.x, event.clientY - held.y) <= CARRY_SLOP_PX) return;
        beginCarry(held);
      }
      theBody.carryTo(event.clientX, event.clientY);
    }, true);
    onWindow('pointerup', () => endPress('up'), true);
    onWindow('pointercancel', () => endPress('cancel'), true);
    on(hit, 'lostpointercapture', () => endPress('lost-capture'));
    onWindow('blur', () => endPress('blur'));
    // The backstop: the shell says every button is up, whether or not a pointerup came.
    scope.add(shell.on('pointer-released', () => endPress('released')));
    onWindow('keydown', () => { if (open !== 'none') armOpenLimit(); }, true);

    on(hit, 'click', (event) => {
      if (!awake || away()) return;
      // The click a browser sends after a carry is the carry ending, not a poke.
      if (now() - carryEndedAt < AFTER_CARRY_MS) return;
      if (event.timeStamp - acceptedAt < DOUBLE_PRESS_MS) return;
      acceptedAt = event.timeStamp;
      poke();
    });

    on(hit, 'pointermove', (event) => {
      if (!awake || away() || press?.carrying) return;
      if (!visiting()) return;
      const t = now();
      if (t - lastPokeAt > 400) {
        lastPokeAt = t;
        attention.poke(HOVER_MS);
      }
      setHover(true);
      const s = brain.state;
      if (!s.asleep && !s.quiet && theDirector.scene === null && theBody.onGround) {
        const box = boxAt(stage.size, theBody.x, theBody.y);
        doozer.lookAt((event.clientX - box.left - stage.size / 2) / (stage.size * 0.5), (event.clientY - box.top - stage.size * 0.55) / (stage.size * 0.5));
      }
      // Stroking across Doozer is a pet (spec 5.4).
      if (event.buttons !== 0) return;
      strokePx += Math.hypot(event.movementX, event.movementY);
      if (strokePx > STROKE_PX && t - lastPetAt > STROKE_GAP_MS) {
        strokePx = 0;
        lastPetAt = t;
        brain.pet();
      }
    });
    on(hit, 'pointerleave', () => {
      setHover(false);
      strokePx = 0;
      if (theDirector.scene === null && !doozer.busy) doozer.lookAt(0, 0);
    });

    // The ball can be bopped.
    on(world, 'pointerdown', (event) => {
      const target = event.target;
      if (event.button !== 0 || !(target instanceof Element) || !target.closest('[data-ball]')) return;
      if (theDirector.bop(event.clientX)) attention.poke(SCENE_MS);
    });

    on(root, 'contextmenu', (event) => {
      event.preventDefault();
      services.showMenu();
    });

    // ---- at rest: a blink now and then; asleep with someone there: a z ---------------
    function armBlink(): void {
      clock.arm('blink', BLINK_MIN_MS + random() * BLINK_SPREAD_MS, () => {
        if (awake && !away() && !attention.lively && !doing() && !brain.state.asleep) doozer.blink(true);
        if (awake) armBlink();
      });
    }

    function syncSnore(): void {
      const want = awake && !away() && attention.lively && brain.state.asleep && !brain.state.quiet && theBody.onGround;
      if (!want) clock.disarm('snore');
      else if (!clock.has('snore')) {
        clock.arm('snore', SNORE_MS, () => {
          emotes.emit('z');
          syncSnore();
        });
      }
    }

    // ---- the watchdog ----------------------------------------------------------------
    /** Everything about the view itself that is not as it should be. */
    function check(): string[] {
      const problems: string[] = [];
      if (press?.carrying && theBody.mode !== 'carried') problems.push('the pointer thinks it is carrying, and nothing is being carried');
      if (theBody.mode === 'carried' && !press?.carrying) problems.push('carried with no press behind it');
      if (press && !press.carrying && !clock.has('press')) problems.push('a press with no limit running');
      if (pet.dataset.held === '1' && theBody.mode !== 'carried') problems.push('drawn as held while not carried');
      if ((open === 'radial') !== radial.isOpen) problems.push('the Radial and the view disagree about whether it is open');
      if ((open === 'card') !== theCard.isOpen) problems.push('the Card and the view disagree about whether it is open');
      if ((open === 'settings') !== settings.isOpen) problems.push('the settings panel and the view disagree about whether it is open');
      if (open !== 'none' && !clock.has('open-limit')) problems.push('something is open with no limit running');
      if (open !== 'none' && !theBody.onGround) problems.push('something is open around a Doozer that is off the ground');
      if (away() && !clock.has('gone')) problems.push('popped out with no limit running');
      if (hover && !clock.has('hover')) problems.push('hovered with no limit running');
      if (!theBody.moving && (Math.abs(drawn.x - theBody.x) > 0.6 || Math.abs(drawn.y - theBody.y) > 0.6)) problems.push('drawn somewhere other than where it is');
      return problems;
    }

    /** The way back that always works: on the line, idle, nothing open, nothing left out. */
    function recover(): void {
      theDirector.interrupt();
      endPress();
      theBody.settle();
      props.clear();
      doozer.stop();
      doozer.lookAt(0, 0);
      delete pet.dataset.held;
      if (open !== 'none') setOpen('none');
      radial.interrupt();
      theCard.close();
      settings.close();
      root.dataset.open = open;
      setHover(false);
      draw(theBody.x, theBody.y);
      if (awake) {
        theDirector.arm();
        if (!clock.has('blink')) armBlink();
        if (away() && !clock.has('gone')) setGone(false);
      }
      syncLive();
      services.regionsChanged();
    }

    function watch(): string[] {
      const problems = [...theBody.check(), ...theDirector.check(), ...check()];
      if (problems.length === 0) return problems;
      rescues.push({ at: Date.now(), problems });
      if (rescues.length > 50) rescues.shift();
      console.warn('[desktop] the watchdog put Doozer back on the line:', problems.join('; '));
      recover();
      return problems;
    }

    function armWatch(): void {
      watchFast = doing();
      clock.arm('watchdog', watchFast ? WATCH_BUSY_MS : WATCH_REST_MS, () => {
        if (awake) watch();
        if (awake) armWatch();
      });
    }

    // ---- what the host asks --------------------------------------------------------
    function setGone(next: boolean): void {
      gone = next;
      leaving = false;
      if (next) {
        pet.dataset.gone = '1';
        clock.arm('gone', GONE_LIMIT_MS, () => setGone(false));
      } else {
        delete pet.dataset.gone;
        clock.disarm('gone');
        theDirector.syncAutonomy();
      }
      syncChip();
      syncLive();
      services.regionsChanged();
    }

    /** Stop whatever is going on and stand on the line with nothing open. */
    function quiesce(): void {
      theDirector.interrupt();
      endPress();
      theBody.settle();
      props.clear();
      doozer.stop();
      doozer.lookAt(0, 0);
      setOpen('none');
      setHover(false);
    }

    function setAwake(next: boolean): void {
      if (awake === next) return;
      if (!next) {
        // Hidden behind a fullscreen app. The page is not told, so stop everything here.
        quiesce();
        awake = false;
        theDirector.rest();
        attention.setEnabled(false);
        emotes.clear();
        setGone(false);
        clock.clear();
        watchFast = false;
        syncChip();
        syncLive();
      } else {
        awake = true;
        attention.setEnabled(true);
        theDirector.arm();
        armBlink();
        armWatch();
        attention.poke(3000);
        syncChip();
        syncLive();
        if (services.needsWelcome()) theDirector.welcome();
        else if (missed) {
          const { treats, unlocked } = missed;
          missed = null;
          theDirector.celebrate(treats, unlocked);
          if (brain.settings.onFocusEnd === 'open-card') setOpen('card');
        }
      }
      services.regionsChanged();
    }

    scope.add(watchReduceMotion(brain, (on) => {
      reduce = on;
      root.dataset.motion = on ? 'reduce' : 'full';
      doozer.setReduceMotion(on);
      emotes.setReduceMotion(on);
      // With motion reduced Doozer does not wander.
      if (on && (director?.scene === 'stroll' || director?.scene === 'peek')) director.interrupt();
      director?.syncAutonomy();
    }));

    // Sizes change without anyone telling us: the Card grows a row.
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => {
        if (open !== 'card' && open !== 'settings') return;
        placePanel();
        services.regionsChanged();
      });
      observer.observe(theCard.el);
      observer.observe(settings.el);
      scope.add(() => observer.disconnect());
    }
    onWindow('resize', () => {
      // In the app the host says when the window changed; a plain browser tab only resizes.
      if (!shell.native) restage();
    });

    host.append(root);
    scope.add(() => root.remove());
    draw(theBody.x, theBody.y);
    theDirector.arm();
    armBlink();
    armWatch();
    attention.poke(SCENE_MS);
    syncLive();

    live = {
      hitRegions,
      leave: () => {
        quiesce();
        // From here until it is back, Doozer starts nothing and cannot be touched.
        leaving = true;
        clock.arm('gone', GONE_LIMIT_MS, () => setGone(false));
        theDirector.syncAutonomy();
        services.regionsChanged();
        return doozer.perform('pop-out').then(() => { if (!scope.disposed && leaving) setGone(true); });
      },
      enter: () => {
        setGone(false);
        attention.poke(3000);
        if (awake && services.needsWelcome()) {
          theDirector.welcome();
          return Promise.resolve();
        }
        return doozer.perform('pop-in');
      },
      setAwake,
      windowChanged(next) {
        info = next;
        restage();
      },
      openSettings() {
        if (open !== 'settings') settingsFrom = open === 'card' ? 'card' : 'none';
        setOpen('settings');
      },
      setOpen,
      snapshot: () => {
        const scene = theDirector.scene;
        const state = !awake ? 'away' : away() ? 'gone' : theBody.mode === 'carried' ? 'carried' : theBody.mode === 'float' ? 'float' : scene ?? 'idle';
        return {
          state,
          mode: theBody.mode,
          scene,
          x: theBody.x,
          y: theBody.y,
          ground: stage.ground,
          atRest: state === 'idle' && !theBody.moving && Math.abs(theBody.y - stage.ground) < 0.5 && !theBody.offstage
            && open === 'none' && props.count === 0 && press === null,
          home,
          open,
          awake,
          gone: away(),
          lively: doozer.el.dataset.live === '1',
          hover,
          pressed: press !== null,
          chip: focusChip.el.dataset.show === '1',
          pace: brain.settings.desktopActivity,
          pose: doozer.pose,
          mood: doozer.mood,
          busy: doozer.busy,
          emotes: emotes.count,
          props: props.count,
          ball: props.inPlay !== null,
          timers: clock.names(),
          rescues: rescues.map((rescue) => ({ at: rescue.at, problems: [...rescue.problems] })),
          overruns: overruns.map((overrun) => ({ ...overrun })),
          scenes: JSON.parse(JSON.stringify(tally)) as Record<string, SceneTally>,
          drops: { ...drops },
          stage,
        };
      },
      parts: () => ({ root, pet, hit, world, panel, doozer, radial, card: theCard, settings, chip: focusChip.el }),
      act(what) {
        if (!awake || away()) return false;
        if (what === 'stroll') return theDirector.stroll();
        if (what === 'peek') return theDirector.peek();
        if (what === 'gesture') return theDirector.gesture();
        theDirector.welcome();
        return theDirector.scene === 'welcome';
      },
      watch,
      sabotage(what) {
        // Each of these is a state the rules above never produce. The watchdog has to notice.
        if (what === 'off-the-line') draw(theBody.x + 40, theBody.y - 120);
        else if (what === 'stuck-pose') doozer.setPose('walk');
        else if (what === 'lost-timers') { clock.disarm('decide'); clock.disarm('peek'); }
        else if (what === 'ghost-carry') pet.dataset.held = '1';
        else props.food('apple', theBody.x + 60, stage.ground);
      },
      unmount: () => scope.dispose(),
    };
  }

  return {
    id: 'desktop',
    window: (): WindowMode => ({ kind: 'overlay' }),
    mount(host, context) {
      live?.unmount();
      live = null;
      mount(host, context);
    },
    unmount() {
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
    act: (what) => live?.act(what) ?? false,
    watch: () => live?.watch() ?? [],
    sabotage: (what) => live?.sabotage(what),
  };
}
