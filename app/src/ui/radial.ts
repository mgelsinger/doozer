// The Radial: the quick menu around Doozer in the open-air views (DESIGN_SPEC.md 5.3).
// Six buttons on an arc - Feed, Play, Wash, Nap/Wake, Treat, More - and the four need
// buttons carry a ring showing that need's level.
//
// The view places `el` (a zero-size anchor) at Doozer's middle and calls open/close/toggle.
// The Radial closes itself when a button is chosen, on Escape, on a press outside, after a
// while with nobody near it, and whenever Doozer starts doing something (any brain action).
// A view that picks Doozer up or moves it calls `interrupt()`. It cannot be left open.
//
// The element the view uses to open the menu (Doozer's hit area) should carry the
// attribute `data-radial-toggle`, so a press on it is not treated as "outside" - otherwise
// the press would close the menu and the click that follows would open it again.

import './kit.css';
import type { ActionResult, Brain, NeedKey } from '../core/contract';
import type { Timers } from '../character/timers';
import { createMemo, h, need } from './dom';
import { ICONS, type IconName } from './icons';
import { Disclosure, Scope, type CloseReason } from './lifecycle';
import { watchReduceMotion } from './motion';
import { clampNeed, needLevel, needText, needTone } from './needs';
import { interruptOnActivity } from './presenter';

export interface RadialOptions {
  /** "More" was chosen: open the Card. */
  onMore?(): void;
  /** The menu opened or closed. Views use this to update their hit regions. */
  onOpenChange?(open: boolean, reason: CloseReason | 'open'): void;
  /** An action was refused by the brain (the view's Doozer shakes its head via the brain's own event). */
  onRefused?(result: ActionResult): void;
  /** Close after this long with no pointer over it and no focus inside. null = never. Default 9000. */
  idleCloseMs?: number | null;
  /** Middle of the arc in degrees (-90 is straight up) and how wide it is. Default -90 / 200. */
  arc?: { center: number; span: number };
  timers?: Timers;
}

export interface Radial {
  /** A zero-size anchor: position it (absolutely) at Doozer's middle. */
  readonly el: HTMLElement;
  readonly isOpen: boolean;
  /** `focus: true` moves keyboard focus to the first button (use it when opened from the keyboard). */
  open(options?: { focus?: boolean }): void;
  close(): void;
  toggle(): void;
  /** Doozer was picked up, moved, or the view is changing: close now. */
  interrupt(): void;
  /** Re-aim the arc, e.g. when Doozer is near a screen edge. */
  setArc(center: number, span: number): void;
  /** The buttons' boxes while open (empty when closed), for the view's hit regions. */
  hitRects(): DOMRect[];
  destroy(): void;
}

type ItemId = 'feed' | 'play' | 'wash' | 'sleep' | 'treat' | 'more';
interface Item { id: ItemId; label: string; icon: IconName; need?: NeedKey }

const ITEMS: readonly Item[] = [
  { id: 'feed', label: 'Feed', icon: 'feed', need: 'tummy' },
  { id: 'play', label: 'Play', icon: 'play', need: 'fun' },
  { id: 'wash', label: 'Wash', icon: 'wash', need: 'clean' },
  { id: 'sleep', label: 'Nap', icon: 'sleep', need: 'energy' },
  { id: 'treat', label: 'Treat', icon: 'treat' },
  { id: 'more', label: 'More', icon: 'more' },
];
const RING_R = 22;
const RING_LENGTH = 2 * Math.PI * RING_R;

const TEMPLATE = ITEMS.map((item, i) => `
  <button type="button" class="dzk-rb" role="menuitem" data-id="${item.id}" data-label="${item.label}" style="--i:${i}" tabindex="-1">
    ${item.need ? `<svg class="dzk-ring" viewBox="0 0 50 50" aria-hidden="true"><circle class="dzk-ring-track" cx="25" cy="25" r="${RING_R}"/><circle class="dzk-ring-val" cx="25" cy="25" r="${RING_R}"/></svg>` : ''}
    <span class="dzk-rb-ico">${ICONS[item.icon]}</span>
    <span class="dzk-rb-badge" aria-hidden="true">${item.need ? '!' : ''}</span>
  </button>`).join('');

