// The Room view: Doozer's terrarium (DESIGN_SPEC.md 6.2). A framed little room with its
// own title bar. You set things up by clicking the furniture; Doozer decides when to
// use them. A slim strip of meters under the scene, and a button in the title bar that
// opens the Card.
//
// The view draws and forwards clicks. Every rule is the brain's; the window, the save
// and the clock are the host's (src/host/). How Doozer moves about is behaviour.ts.
//
// Never stuck, by construction rather than by repair:
//   - Where Doozer belongs is a function of the brain's state (behaviour.ts), checked
//     after every scene, on every change and once a minute.
//   - What is open is one variable (`open`) mirrored in one attribute.
//   - Everything temporary has a timer behind it: a highlighted piece of furniture, a
//     press on the title bar, the window being dragged, Doozer popped out, a scene.
//   - Dragging the window ends on the shell's `drag-end` and `pointer-released`, on the
//     page's own pointer events, on a move with no button held, and after a time limit.
//   - Tucked away (`setAwake(false)`) stops every timer this view owns.
//
// Render on demand: at rest the room is a still picture, apart from a two-redraw blink
// every few seconds and the sky moving on once a minute. Doozer animates only while it
// is doing something or while somebody is there (attention.ts, shared with the Pill).

import './room.css';
import type { ActionResult, FoodId, ToyId, UnlockId, ViewId } from '../../core/contract';
import { createDoozer, type Doozer } from '../../character/doozer';
import { realTimers, type Timers } from '../../character/timers';
import type { View, ViewContext, WindowRequest } from '../../host/view';
import type { Region, WindowInfo, WindowMode } from '../../shell';
import { createCard, type Card } from '../../ui/card';
import { createMemo, h } from '../../ui/dom';
import { createEmoteLayer } from '../../ui/emotes';
import { formatClock, plural } from '../../ui/format';
import { ICONS } from '../../ui/icons';
import { Scope, Transients } from '../../ui/lifecycle';
import { createNeedMeters } from '../../ui/meters';
import { watchReduceMotion } from '../../ui/motion';
import { syncDoozer } from '../../ui/presenter';
import { createSettingsPanel, type SettingsPanel } from '../../ui/settings';
import { attachTooltips } from '../../ui/tooltip';
import { Attention } from '../pill/attention';
import { createBehaviour, SCENE_LIMIT_MS, type Behaviour, type Place, type RoomFx, type Station } from './behaviour';
import {
  CARD, FLOOR_Y, HOTSPOTS, PET, REACH, SPOT, THING, TITLE_H,
  cardRegions, frameRegion, placeCard, roomGeometry, roomWindow, visibleSpan,
  type FurnitureId, type RoomGeometry,
} from './layout';
import { TOY_ART, createScenePainter, sceneArt } from './scene';
import { clockHands, hourOf, skyAt, wallClock } from './sky';
import { Walker } from './walker';

export interface RoomViewOptions {
  timers?: Timers;
  random?: () => number;
  /** Milliseconds, monotonic. Default `performance.now`. */
  now?: () => number;
  /** The time on the wall, for the sky and the clock. Default `new Date()`. */
  date?: () => Date;
}

export type RoomOpen = 'none' | 'card' | 'settings';

/** What the view is doing right now. For tests and the scripted runs; nothing depends on it. */
export interface RoomSnapshot {
  open: RoomOpen;
  awake: boolean;
  /** Doozer is animating (it is doing something, or somebody is there). */
  lively: boolean;
  /** Where Doozer is settled, and where the brain's state says it belongs. */
  station: Station;
  desired: Station;
  /** The scene playing now, or null. */
  scene: string | null;
  /** Doozer's middle, in the scene's 380 pixels. */
  x: number;
  place: Place;
  pose: string;
  mood: string;
  /** Doozer is in the middle of a face or a performance. */
  busy: boolean;
  /** Doozer is popped out for a window change. */
  gone: boolean;
  /** Servings the bowl is drawn with. */
  bowl: number;
  bookHeld: boolean;
  toy: string;
  ballX: number;
  lamp: boolean;
  /** Emotes, snacks and crumbs on screen. */
  emotes: number;
  props: number;
  /** A press on the title bar is in progress / the window is being dragged. */
  pressed: boolean;
  dragging: boolean;
  /** The piece of furniture under the pointer, or ''. */
  hot: string;
  /** The words on the title bar: the time of day, or a session's time left. */
  time: string;
  sky: string;
  /** Every timer of the view that is armed. Tucked away, this must be empty. */
  timers: string[];
}

