// The Pill view: Doozer's home base (DESIGN_SPEC.md 6.1). A dark pill docked to a
// screen edge with Doozer tucked into its left end, a name, one status line and a ring.
// Click it and the Card unfolds from it; the settings panel takes the Card's place.
//
// The view draws and forwards clicks. Every rule is the brain's; the window, the save
// and the clock are the host's (src/host/).
//
// Never stuck, by construction rather than by repair:
//   - What is open is one variable (`open`) mirrored in one attribute. Opening and
//     closing set it and return; nothing waits for an animation or a frame.
//   - Everything temporary has a timer behind it: the pressed look, the hover look,
//     Doozer being popped out, the hatching, the lively spell (attention.ts).
//   - A press ends on pointerup, pointercancel, pointerleave, the shell's
//     `pointer-released`, and in any case after a few seconds.
//   - Tucked away (`setAwake(false)`) stops every timer this view owns.
//
// Render on demand: at rest the pill is perfectly still apart from a two-redraw blink
// every few seconds. Doozer only animates while `Attention` says someone is there.

import './pill.css';
import type { ViewId } from '../../core/contract';
import { createDoozer, type Doozer } from '../../character/doozer';
import { frames } from '../../frames';
import { realTimers, type Timers } from '../../character/timers';
import type { View, ViewContext, WindowRequest } from '../../host/view';
import { regionOf, type Region, type WindowInfo, type WindowMode } from '../../shell';
import { createCard, type Card } from '../../ui/card';
import { createMemo, h } from '../../ui/dom';
import { createEmoteLayer } from '../../ui/emotes';
import { ICONS } from '../../ui/icons';
import { SceneRunner, Scope } from '../../ui/lifecycle';
import { watchReduceMotion } from '../../ui/motion';
import { StageDirector, type StageFx } from '../../ui/presenter';
import { createSettingsPanel, type SettingsPanel } from '../../ui/settings';
import { Attention } from './attention';
import { favouriteLine, pillFace, type PillFace } from './face';
import { SIZE_SCALE, WINDOW_HEIGHT, pillWindow, unfoldMaxHeight } from './layout';

export interface PillViewOptions {
  timers?: Timers;
  random?: () => number;
  /** Milliseconds, monotonic. Default `performance.now`. */
  now?: () => number;
}

export type PillOpen = 'none' | 'card' | 'settings';

/** What the view is doing right now. For tests and the scripted runs; nothing depends on it. */
export interface PillSnapshot {
  open: PillOpen;
  awake: boolean;
  /** Doozer is animating (someone is there, or something just happened). */
  lively: boolean;
  pressed: boolean;
  hover: boolean;
  hatching: boolean;
  /** The sound question is on screen. */
  asking: boolean;
  /** Doozer is popped out for a window change. */
  gone: boolean;
  status: string;
  statusTone: string;
  ring: string;
  /** The pill's Doozer is in the middle of a face or a performance. */
  miniBusy: boolean;
  miniMood: string;
  /** The Card's Doozer likewise. */
  stageBusy: boolean;
  /** Emotes on screen over the pill. */
  emotes: number;
  /** The view's own timers that are armed. Tucked away, this must be empty. */
  timers: string[];
}

export interface PillView extends View {
  /** Null when not mounted. */
  snapshot(): PillSnapshot | null;
  /** Open the Card, the settings panel, or fold everything away. */
  setOpen(open: PillOpen): void;
  /** The pieces, for tests and the scripted runs. Null when not mounted. */
  parts(): { root: HTMLElement; pill: HTMLElement; reach: HTMLElement; card: Card; settings: SettingsPanel; mini: Doozer; ask: HTMLElement } | null;
}

const ALL_VIEWS: readonly ViewId[] = ['pill', 'room', 'island', 'desktop'];
const MINI_PX = 62;
/** Long enough for any scene the kit plays (its limit is 8 s). */
const SCENE_MS = 9000;
/** How long Doozer stays lively after the pointer was last seen resting on the window. */
const HOVER_MS = 3500;
/**
 * The pointer has to stay this long before it counts as a visit. A pill docked to the
 * top of the screen sits where the pointer crosses all day on its way to title bars and
 * tabs; a crossing must cost nothing.
 */
