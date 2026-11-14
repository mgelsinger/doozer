// The Card: "one card with everything" (DESIGN_SPEC.md 5.3). Shared by every view.
// From top to bottom: Doozer on a small stage (pettable), four need meters, the four care
// actions, the bowl and the treat jar, the focus block, the view switcher, settings and mute.
//
// It talks to the pet only through the `Brain` interface, and to everything else through
// plain callbacks. It knows nothing about which view it is shown in.

import './kit.css';
import type { ActionResult, Brain, FocusMinutes, FoodId, ToyId, ViewId } from '../core/contract';
import { createDoozer, type Doozer, type LineStyle } from '../character/doozer';
import { realTimers, type Timers } from '../character/timers';
import { createMemo, h, need, nudge, pulse } from './dom';
import { createEmoteLayer } from './emotes';
import { clockText, formatClock, plural } from './format';
import { ICONS, ITEM_NAME, VIEW_ICON } from './icons';
import { Scope } from './lifecycle';
import { watchReduceMotion } from './motion';
import { createNeedMeters } from './meters';
import { StageDirector, type StageFx, type StageProp } from './presenter';
import { attachTooltips } from './tooltip';

export interface CardOptions {
  /** One of the four view buttons was pressed (never the current view). */
  onSwitchView?(view: ViewId): void;
  /** The Settings button was pressed. The host decides where the settings panel appears. */
  onOpenSettings?(): void;
  /** The Card opened or closed, by any route. Views use this to update their hit regions. */
  onOpenChange?(open: boolean): void;
  /** Which view is on screen. Default: `brain.settings.lastView`. */
  currentView?(): ViewId;
  /** Views that are not built yet: shown disabled, as "coming soon". */
  unavailableViews?: readonly ViewId[];
  /** Start open. Default true. */
  open?: boolean;
  /** Line style of the Doozer on the stage. Default 'bold'. */
  lineStyle?: LineStyle;
  /** Escape closes the Card. Default true. */
  closeOnEscape?: boolean;
  timers?: Timers;
  random?: () => number;
}

export interface Card {
  readonly el: HTMLElement;
  /** The Doozer on the stage. */
  readonly doozer: Doozer;
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  toggle(): void;
  /** Move keyboard focus into the Card (to the first action). */
  focus(): void;
  /**
   * False keeps an open Card on screen but perfectly still: its Doozer pauses and no scenes
   * play, while the meters and the clock keep painting. For a view nobody is looking at
   * (render on demand). Default true.
   */
  setLively(on: boolean): void;
  destroy(): void;
}

const VIEWS: readonly { id: ViewId; label: string }[] = [
  { id: 'pill', label: 'Pill' }, { id: 'room', label: 'Room' }, { id: 'island', label: 'Island' }, { id: 'desktop', label: 'Desktop' },
];
const LENGTHS: readonly FocusMinutes[] = [15, 25, 50];
const STAGE_DOOZER_PX = 96;
/** Stroking this many pixels across Doozer counts as one pet, at most this often. */
const STROKE_PX = 130;
const STROKE_GAP_MS = 600;
/** A second press of the same button sooner than this is treated as the same press. */
const DOUBLE_PRESS_MS = 320;