export function createRadial(brain: Brain, options: RadialOptions = {}): Radial {
  const scope = new Scope();
  const memo = createMemo();
  const el = h('div', { class: 'dzk dzk-radial', role: 'menu', 'aria-label': 'Doozer', 'data-open': '0', html: TEMPLATE });
  el.inert = true;
  const buttons = new Map<ItemId, HTMLButtonElement>();
  for (const item of ITEMS) buttons.set(item.id, need<HTMLButtonElement>(el, `[data-id="${item.id}"]`));
  const order = ITEMS.map((item) => buttons.get(item.id)).filter((b): b is HTMLButtonElement => b !== undefined);

  scope.add(watchReduceMotion(brain, (reduce) => { el.dataset.motion = reduce ? 'reduce' : 'full'; }));

  function setArc(center: number, span: number): void {
    const step = ITEMS.length > 1 ? span / (ITEMS.length - 1) : 0;
    order.forEach((node, i) => node.style.setProperty('--a', `${center - span / 2 + step * i}deg`));
    // kit.css widens the radius if this step would make neighbouring buttons touch.
    el.style.setProperty('--step', `${Math.max(1, Math.abs(step))}deg`);
  }
  setArc(options.arc?.center ?? -90, options.arc?.span ?? 200);

  // ---- painting -------------------------------------------------------------------
  function paint(): void {
    const s = brain.state;
    const limits = brain.limits;
    for (const item of ITEMS) {
      const node = buttons.get(item.id);
      if (!node) continue;
      if (item.need) {
        const value = clampNeed(s.needs[item.need]);
        const percent = Math.round(value);
        memo(`ring-${item.id}`, percent, () => {
          need<SVGCircleElement>(node, '.dzk-ring-val').style.strokeDasharray = `${(RING_LENGTH * percent) / 100} ${RING_LENGTH}`;
        });
        memo(`tone-${item.id}`, needTone(value, limits), () => { node.dataset.tone = needTone(value, limits); });
        memo(`level-${item.id}`, needLevel(value, limits), () => { node.dataset.level = needLevel(value, limits); });
        const label = item.id === 'sleep' ? (s.asleep ? 'Wake' : 'Nap') : item.label;
        memo(`aria-${item.id}`, `${label}|${percent}`, () => node.setAttribute('aria-label', `${label}. ${needText(item.need as NeedKey, value, limits)}`));
      }
    }
    memo('asleep', s.asleep, () => {
      const sleep = buttons.get('sleep');
      if (sleep) {
        sleep.dataset.label = s.asleep ? 'Wake' : 'Nap';
        need(sleep, '.dzk-rb-ico').innerHTML = s.asleep ? ICONS.wake : ICONS.sleep;
      }
      for (const id of ['feed', 'play', 'wash'] as const) {
        const node = buttons.get(id);
        if (node) { node.dataset.dim = s.asleep ? '1' : '0'; node.setAttribute('aria-disabled', String(s.asleep)); }
      }
    });
    memo('treats', `${s.treats}|${s.asleep}`, () => {
      const treat = buttons.get('treat');
      if (!treat) return;
      const none = s.treats === 0;
      need(treat, '.dzk-rb-badge').textContent = String(s.treats);
      treat.dataset.empty = none ? '1' : '0';
      treat.dataset.dim = none || s.asleep ? '1' : '0';
      treat.setAttribute('aria-disabled', String(none || s.asleep));
      treat.setAttribute('aria-label', none ? 'Treat. The jar is empty' : `Treat. ${s.treats} in the jar`);
    });
    memo('more', true, () => buttons.get('more')?.setAttribute('aria-label', 'More: open the card'));
  }

  // ---- open / close -----------------------------------------------------------------
  let returnFocusTo: HTMLElement | null = null;
  const disclosure = new Disclosure({
    timers: options.timers,
    idleMs: options.idleCloseMs,
    onChange(open, reason) {
      el.dataset.open = open ? '1' : '0';
      el.inert = !open;
      if (open) paint();
      else {
        // Put keyboard focus back where it came from, but never steal it for a passive close.
        const hadFocus = el.contains(document.activeElement);
        if (hadFocus && (reason === 'escape' || reason === 'choice') && returnFocusTo?.isConnected) returnFocusTo.focus();
        else if (hadFocus && document.activeElement instanceof HTMLElement) document.activeElement.blur();
        returnFocusTo = null;
      }
      options.onOpenChange?.(open, reason);
    },
  });
  scope.add(() => disclosure.destroy());

  const run: Record<ItemId, () => ActionResult | void> = {
    feed: () => brain.feed(),
    play: () => brain.play(),
    wash: () => brain.wash(),
    sleep: () => brain.toggleSleep(),
    treat: () => brain.giveTreat(),
    more: () => options.onMore?.(),
  };
  const on = <T extends EventTarget>(target: T, type: string, handler: (event: Event) => void, capture = false) => {
    target.addEventListener(type, handler, capture);
    scope.add(() => target.removeEventListener(type, handler, capture));
  };

  for (const item of ITEMS) {
    const node = buttons.get(item.id);
    if (!node) continue;
    on(node, 'click', (event) => {
      event.stopPropagation();
      if (!disclosure.isOpen) return;
      // Close first, then act: the scene that follows never plays under an open menu.
      disclosure.close('choice');
      const result = run[item.id]();
      if (result && !result.ok) options.onRefused?.(result);
    });
  }

  // Keyboard: arrows move along the arc, Home/End jump, Escape closes.
  on(el, 'keydown', (raw) => {
    const event = raw as KeyboardEvent;
    if (!disclosure.isOpen) return;
    const at = order.indexOf(document.activeElement as HTMLButtonElement);
    let to = -1;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') to = (at + 1 + order.length) % order.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') to = (at - 1 + order.length) % order.length;
    else if (event.key === 'Home') to = 0;
    else if (event.key === 'End') to = order.length - 1;
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); disclosure.close('escape'); return; }
    else if (event.key === 'Tab') { disclosure.close('api'); return; }
    if (to < 0) return;
    event.preventDefault();
    order[to]?.focus();
    disclosure.touch();
  });

  // While the pointer is over a button or focus is inside, it does not idle out.
  on(el, 'pointerover', () => disclosure.hold(true));
  on(el, 'pointerout', (raw) => {
    const to = (raw as PointerEvent).relatedTarget;
    if (!(to instanceof Node) || !el.contains(to)) disclosure.hold(el.contains(document.activeElement));
  });
  on(el, 'focusin', () => disclosure.hold(true));
  on(el, 'focusout', (raw) => {
    const to = (raw as FocusEvent).relatedTarget;
    if (!(to instanceof Node) || !el.contains(to)) disclosure.hold(false);
  });

  // A press anywhere else closes it. The view's own handler for Doozer decides whether
  // that press also re-opens it; pressing Doozer is "outside" as far as the menu knows.
  on(document, 'pointerdown', (raw) => {
    if (!disclosure.isOpen) return;
    const target = raw.target;
    if (target instanceof Node && el.contains(target)) return;
    if (target instanceof Element && target.closest('[data-radial-toggle]')) return;
    disclosure.close('outside');
  }, true);
  on(window, 'blur', () => disclosure.close('outside'));

  // Doozer is about to do something (eat, fall asleep, celebrate): the menu gets out of the way.
  scope.add(interruptOnActivity(brain, disclosure));
  scope.add(brain.on('change', () => { if (disclosure.isOpen) paint(); }));

  function open(openOptions: { focus?: boolean } = {}): void {
    if (scope.disposed) return;
    if (!disclosure.isOpen) returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    disclosure.open();
    if (openOptions.focus) order[0]?.focus();
  }

  return {
    el,
    get isOpen() { return disclosure.isOpen; },
    open,
    close() { disclosure.close('api'); },
    toggle() { if (disclosure.isOpen) disclosure.close('api'); else open(); },
    interrupt() { disclosure.interrupt(); },
    setArc,
    hitRects() { return disclosure.isOpen ? order.map((node) => node.getBoundingClientRect()) : []; },
    destroy() {
      scope.dispose();
      el.remove();
    },
  };
}