const DWELL_MS = 180;
/** No pointer event for this long means the visit is over; the next one starts a new one. */
const VISIT_GAP_MS = 600;
/** Stroking this far across Doozer is one pet, at most this often (as on the Card). */
const STROKE_PX = 130;
const STROKE_GAP_MS = 600;
/** A second press sooner than this is the same press (as on the Card). */
const DOUBLE_PRESS_MS = 320;
/** The hover and pressed looks give up after this long without a pointer event. */
const HOVER_LIMIT_MS = 4000;
const PRESS_LIMIT_MS = 3000;
/** Doozer stays popped out no longer than this, whatever the host does next. */
const GONE_LIMIT_MS = 1500;
const WELCOME_LIMIT_MS = 12_000;
const BLINK_MIN_MS = 4000;
const BLINK_SPREAD_MS = 5000;

const EGG = /* html */ `
  <svg class="pillv-egg" viewBox="0 0 46 56" aria-hidden="true">
    <path d="M23 3C12 3 4 19 4 33c0 12 8 20 19 20s19-8 19-20C42 19 34 3 23 3z" fill="#FFF3DC" stroke="#3a2a26" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="15" cy="27" r="4" fill="#FFC9A8"/><circle cx="30" cy="38" r="5" fill="#FFC9A8"/><circle cx="29" cy="18" r="3" fill="#FFC9A8"/>
    <path d="M13 13c2-3 5-5 8-6" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`;

const RING = /* html */ `
  <svg viewBox="0 0 34 34" aria-hidden="true">
    <circle class="pillv-ring-track" cx="17" cy="17" r="14"/>
    <circle class="pillv-ring-val" cx="17" cy="17" r="14" pathLength="100"/>
  </svg>
  <span class="pillv-ring-ico" aria-hidden="true"></span>`;