const TEMPLATE = /* html */ `
  <div class="dzk-stage" data-night="0">
    <div class="dzk-stage-bg"></div>
    <div class="dzk-stage-props"></div>
    <button type="button" class="dzk-pet" aria-label="Pet Doozer"></button>
  </div>
  <div data-slot="needs"></div>
  <div class="dzk-actions" role="group" aria-label="Care">
    <button type="button" class="dzk-act" data-act="feed">${ICONS.feed}<span>Feed</span></button>
    <button type="button" class="dzk-act" data-act="play">${ICONS.play}<span>Play</span></button>
    <button type="button" class="dzk-act" data-act="wash">${ICONS.wash}<span>Wash</span></button>
    <button type="button" class="dzk-act" data-act="sleep"><span class="dzk-act-ico"></span><span class="dzk-act-label"></span></button>
  </div>
  <div class="dzk-pantry">
    <div class="dzk-cell" data-cell="bowl">
      ${ICONS.bowl}<span class="dzk-pips" role="img">${'<i></i>'.repeat(3)}</span>
      <button type="button" class="dzk-mini" data-act="fill">Fill</button>
    </div>
    <div class="dzk-cell" data-cell="jar">
      ${ICONS.jar}<span class="dzk-count"></span>
      <button type="button" class="dzk-mini" data-act="treat">Give one</button>
    </div>
  </div>
  <div class="dzk-focus" data-status="idle" role="group" aria-label="Focus timer">
    <div>
      <div class="dzk-clock-row"><span class="dzk-clock" role="timer"></span><span class="dzk-paused" hidden>paused</span></div>
      <div class="dzk-lengths" role="radiogroup" aria-label="Session length in minutes">
        ${LENGTHS.map((m) => `<button type="button" class="dzk-chip" role="radio" data-min="${m}" aria-label="${m} minutes">${m}</button>`).join('')}
        <span class="dzk-unit" aria-hidden="true">min</span>
      </div>
      <div class="dzk-length-note" hidden></div>
    </div>
    <div class="dzk-focus-btns">
      <button type="button" class="dzk-go" data-act="focus"><span class="dzk-go-ico"></span><span class="dzk-go-label"></span></button>
      <button type="button" class="dzk-stop" data-act="focus-stop" hidden>${ICONS.stop}<span>Stop</span></button>
    </div>
    <div class="dzk-progress" aria-hidden="true"><b></b></div>
    <div class="dzk-focus-foot">
      <span class="dzk-streak">${ICONS.flame}<b></b><span class="dzk-streak-best"></span></span>
      <span class="dzk-next" hidden><span>next</span><span class="dzk-next-ico"></span><span class="dzk-next-in"></span></span>
    </div>
  </div>
  <div class="dzk-views" role="group" aria-label="Views">
    ${VIEWS.map((v) => `<button type="button" class="dzk-view" data-view="${v.id}">${ICONS[VIEW_ICON[v.id]]}<span>${v.label}</span></button>`).join('')}
  </div>
  <div class="dzk-foot">
    <button type="button" class="dzk-link" data-act="settings">${ICONS.settings}<span>Settings</span></button>
    <button type="button" class="dzk-link" data-act="mute"><span class="dzk-mute-ico"></span><span class="dzk-mute-label"></span></button>
  </div>
`;