export interface RoomView extends View {
  /** Null when not mounted. */
  snapshot(): RoomSnapshot | null;
  /** Open the Card, the settings panel, or fold everything away. */
  setOpen(open: RoomOpen): void;
  /** Pretend it is this hour of the day (0-24), for pictures and checks. Null: the real time. */
  setSkyHour(hour: number | null): void;
  /** The pieces, for tests and the scripted runs. Null when not mounted. */
  parts(): {
    root: HTMLElement; frame: HTMLElement; title: HTMLElement; cardButton: HTMLButtonElement; scene: HTMLElement;
    petHit: HTMLButtonElement; furniture: Record<FurnitureId, HTMLButtonElement>; strip: HTMLElement;
    card: Card; settings: SettingsPanel; doozer: Doozer; close: HTMLButtonElement;
  } | null;
}

const ALL_VIEWS: readonly ViewId[] = ['pill', 'room', 'island', 'desktop'];
/** How long Doozer stays lively after the pointer was last seen resting in the room. */
const HOVER_MS = 3500;
/** The pointer has to stay this long before it counts as a visit, not a crossing (as in the Pill). */
const DWELL_MS = 180;
const VISIT_GAP_MS = 600;
/** Stroking this far across Doozer is one pet, at most this often (as on the Card). */
const STROKE_PX = 130;
const STROKE_GAP_MS = 600;
/** A second press sooner than this is the same press (as on the Card). */
const DOUBLE_PRESS_MS = 320;
/** A highlighted piece of furniture lets go after this long without a pointer event. */
const HOT_LIMIT_MS = 4000;
/** A press on the title bar that has not become a drag is forgotten after this long. */
const PRESS_LIMIT_MS = 6000;
/** The view's own "being dragged" look never outlives this, whatever the shell says. */
const DRAG_LIMIT_MS = 20_000;
/** A press has to travel this far to become a drag. */
const DRAG_SLOP_PX = 4;
/** Doozer stays popped out no longer than this, whatever the host does next. */
const GONE_LIMIT_MS = 1500;
const BLINK_MIN_MS = 4000;
const BLINK_SPREAD_MS = 5000;
const SNORE_MS = 2600;
const NUDGE_MS = 380;

const FURNITURE: readonly FurnitureId[] = ['bed', 'bowl', 'soap', 'lamp', 'jar', 'clock', 'ball'];