export function createPillView(options: PillViewOptions = {}): PillView {
  const timers = options.timers ?? realTimers;
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => performance.now());

  /** Everything that exists only while mounted. */
  let live: Mounted | null = null;

  interface Mounted {
    hitRegions(): Region[];
    leave(): Promise<unknown>;
    enter(): Promise<unknown>;
    setAwake(awake: boolean): void;
    windowChanged(info: WindowInfo): void;
    openSettings(): void;
    openCard(keyboard: boolean): void;
    setOpen(open: PillOpen): void;
    snapshot(): PillSnapshot;
    parts(): NonNullable<ReturnType<PillView['parts']>>;
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

    // ---- elements ------------------------------------------------------------------
    const mini = createDoozer({ style: 'bold', size: MINI_PX, palette: brain.settings.palette, timers, random });
    scope.add(() => mini.destroy());
    const pocket = h('span', { class: 'pillv-pocket', 'aria-hidden': 'true', html: EGG });
    pocket.append(mini.el);
    const nameEl = h('b', { class: 'pillv-name' });
    const statusEl = h('span', { class: 'pillv-status', 'data-tone': 'plain' });
    const ring = h('span', { class: 'pillv-ring', html: RING });
    const ringValue = ring.querySelector<SVGElement>('.pillv-ring-val');
    const ringIcon = ring.querySelector<HTMLElement>('.pillv-ring-ico');
    const pill = h('button', { type: 'button', class: 'pillv-pill', 'aria-expanded': 'false' }, [
      pocket, h('span', { class: 'pillv-text' }, [nameEl, statusEl]), ring,
    ]);
    const reach = h('div', { class: 'pillv-reach', 'aria-hidden': 'true' });
    const emotes = createEmoteLayer({ timers, random, max: 8, origin: { x: 0.44, y: 0.52, spreadX: 0.14, spreadY: 0.07 } });
    emotes.el.classList.add('pillv-emotes');
    scope.add(() => emotes.destroy());
    const face = h('div', { class: 'pillv-face' }, [pill, reach, emotes.el]);

    const askYes = h('button', { type: 'button', class: 'pillv-ask-btn', 'data-primary': true, text: 'Sounds on' });
    const askNo = h('button', { type: 'button', class: 'pillv-ask-btn', text: 'No thanks' });
    const ask = h('div', { class: 'pillv-ask', role: 'group', 'aria-label': 'Sound', hidden: true }, [
      h('p', { text: 'Would you like Doozer to make little sounds?' }),
      h('div', { class: 'pillv-ask-row' }, [askNo, askYes]),
      h('small', { text: 'You can change this in Settings at any time.' }),
    ]);

    const unfold = h('div', { class: 'pillv-unfold', 'data-tight': '0' });
    const root = h('div', { class: 'dzk pillv', 'data-dock': brain.settings.pillDock, 'data-open': 'none' }, [face, ask, unfold]);

    const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void): void => {
      target.addEventListener(type, handler);
      scope.add(() => target.removeEventListener(type, handler));
    };

    // ---- state ---------------------------------------------------------------------
    let open: PillOpen = 'none';
    /** What to go back to when the settings panel closes. */
    let settingsFrom: PillOpen = 'none';
    let awake = true;
    let hatching = false;
    let statusOverride: string | null = null;
    let missedCelebration = false;
    let info = context.info;
    let shownFace: PillFace | null = null;

    // ---- liveliness ----------------------------------------------------------------
    // Declared before the Card and the directors, so that when the brain announces
    // something, the view is already lively by the time they react to it.
    let card: Card | null = null;
    let director: StageDirector | null = null;
    const attention = new Attention({
      timers,
      now,
      onChange: (lively) => {
        mini.setLive(lively);
        // At rest the pill plays nothing at all, not even the z's of a sleeping Doozer.
        director?.setActive(lively);
        card?.setLively(lively);
        // A session's countdown is in seconds for someone, in minutes for nobody.
        paint();
      },
    });
    scope.add(() => attention.destroy());
    scope.add(brain.on('action', () => attention.poke(SCENE_MS)));
    scope.add(brain.on('refuse', () => attention.poke(2500)));
    scope.add(brain.on('mood', () => { if (!brain.state.quiet) attention.poke(3000); }));
    scope.add(brain.on('focus', (event) => {
      if (event.type !== 'start' && event.type !== 'complete') return;
      attention.poke(SCENE_MS);
      if (event.type !== 'complete') return;
      // Spec 4.5: Doozer celebrates; optionally the Card opens. Never keyboard focus.
      if (!awake) { missedCelebration = true; return; }
      if (brain.settings.onFocusEnd === 'open-card') setOpen('card');
    }));
    scope.add(brain.on('away', () => {
      // Back after a while: a small hello, unless asleep, focusing or just hatching.
      const s = brain.state;
      if (!awake || hatching || s.asleep || s.quiet) return;
      attention.poke(4000);
      void mini.perform('wave');
    }));

    // ---- the pill's own Doozer -----------------------------------------------------
    const fx: StageFx = {
      emote: (kind, emoteOptions) => emotes.emit(kind, emoteOptions),
      // No room for a snack or a ball in a pill: Doozer's face plays the scene.
      prop: () => ({ bite() {}, remove() {} }),
      treatsEarned: (count) => emotes.emit('snack', { count: Math.min(3, Math.max(1, count)), icon: 'biscuit' }),
    };
    const theDirector = new StageDirector(brain, mini, fx, { timers });
    director = theDirector;
    theDirector.setActive(false);
    scope.add(() => theDirector.destroy());
    const scenes = new SceneRunner({ timers });
    scope.add(() => scenes.destroy());

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
    mini.setLive(false);
    theCard.setLively(false);

    // ---- painting ------------------------------------------------------------------
    function paint(): void {
      const f = pillFace(brain.state, brain.limits, attention.lively || open !== 'none');
      shownFace = f;
      const status = statusOverride ?? f.status;
      const tone = statusOverride === null ? f.statusTone : 'plain';
      memo('name', f.name, () => { nameEl.textContent = f.name; });
      memo('status', status, () => { statusEl.textContent = status; });
      memo('tone', tone, () => { statusEl.dataset.tone = tone; });
      memo('ring', `${f.ring.kind}:${f.ring.percent}:${f.ring.tone}`, () => {
        ring.dataset.kind = f.ring.kind;
        ring.dataset.tone = f.ring.tone;
        ringValue?.setAttribute('stroke-dasharray', `${f.ring.percent} 100`);
        if (ringValue) ringValue.style.visibility = f.ring.percent < 1 ? 'hidden' : 'visible';
      });
      memo('icon', f.ring.icon, () => { if (ringIcon) ringIcon.innerHTML = ICONS[f.ring.icon]; });
      memo('label', `${f.label}|${open}`, () => {
        pill.setAttribute('aria-label', `${f.label} ${open === 'none' ? 'Open' : 'Close'} the card.`);
      });
    }
    scope.add(brain.on('change', paint));

    // ---- layout --------------------------------------------------------------------
    function applyLayout(): void {
      const dock = brain.settings.pillDock;
      const size = brain.settings.size.pill;
      root.dataset.dock = dock;
      face.style.setProperty('--pillv-zoom', String(SIZE_SCALE[size]));
      // The page's real height if it has one; what the shell said, or the size asked for, if not.
      const height = root.clientHeight || info.cssHeight || WINDOW_HEIGHT;
      const max = unfoldMaxHeight(height, dock, size);
      unfold.style.setProperty('--pillv-unfold-max', `${max}px`);
      unfold.dataset.tight = theCard.el.scrollHeight > max ? '1' : '0';
      placeOrigin();
    }

    /** Where the Card unfolds from: the middle of the pill. */
    function placeOrigin(): void {
      const pillBox = pill.getBoundingClientRect();
      const unfoldBox = unfold.getBoundingClientRect();
      const y = brain.settings.pillDock === 'bottom-right' ? 'calc(100% + 24px)' : '-20px';
      for (const panel of [theCard.el, settings.el]) {
        const x = pillBox.left + pillBox.width / 2 - (unfoldBox.left + panel.offsetLeft);
        panel.style.setProperty('--dzk-origin', `${Math.round(x)}px ${y}`);
      }
    }

    function hitRegions(): Region[] {
      const pillBox = pill.getBoundingClientRect();
      const regions: Region[] = [regionOf(pill, { radius: pillBox.height / 2 }), regionOf(reach)];
      const panel = open === 'card' ? theCard.el : open === 'settings' ? settings.el : null;
      if (panel) {
        // The panel springs open with a scale; its layout box is where it ends up.
        const box = unfold.getBoundingClientRect();
        regions.push({ x: box.left + panel.offsetLeft, y: box.top + panel.offsetTop, w: panel.offsetWidth, h: panel.offsetHeight, r: 26 });
      }
      if (!ask.hidden) regions.push(regionOf(ask));
      return regions;
    }

    // ---- open and closed -----------------------------------------------------------
    /**
     * The Card was opened by the keyboard shortcut: it has the keyboard until it closes.
     * Opened any other way it never does, so that feeding and petting cannot pull the
     * keyboard away from what you are typing in.
     */
    let cardKeyboard = false;

    function setOpen(next: PillOpen): void {
      if (scope.disposed) return;
      if (!awake && next !== 'none') return;
      if (open === next) return;
      open = next;
      // (It keeps it through a detour to the settings, which may have the keyboard anyway.)
      if (next !== 'card' && next !== 'settings') cardKeyboard = false;
      root.dataset.open = next;
      placeOrigin();
      if (next === 'card') theCard.open(); else theCard.close();
      if (next === 'settings') settings.open(); else settings.close();
      pill.setAttribute('aria-expanded', String(next !== 'none'));
      // The settings panel may take the keyboard, and a Card that was asked for from the
      // keyboard; a Card opened with the mouse never does.
      services.setFocusable(next === 'settings' || (next === 'card' && cardKeyboard));
      if (next === 'card' && cardKeyboard) theCard.focus();
      if (next !== 'none') attention.poke(SCENE_MS);
      syncAsk();
      paint();
      services.regionsChanged();
    }

    // ---- the sound question (asked once) -------------------------------------------
    function syncAsk(): void {
      const want = awake && !hatching && !brain.settings.soundAsked && open === 'none' && !brain.state.quiet;
      if (ask.hidden === !want) return;
      ask.hidden = !want;
      services.regionsChanged();
    }
    const answer = (sound: boolean): void => {
      if (brain.settings.sound !== sound) brain.setSetting('sound', sound);
      brain.setSetting('soundAsked', true);
      if (sound) services.chime();
    };
    on(askYes, 'click', () => answer(true));
    on(askNo, 'click', () => answer(false));
    scope.add(brain.on('settings', ({ key }) => {
      // Turning sound on or off anywhere else answers the question too.
      if (key === 'sound' && !brain.settings.soundAsked) brain.setSetting('soundAsked', true);
      if (key === 'size') { applyLayout(); services.regionsChanged(); }
      syncAsk();
    }));
    scope.add(brain.on('focus', syncAsk));

    // ---- pressing, hovering, stroking ----------------------------------------------
    let acceptedAt = -Infinity;
    let strokePx = 0;
    let lastPetAt = -Infinity;
    let lastPokeAt = -Infinity;
    let visitSince = -Infinity;
    let lastSeenAt = -Infinity;

    const setPressed = (pressed: boolean): void => {
      if (pressed) {
        face.dataset.pressed = '1';
        arm('press', PRESS_LIMIT_MS, () => setPressed(false));
      } else {
        delete face.dataset.pressed;
        disarm('press');
      }
    };
    const setHover = (hover: boolean): void => {
      if (hover) {
        face.dataset.hover = '1';
        // No more pointer events means the pointer has stopped or gone: relax either way.
        arm('hover', HOVER_LIMIT_MS, () => setHover(false));
      } else {
        delete face.dataset.hover;
        disarm('hover');
      }
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

    on(face, 'click', (event) => {
      if (event.timeStamp - acceptedAt < DOUBLE_PRESS_MS) return;
      acceptedAt = event.timeStamp;
      setPressed(false);
      setOpen(open === 'none' ? 'card' : 'none');
    });
    on(face, 'pointerdown', (event) => {
      if (event.button !== 0) return;
      setPressed(true);
      // A press is a visit however briefly the pointer has been here.
      visitSince = -Infinity;
      setHover(true);
    });
    on(face, 'pointerup', () => setPressed(false));
    on(face, 'pointercancel', () => setPressed(false));
    on(face, 'pointerenter', () => { noticed(); });
    on(face, 'pointerleave', () => { setHover(false); setPressed(false); strokePx = 0; mini.lookAt(0, 0); });
    on(face, 'pointermove', (event) => {
      noticed();
      // A button is up that we thought was down: the release happened somewhere we never heard about.
      if (event.buttons === 0) setPressed(false);
      // The pointer is only passing: no hover look, no glance, no stroke.
      if (now() - visitSince < DWELL_MS) return;
      setHover(true);
      const s = brain.state;
      if (!s.asleep && !s.quiet && theDirector.scene === null && !hatching) {
        const box = face.getBoundingClientRect();
        mini.lookAt((event.clientX - box.left - 36) / 90, (event.clientY - box.top - 14) / 60);
      }
      // Stroking across Doozer is a pet (spec 5.4).
      if (event.buttons !== 0 || hatching) return;
      const target = event.target;
      if (target !== reach && !(target instanceof Node && pocket.contains(target))) { strokePx = 0; return; }
      strokePx += Math.hypot(event.movementX, event.movementY);
      const t = now();
      if (strokePx > STROKE_PX && t - lastPetAt > STROKE_GAP_MS) {
        strokePx = 0;
        lastPetAt = t;
        brain.pet();
      }
    });
    // The backstop: the shell says every button is up, whether or not a pointerup came.
    scope.add(shell.on('pointer-released', () => setPressed(false)));
    on(root, 'pointermove', noticed);
    on(root, 'contextmenu', (event) => {
      event.preventDefault();
      services.showMenu();
    });

    // ---- at rest: a blink now and then ----------------------------------------------
    function armBlink(): void {
      arm('blink', BLINK_MIN_MS + random() * BLINK_SPREAD_MS, () => {
        if (awake && !attention.lively && !brain.state.asleep && !hatching) mini.blink(true);
        if (awake) armBlink();
      });
    }

    // ---- first run: Doozer hatches -------------------------------------------------
    const wobble = (degrees: number): void => {
      const egg = pocket.querySelector<SVGElement>('.pillv-egg');
      if (!egg || typeof egg.animate !== 'function' || root.dataset.motion === 'reduce') return;
      egg.animate(
        [{ rotate: '0deg' }, { rotate: `${-degrees}deg` }, { rotate: `${degrees}deg` }, { rotate: `${-degrees * 0.5}deg` }, { rotate: '0deg' }],
        { duration: 520, easing: 'ease-in-out' },
      );
      frames.wake();
    };

    /** Which hatching is the current one, so that a cancelled one cannot end its successor. */
    let hatchRun = 0;

    function hatch(): void {
      if (hatching || !services.needsWelcome()) return;
      const run = ++hatchRun;
      hatching = true;
      face.dataset.hatching = '1';
      statusOverride = 'is hatching';
      paint();
      syncAsk();
      attention.poke(WELCOME_LIMIT_MS);
      void scenes.play('hatch', async (scene) => {
        // However the scene ends, the egg is gone and Doozer is there.
        scene.cleanup(() => { delete face.dataset.hatching; });
        await scene.wait(900);
        wobble(9);
        await scene.wait(800);
        wobble(16);
        await scene.wait(700);
        delete face.dataset.hatching;
        emotes.emit('sparkle', { count: 4 });
        await scene.until(mini.perform('pop-in'));
        mini.flash('wow', 800);
        await scene.wait(800);
        await scene.until(mini.perform('wave'));
        // It picks its favourite snack (spec 3.2). Shown once, here.
        const favourite = brain.state.favourite;
        statusOverride = favouriteLine(favourite);
        paint();
        emotes.emit('snack', { icon: favourite });
        emotes.emit('heart', { count: 2 });
        mini.flash('love', 1500);
        await scene.wait(2800);
      }, WELCOME_LIMIT_MS).then((outcome) => { if (run === hatchRun) endHatch(outcome !== 'interrupted'); });
    }

    /** The hatching is over, however it ended. Cut short, it is shown again next time. */
    function endHatch(completed: boolean): void {
      if (!hatching || scope.disposed) return;
      hatching = false;
      statusOverride = null;
      delete face.dataset.hatching;
      if (completed) services.welcomed();
      paint();
      syncAsk();
    }

    // ---- what the host asks --------------------------------------------------------
    function setGone(gone: boolean): void {
      if (gone) {
        face.dataset.gone = '1';
        arm('gone', GONE_LIMIT_MS, () => setGone(false));
      } else {
        delete face.dataset.gone;
        disarm('gone');
      }
    }

    function celebrateLate(): void {
      missedCelebration = false;
      attention.poke(SCENE_MS);
      emotes.emit('sparkle', { count: 5 });
      void mini.perform('celebrate');
      if (brain.settings.onFocusEnd === 'open-card') setOpen('card');
    }

    function setAwake(next: boolean): void {
      if (awake === next) return;
      awake = next;
      if (!awake) {
        // Hidden behind a fullscreen app. The page is not told, so stop everything here.
        scenes.cancel();
        endHatch(false);
        setOpen('none');
        attention.setEnabled(false);
        emotes.clear();
        setHover(false);
        setPressed(false);
        setGone(false);
        disarm('blink');
        syncAsk();
      } else {
        attention.setEnabled(true);
        armBlink();
        paint();
        syncAsk();
        attention.poke(3000);
        if (services.needsWelcome()) hatch();
        else if (missedCelebration) celebrateLate();
      }
    }

    scope.add(watchReduceMotion(brain, (reduce) => {
      root.dataset.motion = reduce ? 'reduce' : 'full';
      mini.setReduceMotion(reduce);
      emotes.setReduceMotion(reduce);
    }));

    // Sizes change without anyone telling us: the status line gets longer, the Card grows a row.
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(() => { placeOrigin(); services.regionsChanged(); });
      for (const node of [pill, theCard.el, settings.el, ask]) observer.observe(node);
      scope.add(() => observer.disconnect());
    }

    host.append(root);
    scope.add(() => root.remove());
    if (typeof window !== 'undefined') {
      const resized = (): void => { applyLayout(); services.regionsChanged(); };
      window.addEventListener('resize', resized);
      scope.add(() => window.removeEventListener('resize', resized));
    }
    applyLayout();
    paint();
    armBlink();
    attention.poke(4000);
    if (services.needsWelcome()) hatch();
    else syncAsk();

    live = {
      hitRegions,
      leave: () => mini.perform('pop-out').then(() => setGone(true)),
      enter: () => {
        setGone(false);
        attention.poke(3000);
        return mini.perform('pop-in');
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
      openCard(keyboard) {
        if (!keyboard) { setOpen('card'); return; }
        // The shortcut again, with the Card already under the keyboard: close it.
        if (open === 'card' && cardKeyboard) { setOpen('none'); return; }
        cardKeyboard = true;
        if (open === 'card') services.setFocusable(true); else setOpen('card');
        if (open === 'card') theCard.focus(); else cardKeyboard = false;
      },
      setOpen,
      snapshot: () => ({
        open,
        awake,
        lively: attention.lively,
        pressed: face.dataset.pressed === '1',
        hover: face.dataset.hover === '1',
        hatching,
        asking: !ask.hidden,
        gone: face.dataset.gone === '1',
        status: statusEl.textContent ?? '',
        statusTone: statusEl.dataset.tone ?? '',
        ring: shownFace ? `${shownFace.ring.kind}:${shownFace.ring.percent}` : '',
        miniBusy: mini.busy,
        miniMood: mini.mood,
        stageBusy: theCard.doozer.busy,
        emotes: emotes.count,
        timers: [...armed.keys()],
      }),
      parts: () => ({ root, pill, reach, card: theCard, settings, mini, ask }),
      unmount: () => scope.dispose(),
    };
  }

  return {
    id: 'pill',
    windowSettings: ['pillDock'],
    window: (request: WindowRequest): WindowMode => pillWindow(request.settings.pillDock),
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
    openCard: (keyboard) => live?.openCard(keyboard),
    setOpen: (open) => live?.setOpen(open),
    snapshot: () => live?.snapshot() ?? null,
    parts: () => live?.parts() ?? null,
  };
}