export function createCard(brain: Brain, options: CardOptions = {}): Card {
  const timers = options.timers ?? realTimers;
  const scope = new Scope();
  const memo = createMemo();

  const el = h('section', { class: 'dzk dzk-card', 'aria-label': 'Doozer', 'data-open': '1', html: TEMPLATE });
  const stage = need(el, '.dzk-stage');
  const propLayer = need(el, '.dzk-stage-props');
  const petButton = need<HTMLButtonElement>(el, '.dzk-pet');
  const focusBox = need(el, '.dzk-focus');
  const clock = need(el, '.dzk-clock');
  const jarCount = need(el, '.dzk-count');
  const button = (act: string) => need<HTMLButtonElement>(el, `[data-act="${act}"]`);

  // ---- the stage ------------------------------------------------------------------
  const doozer = createDoozer({ style: options.lineStyle ?? 'bold', size: STAGE_DOOZER_PX, palette: brain.settings.palette, timers });
  petButton.append(doozer.el);
  scope.add(() => doozer.destroy());

  const emotes = createEmoteLayer({ timers, random: options.random, origin: { x: 0.5, y: 0.46, spreadX: 0.14, spreadY: 0.1 } });
  stage.append(emotes.el);
  scope.add(() => emotes.destroy());

  let reduceMotion = false;
  scope.add(watchReduceMotion(brain, (reduce) => {
    reduceMotion = reduce;
    el.dataset.motion = reduce ? 'reduce' : 'full';
    doozer.setReduceMotion(reduce);
  }));

  const props = new Set<HTMLElement>();
  const makeProp = (kind: 'food' | 'toy', item: FoodId | ToyId): StageProp => {
    const node = h('div', { class: `dzk-prop dzk-prop-${kind}`, 'data-item': item, 'aria-hidden': 'true', html: ICONS[item] });
    propLayer.append(node);
    props.add(node);
    return {
      bite(step) { node.dataset.bite = String(Math.max(0, Math.min(3, Math.round(step)))); },
      remove() { props.delete(node); node.remove(); },
    };
  };
  scope.add(() => { for (const node of props) node.remove(); props.clear(); });

  const fx: StageFx = {
    emote: (kind, emoteOptions) => emotes.emit(kind, emoteOptions),
    prop: makeProp,
    treatsEarned: () => pulse(need(el, '[data-cell="jar"] .dzk-ico'), reduceMotion),
  };
  const director = new StageDirector(brain, doozer, fx, { timers });
  scope.add(() => director.destroy());

  // Petting: a click, or stroking back and forth across Doozer.
  let strokePx = 0;
  let lastPetAt = -Infinity;
  const on = <K extends keyof HTMLElementEventMap>(target: HTMLElement, type: K, handler: (event: HTMLElementEventMap[K]) => void) => {
    target.addEventListener(type, handler);
    scope.add(() => target.removeEventListener(type, handler));
  };
  on(petButton, 'click', () => { lastPetAt = performance.now(); strokePx = 0; brain.pet(); });
  on(petButton, 'pointermove', (event) => {
    if (event.buttons !== 0) return;
    strokePx += Math.hypot(event.movementX, event.movementY);
    const now = performance.now();
    if (strokePx > STROKE_PX && now - lastPetAt > STROKE_GAP_MS) {
      strokePx = 0;
      lastPetAt = now;
      brain.pet();
    }
  });
  on(petButton, 'pointerleave', () => { strokePx = 0; });
  // The eyes follow the pointer across the stage, unless Doozer is busy, asleep or focusing.
  on(stage, 'pointermove', (event) => {
    const s = brain.state;
    if (director.scene !== null || s.asleep || s.quiet) return;
    const box = stage.getBoundingClientRect();
    doozer.lookAt((event.clientX - box.left - box.width / 2) / 110, (event.clientY - box.top - box.height * 0.55) / 80);
  });
  on(stage, 'pointerleave', () => { if (director.scene === null) doozer.lookAt(0, 0); });

  // ---- actions ----------------------------------------------------------------------
  const refuseOn = (control: HTMLElement, result: ActionResult) => { if (!result.ok) nudge(control, reduceMotion); };
  // A double-click (or a held Enter key) must not count twice: a second Nap would wake
  // Doozer straight back up, a second "Give one" would spend a treat nobody saw eaten.
  // The guard compares event times, so there is no timer that could leave a button dead.
  const act = (name: string, run: (control: HTMLButtonElement) => void, guard = true) => {
    const control = button(name);
    let acceptedAt = -Infinity;
    on(control, 'click', (event) => {
      if (guard && event.timeStamp - acceptedAt < DOUBLE_PRESS_MS) return;
      acceptedAt = event.timeStamp;
      run(control);
    });
  };
  act('feed', (c) => refuseOn(c, brain.feed()));
  act('play', (c) => refuseOn(c, brain.play()));
  act('wash', (c) => refuseOn(c, brain.wash()));
  act('sleep', (c) => refuseOn(c, brain.toggleSleep()));
  act('fill', (c) => refuseOn(c, brain.fillBowl()));
  act('treat', (c) => refuseOn(c, brain.giveTreat()));
  act('focus', (c) => {
    const status = brain.state.focus.status;
    if (status === 'idle') refuseOn(c, brain.startFocus());
    else if (status === 'running') brain.pauseFocus();
    else brain.resumeFocus();
  });
  act('focus-stop', () => brain.stopFocus());
  act('settings', () => options.onOpenSettings?.(), false);
  act('mute', () => brain.setSetting('sound', !brain.settings.sound));

  for (const chip of el.querySelectorAll<HTMLButtonElement>('.dzk-chip')) {
    on(chip, 'click', () => brain.setFocusLength(Number(chip.dataset.min) as FocusMinutes));
  }
  // Arrow keys move between the three lengths, like a radio group.
  on(need(el, '.dzk-lengths'), 'keydown', (event) => {
    const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (step === 0 || brain.state.focus.status !== 'idle') return;
    event.preventDefault();
    const index = LENGTHS.indexOf(brain.state.focus.minutes);
    const next = LENGTHS[(index + step + LENGTHS.length) % LENGTHS.length];
    if (next === undefined) return;
    brain.setFocusLength(next);
    need<HTMLButtonElement>(el, `.dzk-chip[data-min="${next}"]`).focus();
  });

  const currentView = () => options.currentView?.() ?? brain.settings.lastView;
  const unavailable = new Set<ViewId>(options.unavailableViews ?? []);
  for (const viewButton of el.querySelectorAll<HTMLButtonElement>('.dzk-view')) {
    const view = viewButton.dataset.view as ViewId;
    on(viewButton, 'click', () => { if (view !== currentView() && !unavailable.has(view)) options.onSwitchView?.(view); });
  }

  // ---- painting ---------------------------------------------------------------------
  // Everything on the Card that can change is painted here, and only when it differs.
  const meters = createNeedMeters(brain, { auto: false });
  need(el, '[data-slot="needs"]').replaceWith(meters.el);
  scope.add(() => meters.destroy());
  const pips = Array.from(el.querySelectorAll<HTMLElement>('.dzk-pips i'));
  const sleepButton = button('sleep');
  const goButton = button('focus');
  const stopButton = button('focus-stop');
  const muteButton = button('mute');

  function paint(): void {
    const s = brain.state;
    const limits = brain.limits;

    memo('night', s.asleep, () => { stage.dataset.night = s.asleep ? '1' : '0'; });
    memo('pet-label', s.asleep, () => petButton.setAttribute('aria-label', s.asleep ? 'Pet Doozer (asleep)' : 'Pet Doozer'));

    meters.paint();

    memo('sleep-button', s.asleep, () => {
      need(sleepButton, '.dzk-act-ico').innerHTML = s.asleep ? ICONS.wake : ICONS.sleep;
      need(sleepButton, '.dzk-act-label').textContent = s.asleep ? 'Wake' : 'Nap';
    });
    for (const name of ['feed', 'play', 'wash'] as const) {
      memo(`dim-${name}`, s.asleep, () => { button(name).dataset.dim = s.asleep ? '1' : '0'; });
    }

    memo('bowl', s.bowl, () => {
      pips.forEach((pip, i) => { pip.dataset.full = i < s.bowl ? '1' : '0'; });
      const text = `Bowl: ${s.bowl} of ${limits.bowl} servings. Doozer helps itself when hungry.`;
      need(el, '.dzk-pips').setAttribute('aria-label', text);
      need(el, '[data-cell="bowl"]').dataset.tip = text;
      const fill = button('fill');
      fill.dataset.dim = s.bowl >= limits.bowl ? '1' : '0';
      fill.setAttribute('aria-label', s.bowl >= limits.bowl ? 'Fill the bowl (already full)' : 'Fill the bowl');
    });
    memo('treats', s.treats, () => {
      jarCount.innerHTML = `<small>×</small>${s.treats}`;
      jarCount.setAttribute('aria-label', plural(s.treats, 'treat'));
      need(el, '[data-cell="jar"]').dataset.tip = `${plural(s.treats, 'treat')} in the jar (it holds ${limits.treats}). Earned by focusing.`;
    });
    memo('treat-dim', s.treats === 0 || s.asleep, () => {
      const give = button('treat');
      give.dataset.dim = s.treats === 0 || s.asleep ? '1' : '0';
      give.setAttribute('aria-label', s.treats === 0 ? 'Give a treat (the jar is empty)' : 'Give a treat');
    });

    const focus = s.focus;
    memo('focus-status', focus.status, () => {
      focusBox.dataset.status = focus.status;
      const idle = focus.status === 'idle';
      need(goButton, '.dzk-go-ico').innerHTML = focus.status === 'running' ? ICONS.pause : ICONS.start;
      need(goButton, '.dzk-go-label').textContent = idle ? 'Start' : focus.status === 'running' ? 'Pause' : 'Resume';
      stopButton.hidden = idle;
      need(el, '.dzk-paused').hidden = focus.status !== 'paused';
      for (const chip of el.querySelectorAll<HTMLButtonElement>('.dzk-chip')) chip.disabled = !idle;
      // During a session the length cannot change, so the choice becomes a plain note.
      need(el, '.dzk-lengths').hidden = !idle;
      need(el, '.dzk-length-note').hidden = idle;
    });
    memo('length-note', focus.minutes, () => { need(el, '.dzk-length-note').textContent = `of ${focus.minutes} min`; });
    memo('focus-minutes', focus.minutes, () => {
      for (const chip of el.querySelectorAll<HTMLButtonElement>('.dzk-chip')) {
        const chosen = Number(chip.dataset.min) === focus.minutes;
        chip.setAttribute('aria-checked', String(chosen));
        chip.tabIndex = chosen ? 0 : -1;
      }
    });
    // What a session earns (spec 4.2), from the brain's own table: said on each length and on Start.
    memo('rewards', `${focus.status}:${focus.minutes}`, () => {
      const rewards = brain.rewards;
      for (const chip of el.querySelectorAll<HTMLButtonElement>('.dzk-chip')) {
        const minutes = Number(chip.dataset.min) as FocusMinutes;
        const earns = plural(rewards.treats[minutes], 'treat');
        chip.dataset.tip = `${minutes} minutes earns ${earns}`;
        chip.setAttribute('aria-label', `${minutes} minutes, earns ${earns}`);
      }
      if (focus.status === 'idle') {
        const bonus = rewards.firstOfDay > 0 ? `, plus ${rewards.firstOfDay} for the first session of the day` : '';
        goButton.dataset.tip = `Focus together. Finish and Doozer earns ${plural(rewards.treats[focus.minutes], 'treat')}${bonus}.`;
      } else {
        delete goButton.dataset.tip;
      }
    });
    const clockString = formatClock(focus.remainingMs);
    memo('clock', clockString, () => { clock.textContent = clockString; });
    // Spoken once a minute, not once a second.
    memo('clock-label', `${focus.status}:${Math.ceil(focus.remainingMs / 60_000)}`, () => {
      clock.setAttribute('aria-label', focus.status === 'idle' ? `${focus.minutes} minute session` : clockText(Math.ceil(focus.remainingMs / 60_000) * 60_000));
    });
    const progress = Math.round(Math.min(1, Math.max(0, focus.progress)) * 1000) / 10;
    memo('progress', progress, () => { need(el, '.dzk-progress b').style.width = `${progress}%`; });

    memo('streak', `${s.streak.current}/${s.streak.best}`, () => {
      const streak = need(el, '.dzk-streak');
      need(streak, 'b').textContent = String(s.streak.current);
      need(streak, '.dzk-streak-best').textContent = s.streak.best > 0 ? `· best ${s.streak.best}` : 'day streak';
      streak.dataset.zero = s.streak.current === 0 ? '1' : '0';
      streak.dataset.tip = s.streak.current === 0
        ? 'Finish a focus session to start a streak.'
        : `${plural(s.streak.current, 'day')} in a row with a finished session. Best: ${s.streak.best}.`;
    });
    memo('next', s.nextUnlock ? `${s.nextUnlock.id}@${s.nextUnlock.atSessions - s.sessionsCompleted}` : '', () => {
      const next = need(el, '.dzk-next');
      next.hidden = s.nextUnlock === null;
      if (!s.nextUnlock) return;
      const left = Math.max(1, s.nextUnlock.atSessions - s.sessionsCompleted);
      need(next, '.dzk-next-ico').innerHTML = ICONS[s.nextUnlock.id];
      need(next, '.dzk-next-in').textContent = `in ${left}`;
      next.dataset.tip = `Next unlock: ${ITEM_NAME[s.nextUnlock.id]}, after ${plural(left, 'more session')}.`;
    });

    const view = currentView();
    memo('view', view, () => {
      for (const viewButton of el.querySelectorAll<HTMLButtonElement>('.dzk-view')) {
        const id = viewButton.dataset.view as ViewId;
        const soon = unavailable.has(id) && id !== view;
        viewButton.setAttribute('aria-pressed', String(id === view));
        viewButton.disabled = soon;
        const label = VIEWS.find((v) => v.id === id)?.label ?? id;
        viewButton.dataset.tip = id === view ? `You are in the ${label}` : soon ? `${label}: coming soon` : `Move Doozer to the ${label}`;
      }
    });

    const sound = brain.settings.sound;
    memo('sound', sound, () => {
      need(muteButton, '.dzk-mute-ico').innerHTML = sound ? ICONS['sound-on'] : ICONS['sound-off'];
      need(muteButton, '.dzk-mute-label').textContent = sound ? 'Sound on' : 'Sound off';
      muteButton.setAttribute('aria-pressed', String(!sound));
      muteButton.setAttribute('aria-label', sound ? 'Sound is on. Mute' : 'Sound is off. Unmute');
    });
  }

  // ---- open / close -----------------------------------------------------------------
  // The whole of "is it open" is this one flag and the attribute that mirrors it.
  let isOpen = options.open ?? true;
  let lively = true;
  let wavedAt = -Infinity;

  /** The stage only moves while the Card is open and somebody is there to see it. */
  function applyLively(): void {
    const on = isOpen && lively;
    doozer.setLive(on);
    director.setActive(on);
    if (!on) { emotes.clear(); doozer.lookAt(0, 0); }
  }

  function applyOpen(announce: boolean): void {
    el.dataset.open = isOpen ? '1' : '0';
    el.inert = !isOpen;
    applyLively();
    if (isOpen) paint();
    if (announce) options.onOpenChange?.(isOpen);
  }

  const api: Card = {
    el,
    doozer,
    get isOpen() { return isOpen; },
    open() {
      if (scope.disposed || isOpen) return;
      isOpen = true;
      applyOpen(true);
      // A little hello, at most once a minute, and never during a nap or a session.
      const s = brain.state;
      const now = performance.now();
      if (!s.asleep && !s.quiet && now - wavedAt > 60_000) {
        wavedAt = now;
        void doozer.perform('wave');
      }
    },
    close() {
      if (scope.disposed || !isOpen) return;
      isOpen = false;
      applyOpen(true);
    },
    toggle() { if (isOpen) api.close(); else api.open(); },
    focus() { if (isOpen) button('feed').focus(); },
    setLively(on) {
      if (scope.disposed || lively === on) return;
      lively = on;
      applyLively();
    },
    destroy() {
      scope.dispose();
      el.remove();
    },
  };

  if (options.closeOnEscape !== false) {
    on(el, 'keydown', (event) => { if (event.key === 'Escape' && isOpen) { event.stopPropagation(); api.close(); } });
  }

  scope.add(brain.on('change', () => { if (isOpen) paint(); }));
  scope.add(brain.on('settings', () => { if (isOpen) paint(); }));
  scope.add(attachTooltips(el, { timers }));
  applyOpen(false);

  return api;
}