export function createRoomView(options: RoomViewOptions = {}): RoomView {
  const timers = options.timers ?? realTimers;
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => performance.now());
  const date = options.date ?? (() => new Date());

  /** Everything that exists only while mounted. */
  let live: Mounted | null = null;

  interface Mounted {
    hitRegions(): Region[];
    leave(): Promise<unknown>;
    enter(): Promise<unknown>;
    setAwake(awake: boolean): void;
    windowChanged(info: WindowInfo): void;
    openSettings(): void;
    setOpen(open: RoomOpen): void;
    setSkyHour(hour: number | null): void;
    snapshot(): RoomSnapshot;
    parts(): NonNullable<ReturnType<RoomView['parts']>>;
    unmount(): void;
  }

  function mount(host: HTMLElement, context: ViewContext): void {
    const { brain, shell } = context;
    const services = context.host;
    const scope = new Scope();
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

    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): void => {
      target.addEventListener(type, handler);
      scope.add(() => target.removeEventListener(type, handler));
    };

    // ---- elements ------------------------------------------------------------------
    const art = sceneArt();
    const doozer = createDoozer({ style: 'soft', size: PET.size, palette: brain.settings.palette, timers, random });
    scope.add(() => doozer.destroy());
    const emotes = createEmoteLayer({ timers, random, max: 12, origin: { x: 0.5, y: 0.22, spreadX: 0.2, spreadY: 0.08 } });
    scope.add(() => emotes.destroy());
    const pet = h('div', { class: 'roomv-pet', 'aria-hidden': 'true' }, [doozer.el, emotes.el]);
    const petHit = h('button', { type: 'button', class: 'roomv-pet-hit', 'aria-label': 'Pet Doozer' });

    const ballSpin = h('div', { class: 'roomv-ball-spin', html: TOY_ART.ball });
    const ballLift = h('div', { class: 'roomv-ball-lift' }, [ballSpin]);
    const ballEl = h('div', { class: 'roomv-ball', 'aria-hidden': 'true' }, [ballLift]);

    const propLayer = h('div', { class: 'roomv-props', 'aria-hidden': 'true' });
    const fxLayer = h('div', { class: 'roomv-fx', 'aria-hidden': 'true' });
    const hotLayer = h('div', { class: 'roomv-hots' });
    const furniture = {} as Record<FurnitureId, HTMLButtonElement>;
    for (const id of FURNITURE) {
      const button = h('button', { type: 'button', class: 'roomv-hot', 'data-furniture': id });
      if (id !== 'ball') {
        const box = HOTSPOTS[id];
        Object.assign(button.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.w}px`, height: `${box.h}px`, borderRadius: `${box.r}px` });
      }
      furniture[id] = button;
      hotLayer.append(button);
    }
    hotLayer.append(petHit);

    const scene = h('div', { class: 'roomv-scene', 'data-place': 'floor', 'data-toy': 'ball', html: art.back });
    scene.append(ballEl, pet);
    scene.insertAdjacentHTML('beforeend', art.front);
    scene.append(propLayer);
    scene.insertAdjacentHTML('beforeend', art.light);
    scene.append(fxLayer, hotLayer);
    const scenePaint = createScenePainter(scene);

    const nameEl = h('b', { class: 'roomv-title-name' });
    const timeEl = h('span', { class: 'roomv-title-time', 'data-status': 'idle' });
    const cardButton = h('button', { type: 'button', class: 'roomv-title-btn', 'aria-expanded': 'false', 'aria-label': 'Open the card', 'data-tip': 'Everything in one card', html: ICONS.more });
    const title = h('div', { class: 'roomv-title' }, [
      h('span', { class: 'roomv-title-ico', 'aria-hidden': 'true', html: ICONS['view-room'] }), nameEl, timeEl, cardButton,
    ]);
    const meters = createNeedMeters(brain, { layout: 'strip' });
    scope.add(() => meters.destroy());
    const strip = h('div', { class: 'roomv-strip' }, [meters.el]);
    const frame = h('div', { class: 'roomv-frame' }, [title, scene, strip]);
    // The frame is scaled by the Size setting; its place in the window is not. The scale
    // would move a scaled element's own left and top as well, so the place goes on a
    // wrapper: the frame is drawn exactly where the hit region says it is, in every size.
    const slot = h('div', { class: 'roomv-slot' }, [frame]);

    const closeChip = h('button', { type: 'button', class: 'roomv-close', 'aria-label': 'Close', html: ICONS.close });
    const unfold = h('div', { class: 'roomv-unfold', 'data-tight': '0' }, [closeChip]);
    const root = h('div', { class: 'dzk roomv', 'data-open': 'none', 'data-lively': '0' }, [slot, unfold]);

    // ---- state ---------------------------------------------------------------------
    let open: RoomOpen = 'none';
    /** What to go back to when the settings panel closes. */
    let settingsFrom: RoomOpen = 'none';
    let awake = true;
    let info = context.info;
    let geometry: RoomGeometry = roomGeometry(brain.settings.size.room);
    let unfoldTop = geometry.card.y;
    let place: Place = 'floor';
    let bowlHold: number | null = null;
    let bookHeld = false;
    let toy: Exclude<ToyId, 'duck'> = 'ball';
    let ballX: number = THING.ball.x;
    let skyHour: number | null = null;
    let daylight = 1;
    let reduceMotion = false;
    let wasLively: boolean | null = null;
    let missed: { treats: number; unlocked: readonly UnlockId[] } | null = null;
    let behaviour: Behaviour | null = null;
    let card: Card | null = null;

    // ---- liveliness ----------------------------------------------------------------
    function applyLively(): void {
      // A scene that moves nothing (a glance about) needs no animation.
      const lively = awake && (attention.lively || (!!behaviour && behaviour.scene !== null && !behaviour.still));
      if (lively !== wasLively) {
        wasLively = lively;
        doozer.setLive(lively);
        root.dataset.lively = lively ? '1' : '0';
      }
      // An open Card nobody is looking at goes still too.
      card?.setLively(awake && attention.lively);
      syncSnore();
    }
    const attention = new Attention({ timers, now, onChange: () => applyLively() });
    scope.add(() => attention.destroy());

    // ---- Doozer on the floor -------------------------------------------------------
    const petTop = (): number => (place === 'bed' ? SPOT.bed.y : FLOOR_Y) - PET.sole;
    function drawPet(x: number, ms: number): void {
      const left = x - PET.size / 2;
      const top = petTop();
      for (const [node, dx, dy] of [[pet, 0, 0], [petHit, 14, 12]] as const) {
        if (ms > 0 && !reduceMotion) {
          // Read a layout value first, so the walk starts from where Doozer was just put.
          void node.offsetWidth;
          node.style.transition = `translate ${ms}ms linear`;
        } else {
          node.style.transition = 'none';
        }
        node.style.translate = `${(left + dx).toFixed(1)}px ${top + dy}px`;
      }
    }
    const walker = new Walker({ x: SPOT.start, now, apply: drawPet, min: REACH.min, max: REACH.max });

    // ---- the ball ------------------------------------------------------------------
    const BALL_Y = FLOOR_Y + 2 - THING.ball.r * 2;
    function drawBall(): void {
      const at = `${(ballX - THING.ball.r).toFixed(1)}px ${BALL_Y}px`;
      ballEl.style.translate = at;
      furniture.ball.style.translate = at;
    }
    /** Where the ball ends up is set at once; the flight is only an animation on top of that. */
    function tossBall(toX: number, kind: 'toss' | 'kick' | 'hop'): number {
      const from = ballX;
      ballX = Math.min(356, Math.max(24, toX));
      drawBall();
      const ms = kind === 'hop' ? 480 : kind === 'kick' ? 780 : 940;
      const height = kind === 'hop' ? 16 : kind === 'kick' ? 62 : 84;
      if (reduceMotion || !awake || typeof ballEl.animate !== 'function') return reduceMotion ? 0 : ms;
      const r = THING.ball.r;
      ballEl.animate([{ translate: `${(from - r).toFixed(1)}px ${BALL_Y}px` }, { translate: `${(ballX - r).toFixed(1)}px ${BALL_Y}px` }], { duration: ms, easing: 'linear' });
      const up = 'cubic-bezier(.2, .7, .4, 1)';
      const down = 'cubic-bezier(.6, 0, .9, .4)';
      ballLift.animate([
        { translate: '0 0', easing: up },
        { translate: `0 ${-height}px`, offset: 0.3, easing: down },
        { translate: '0 0', offset: 0.6, easing: up },
        { translate: `0 ${-Math.round(height * 0.34)}px`, offset: 0.76, easing: down },
        { translate: '0 0', offset: 0.9, easing: up },
        { translate: `0 ${-Math.round(height * 0.1)}px`, offset: 0.95, easing: down },
        { translate: '0 0' },
      ], { duration: ms });
      ballSpin.animate([{ rotate: '0deg' }, { rotate: `${Math.round((ballX - from) * 3)}deg` }], { duration: ms, easing: 'ease-out' });
      return ms;
    }

    // ---- small things that come and go ----------------------------------------------
    const props = new Transients<HTMLElement>({ remove: (node) => node.remove(), timers, max: 6 });
    scope.add(() => props.destroy());
    const specks = new Transients<HTMLElement>({ remove: (node) => node.remove(), timers, max: 24 });
    scope.add(() => specks.destroy());
    const between = (lo: number, hi: number): number => lo + random() * (hi - lo);

    const fx: RoomFx = {
      place(next) {
        place = next;
        scene.dataset.place = next;
        drawPet(walker.x, 0);
      },
      emote: (kind, emoteOptions) => { if (awake) emotes.emit(kind, emoteOptions); },
      snack(item: FoodId, from, doozerX) {
        const x = Math.min(352, doozerX + THING.snack.dx);
        const node = h('div', { class: 'roomv-snack', 'data-from': from, 'data-item': item, html: ICONS[item] });
        node.style.left = `${x}px`;
        node.style.top = `${THING.snack.y}px`;
        // Dropped from the jar: it starts up there and falls to here.
        node.style.setProperty('--from-x', `${THING.jar.x - x}px`);
        node.style.setProperty('--from-y', `${THING.jar.y - THING.snack.y}px`);
        propLayer.append(node);
        // A scene removes its snack itself; the time limit is for a scene that never does.
        props.add(node, SCENE_LIMIT_MS);
        return {
          bite(step) { node.dataset.bite = String(Math.max(0, Math.min(3, Math.round(step)))); },
          remove() { props.drop(node); },
        };
      },
      duck(doozerX) {
        const node = h('div', { class: 'roomv-duck', html: ICONS.duck });
        node.style.left = `${Math.max(20, doozerX - 62)}px`;
        node.style.top = `${FLOOR_Y - 20}px`;
        propLayer.append(node);
        props.add(node, SCENE_LIMIT_MS);
        return { remove() { props.drop(node); } };
      },
      crumbs() {
        if (!awake || reduceMotion) return;
        for (let i = 0; i < 5; i++) {
          const node = h('i', { class: 'roomv-crumb' });
          node.style.left = `${THING.bowl.x + between(-12, 12)}px`;
          node.style.top = `${THING.bowl.y - 8}px`;
          node.style.setProperty('--dx', `${between(-22, 22).toFixed(1)}px`);
          node.style.setProperty('--dy', `${between(-26, -6).toFixed(1)}px`);
          fxLayer.append(node);
          specks.add(node, 620);
        }
      },
      bowlHold(level) {
        bowlHold = level;
        scenePaint.bowl(bowlHold ?? brain.state.bowl);
      },
      book(held) {
        bookHeld = held;
        scenePaint.book(held);
      },
      toy(next) {
        if (toy === next) return;
        toy = next;
        scene.dataset.toy = next;
        ballSpin.innerHTML = TOY_ART[next];
        paintTips();
      },
      ballX: () => ballX,
      tossBall,
      treatsEarned(count) {
        if (!awake) return;
        emotes.emit('snack', { count: Math.min(3, Math.max(1, count)), icon: 'biscuit' });
        nudge('jar');
      },
      stir: (ms) => attention.poke(ms),
      changed: () => applyLively(),
    };

    // ---- Doozer's look and behaviour -----------------------------------------------
    scope.add(syncDoozer(brain, doozer));
    const theBehaviour = createBehaviour({ brain, doozer, walker, fx, timers, random });
    behaviour = theBehaviour;
    scope.add(() => theBehaviour.destroy());

    // ---- the Card and the settings panel -------------------------------------------
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
    card = theCard;
    scope.add(() => theCard.destroy());
    const settings = createSettingsPanel(brain, {
      open: false,
      onClose: () => setOpen(settingsFrom === 'card' ? 'card' : 'none'),
      onQuit: () => services.quit(),
      currentView: () => services.currentView(),
    });
    scope.add(() => settings.destroy());
    unfold.append(theCard.el, settings.el);
    theCard.setLively(false);

    // ---- painting ------------------------------------------------------------------
    const lampOn = (): boolean => !brain.state.asleep;

    function paintSky(): void {
      const sky = skyAt(skyHour ?? hourOf(date()));
      daylight = sky.light;
      scenePaint.sky(sky);
      scenePaint.light(daylight, lampOn());
    }

    function paintClock(): void {
      const focus = brain.state.focus;
      const text = focus.status === 'idle' ? wallClock(date()) : formatClock(focus.remainingMs);
      memo('time', `${focus.status}|${text}`, () => {
        timeEl.textContent = text;
        timeEl.dataset.status = focus.status;
      });
      scenePaint.clock({ status: focus.status, remainingMs: focus.remainingMs, hands: clockHands(date()) });
    }

    /** What each piece of furniture says it will do, on hover and to a screen reader. */
    function paintTips(): void {
      const s = brain.state;
      const limits = brain.limits;
      const focus = s.focus;
      const tips: Record<FurnitureId, string> = {
        bowl: s.bowl >= limits.bowl ? 'The bowl is full' : `Fill the bowl (${s.bowl} of ${limits.bowl})`,
        ball: toy === 'yarn' ? 'Toss the yarn ball' : 'Toss the ball',
        soap: 'Bath time',
        lamp: s.asleep ? 'Lights on: wake up' : 'Lights off: bedtime',
        bed: s.asleep ? 'Wake Doozer' : 'Tuck Doozer in',
        jar: s.treats > 0 ? `Give a treat (${plural(s.treats, 'treat')} in the jar)` : 'The treat jar is empty. Treats are earned by focusing.',
        clock: focus.status === 'idle'
          ? `Start a ${focus.minutes}-minute focus session`
          : `Stop the session (${Math.ceil(focus.remainingMs / 60_000)} min left)`,
      };
      for (const id of FURNITURE) {
        memo(`tip-${id}`, tips[id], () => {
          furniture[id].dataset.tip = tips[id];
          furniture[id].setAttribute('aria-label', tips[id]);
        });
      }
    }

    function paint(): void {
      const s = brain.state;
      memo('name', s.name, () => { nameEl.textContent = `${s.name}’s room`; });
      memo('pet-label', s.asleep, () => petHit.setAttribute('aria-label', s.asleep ? `Pet ${s.name} (asleep)` : `Pet ${s.name}`));
      paintClock();
      scenePaint.jar(s.treats, brain.limits.treats);
      scenePaint.bowl(bowlHold ?? s.bowl);
      scenePaint.light(daylight, lampOn());
      paintTips();
      syncSnore();
    }
    scope.add(brain.on('change', paint));

    // ---- layout --------------------------------------------------------------------
    /** The middle of the title bar's button, in the window: where the Card unfolds from. */
    const buttonSpot = (): { x: number; y: number } => ({
      x: geometry.frame.x + (380 - 24) * geometry.scale,
      y: geometry.frame.y + (TITLE_H / 2) * geometry.scale,
    });

    function placeUnfold(): void {
      const panel = open === 'settings' ? settings.el : theCard.el;
      const natural = panel.scrollHeight || panel.offsetHeight || CARD.room;
      const height = root.clientHeight || info.cssHeight || geometry.window.height;
      const spot = placeCard(geometry, visibleSpan(info, height), Math.min(natural, CARD.room));
      unfoldTop = spot.top;
      unfold.style.left = `${geometry.card.x}px`;
      unfold.style.top = `${spot.top}px`;
      unfold.style.setProperty('--roomv-unfold-max', `${Math.min(spot.maxHeight, CARD.room)}px`);
      unfold.dataset.tight = natural > Math.min(spot.maxHeight, CARD.room) ? '1' : '0';
      const from = buttonSpot();
      for (const node of [theCard.el, settings.el]) {
        node.style.setProperty('--dzk-origin', `${Math.round(from.x - geometry.card.x)}px ${Math.round(from.y - spot.top)}px`);
      }
    }

    function applyLayout(): void {
      const size = brain.settings.size.room;
      geometry = roomGeometry(size);
      root.dataset.size = size;
      Object.assign(slot.style, { left: `${geometry.frame.x}px`, top: `${geometry.frame.y}px`, width: `${geometry.frame.w}px`, height: `${geometry.frame.h}px` });
      frame.style.setProperty('--roomv-zoom', String(geometry.scale));
      placeUnfold();
    }

    function panelHeight(): number {
      const panel = open === 'settings' ? settings.el : theCard.el;
      const max = Number.parseFloat(unfold.style.getPropertyValue('--roomv-unfold-max')) || CARD.room;
      return Math.min(panel.offsetHeight || CARD.room, max);
    }

    function hitRegions(): Region[] {
      const regions = [frameRegion(geometry)];
      if (open !== 'none') regions.push(...cardRegions(geometry, unfoldTop, panelHeight()));
      return regions;
    }

    // ---- open and closed -----------------------------------------------------------
    function setOpen(next: RoomOpen): void {
      if (scope.disposed) return;
      if (!awake && next !== 'none') return;
      if (open === next) return;
      open = next;
      root.dataset.open = next;
      placeUnfold();
      if (next === 'card') theCard.open(); else theCard.close();
      if (next === 'settings') settings.open(); else settings.close();
      cardButton.setAttribute('aria-expanded', String(next !== 'none'));
      cardButton.setAttribute('aria-label', next === 'none' ? 'Open the card' : 'Close the card');
      closeChip.hidden = next === 'none';
      // Only the settings panel may take the keyboard: feeding and petting never do.
      services.setFocusable(next === 'settings');
      if (next !== 'none') attention.poke(9000);
      services.regionsChanged();
    }
    closeChip.hidden = true;

    // ---- somebody is there ---------------------------------------------------------
    let visitSince = -Infinity;
    let lastSeenAt = -Infinity;
    let lastPokeAt = -Infinity;
    /** A pointer event arrived. True once the pointer has stayed long enough to be a visit, not a crossing. */
    const visiting = (): boolean => {
      const t = now();
      if (t - lastSeenAt > VISIT_GAP_MS) visitSince = t;
      lastSeenAt = t;
      return t - visitSince >= DWELL_MS;
    };
    const noticed = (): void => {
      if (!awake || !visiting()) return;
      const t = now();
      if (t - lastPokeAt < 400) return;
      lastPokeAt = t;
      attention.poke(HOVER_MS);
      theBehaviour.setAttended(true);
      arm('attended', HOVER_MS, () => theBehaviour.setAttended(false));
    };
    /** A press is a visit however briefly the pointer has been here. */
    const arrived = (): void => {
      visitSince = -Infinity;
      lastPokeAt = -Infinity;
      lastSeenAt = now();
      noticed();
    };
    on(root, 'pointermove', noticed);
    on(root, 'pointerdown', arrived);

    // The eyes follow the pointer across the room, unless Doozer is busy, asleep or reading.
    on(scene, 'pointermove', (event) => {
      if (!awake || theBehaviour.scene !== null || theBehaviour.station !== 'free' || now() - visitSince < DWELL_MS) return;
      const box = scene.getBoundingClientRect();
      const scale = box.width > 0 ? box.width / 380 : 1;
      const x = (event.clientX - box.left) / scale;
      const y = (event.clientY - box.top) / scale;
      doozer.lookAt((x - walker.x) / 150, (y - (FLOOR_Y - 50)) / 150);
    });
    on(scene, 'pointerleave', () => { if (theBehaviour.scene === null) doozer.lookAt(0, 0); });

    // ---- the furniture -------------------------------------------------------------
    const setHot = (id: FurnitureId | null): void => {
      if (id) {
        scene.dataset.hot = id;
        // No more pointer events means the pointer has stopped or gone: let go either way.
        arm('hot', HOT_LIMIT_MS, () => setHot(null));
      } else {
        delete scene.dataset.hot;
        disarm('hot');
      }
    };
    /** A short "not now" wiggle on a piece of furniture. Ended by a timer. */
    function nudge(id: FurnitureId): void {
      scene.dataset.nudge = id;
      arm('nudge', NUDGE_MS, () => { delete scene.dataset.nudge; });
    }

    const press: Record<FurnitureId, () => ActionResult | void> = {
      bowl: () => brain.fillBowl(),
      ball: () => {
        const result = brain.play();
        // Not chased (asleep, too tired): the ball still hops where it was tossed.
        if (!result.ok) tossBall(ballX + (ballX < 190 ? 26 : -26), 'hop');
        return result;
      },
      soap: () => brain.wash(),
      lamp: () => (brain.state.asleep ? brain.wake() : brain.sleep()),
      bed: () => brain.toggleSleep(),
      jar: () => brain.giveTreat(),
      clock: () => {
        if (brain.state.focus.status === 'idle') return brain.startFocus();
        brain.stopFocus();
      },
    };
    for (const id of FURNITURE) {
      const button = furniture[id];
      let acceptedAt = -Infinity;
      on(button, 'click', (event) => {
        // A double-click must not count twice: lights off and on again, a session started and stopped.
        if (!awake || event.timeStamp - acceptedAt < DOUBLE_PRESS_MS) return;
        acceptedAt = event.timeStamp;
        arrived();
        attention.poke(HOVER_MS);
        const result = press[id]();
        if (result && !result.ok) nudge(id);
      });
      on(button, 'pointerenter', () => { if (awake && now() - visitSince >= DWELL_MS) setHot(id); });
      on(button, 'pointermove', () => { if (awake && now() - visitSince >= DWELL_MS) setHot(id); });
      on(button, 'pointerleave', () => { if (scene.dataset.hot === id) setHot(null); });
    }

    // ---- petting: a click, or stroking back and forth across Doozer -------------------
    let strokePx = 0;
    let lastPetAt = -Infinity;
    on(petHit, 'click', () => {
      if (!awake) return;
      lastPetAt = now();
      strokePx = 0;
      arrived();
      brain.pet();
    });
    on(petHit, 'pointermove', (event) => {
      if (!awake || event.buttons !== 0) return;
      strokePx += Math.hypot(event.movementX, event.movementY);
      const t = now();
      if (strokePx > STROKE_PX && t - lastPetAt > STROKE_GAP_MS) {
        strokePx = 0;
        lastPetAt = t;
        brain.pet();
      }
    });
    on(petHit, 'pointerleave', () => { strokePx = 0; });

    // ---- the title bar: the Card's button, and the handle the window is moved by ------
    let cardPressAt = -Infinity;
    on(cardButton, 'click', (event) => {
      if (event.timeStamp - cardPressAt < DOUBLE_PRESS_MS) return;
      cardPressAt = event.timeStamp;
      setOpen(open === 'none' ? 'card' : 'none');
    });
    on(closeChip, 'click', () => setOpen('none'));

    let pressAt: { x: number; y: number } | null = null;
    let dragging = false;
    const endPress = (): void => {
      pressAt = null;
      disarm('press');
    };
    function endDrag(): void {
      endPress();
      if (!dragging) return;
      dragging = false;
      delete root.dataset.dragging;
      disarm('drag');
    }
    function startDrag(at: { x: number; y: number }): void {
      endPress();
      if (dragging || !awake) return;
      dragging = true;
      root.dataset.dragging = '1';
      // The shell moves the window until every button is up and then says `drag-end`.
      // This limit is only for a shell that never says anything.
      arm('drag', DRAG_LIMIT_MS, endDrag);
      let started: Promise<boolean>;
      try {
        started = Promise.resolve(shell.beginDrag({ clientX: at.x, clientY: at.y }));
      } catch {
        endDrag();
        return;
      }
      started.then((moving) => { if (!moving) endDrag(); }, () => endDrag());
    }
    on(title, 'pointerdown', (event) => {
      if (event.button !== 0 || !awake) return;
      if (event.target instanceof Node && cardButton.contains(event.target)) return;
      pressAt = { x: event.clientX, y: event.clientY };
      arm('press', PRESS_LIMIT_MS, endPress);
    });
    on(root, 'pointermove', (event) => {
      // A button is up that we thought was down: the release happened somewhere we never heard about.
      if (event.buttons === 0) { endDrag(); return; }
      if (pressAt && !dragging && Math.hypot(event.clientX - pressAt.x, event.clientY - pressAt.y) >= DRAG_SLOP_PX) startDrag(pressAt);
    });
    on(root, 'pointerup', endDrag);
    on(root, 'pointercancel', endDrag);
    // The backstops: the shell says the drag is over, or that every button is up.
    scope.add(shell.on('drag-end', (next) => {
      endDrag();
      info = next;
      placeUnfold();
      services.regionsChanged();
    }));
    scope.add(shell.on('pointer-released', endDrag));

    on(root, 'contextmenu', (event) => {
      event.preventDefault();
      services.showMenu();
    });

    // ---- at rest: a blink now and then, a "z" when somebody is watching it sleep ------
    function armBlink(): void {
      arm('blink', BLINK_MIN_MS + random() * BLINK_SPREAD_MS, () => {
        if (awake && wasLively === false && !brain.state.asleep && root.dataset.gone !== '1') doozer.blink(true);
        if (awake) armBlink();
      });
    }
    function syncSnore(): void {
      const want = awake && attention.lively && brain.state.asleep && !brain.state.quiet && behaviour?.station === 'bed';
      if (!want) disarm('snore');
      else if (!armed.has('snore')) {
        arm('snore', SNORE_MS, () => {
          if (awake && brain.state.asleep) emotes.emit('z');
          syncSnore();
        });
      }
    }

    // ---- once a minute: the sky moves on, the clock too, and Doozer is looked in on ---
    function armMinute(): void {
      const ms = 60_000 - (date().getTime() % 60_000) + 60;
      arm('minute', ms, () => {
        if (!awake) return;
        paintSky();
        paintClock();
        theBehaviour.check();
        armMinute();
      });
    }

    // ---- what the brain says --------------------------------------------------------
    scope.add(brain.on('focus', (event) => {
      if (event.type !== 'complete') return;
      // DESIGN_SPEC.md 4.5: Doozer celebrates; optionally the Card opens. Never keyboard focus.
      if (!awake) { missed = { treats: event.treats, unlocked: event.unlocked }; return; }
      if (brain.settings.onFocusEnd === 'open-card') setOpen('card');
    }));
    scope.add(brain.on('settings', ({ key }) => {
      if (key === 'size') { applyLayout(); services.regionsChanged(); }
    }));
    scope.add(watchReduceMotion(brain, (reduce) => {
      reduceMotion = reduce;
      root.dataset.motion = reduce ? 'reduce' : 'full';
      doozer.setReduceMotion(reduce);
      emotes.setReduceMotion(reduce);
      theBehaviour.setReduceMotion(reduce);
    }));

    // ---- what the host asks --------------------------------------------------------
    /** Doozer is back after a window change, whether or not the host ever said so. */
    function comeBack(): void {
      delete root.dataset.gone;
      disarm('gone');
      theBehaviour.hold(false);
    }

    function setAwake(next: boolean): void {
      if (awake === next) return;
      awake = next;
      if (!awake) {
        // Hidden behind a fullscreen app. The page is not told, so stop everything here.
        setOpen('none');
        endDrag();
        setHot(null);
        theBehaviour.setAwake(false);
        attention.setEnabled(false);
        emotes.clear();
        props.clear();
        specks.clear();
        delete root.dataset.gone;
        delete scene.dataset.nudge;
        for (const name of [...armed.keys()]) disarm(name);
        applyLively();
      } else {
        attention.setEnabled(true);
        paintSky();
        paint();
        theBehaviour.hold(false);
        theBehaviour.setAwake(true);
        armBlink();
        armMinute();
        attention.poke(3000);
        if (services.needsWelcome()) theBehaviour.welcome(() => services.welcomed());
        else if (missed) {
          const party = missed;
          missed = null;
          theBehaviour.celebrate(party.treats, party.unlocked);
          if (brain.settings.onFocusEnd === 'open-card') setOpen('card');
        }
      }
    }

    // Sizes change without anyone telling us: the Card grows a row.
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => { placeUnfold(); services.regionsChanged(); });
      for (const node of [theCard.el, settings.el]) observer.observe(node);
      scope.add(() => observer.disconnect());
    }
    scope.add(attachTooltips(root, { timers }));

    host.append(root);
    scope.add(() => root.remove());
    applyLayout();
    drawBall();
    paintSky();
    paint();
    applyLively();
    armBlink();
    armMinute();
    attention.poke(4000);
    if (services.needsWelcome()) theBehaviour.welcome(() => services.welcomed());

    live = {
      hitRegions,
      leave: () => {
        setOpen('none');
        // Whatever Doozer was doing stops here; it hops and pops out.
        theBehaviour.hold(true);
        arm('gone', GONE_LIMIT_MS, comeBack);
        return doozer.perform('pop-out').then(() => { if (armed.has('gone')) root.dataset.gone = '1'; });
      },
      enter: () => {
        comeBack();
        attention.poke(3000);
        return doozer.perform('pop-in');
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
      setSkyHour(hour) {
        skyHour = hour !== null && Number.isFinite(hour) ? hour : null;
        paintSky();
      },
      snapshot: () => ({
        open,
        awake,
        lively: wasLively === true,
        station: theBehaviour.station,
        desired: theBehaviour.desired,
        scene: theBehaviour.scene,
        x: Math.round(walker.x * 10) / 10,
        place,
        pose: doozer.pose,
        mood: doozer.mood,
        busy: doozer.busy,
        gone: root.dataset.gone === '1',
        bowl: Number(scene.querySelector<SVGElement>('.roomv-f-bowl')?.dataset.level ?? 0),
        bookHeld,
        toy,
        ballX: Math.round(ballX),
        lamp: scene.dataset.lamp === 'on',
        emotes: emotes.count,
        props: props.size + specks.size,
        pressed: pressAt !== null,
        dragging,
        hot: scene.dataset.hot ?? '',
        time: timeEl.textContent ?? '',
        sky: scene.dataset.sky ?? '',
        timers: [...armed.keys(), ...theBehaviour.timers().map((name) => `doozer:${name}`)],
      }),
      parts: () => ({ root, frame, title, cardButton, scene, petHit, furniture, strip, card: theCard, settings, doozer, close: closeChip }),
      unmount: () => scope.dispose(),
    };
  }

  return {
    id: 'room',
    windowSettings: ['size'],
    window: (request: WindowRequest): WindowMode => roomWindow(request.settings.size.room, request.position),
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
    setSkyHour: (hour) => live?.setSkyHour(hour),
    snapshot: () => live?.snapshot() ?? null,
    parts: () => live?.parts() ?? null,
  };
}
