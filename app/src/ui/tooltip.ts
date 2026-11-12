// Tooltips for the kit. Any element inside the root with a `data-tip` attribute gets one:
// after a short hover, or at once when it takes keyboard focus. One bubble per root,
// kept inside the root's box so it can never fall outside the app's window.
//
// A tooltip always goes away: on leave, blur, Escape, a press, when its anchor loses its
// tip or leaves the page, and in any case after a maximum time.

import { realTimers, type Timers } from '../character/timers';
import { h } from './dom';
import { Scope, type Disposer } from './lifecycle';

export interface TooltipOptions {
  timers?: Timers;
  /** Hover delay before showing. */
  delayMs?: number;
  /** Longest a tooltip may stay up. */
  maxMs?: number;
}

/** `root` must be a positioned element (every kit root is). Returns the detach function. */
export function attachTooltips(root: HTMLElement, options: TooltipOptions = {}): Disposer {
  const timers = options.timers ?? realTimers;
  const delayMs = options.delayMs ?? 420;
  const maxMs = options.maxMs ?? 6000;
  const scope = new Scope();
  const bubble = h('div', { class: 'dzk-tip', role: 'tooltip', 'aria-hidden': 'true', 'data-show': '0' });
  root.append(bubble);
  scope.add(() => bubble.remove());

  let anchor: HTMLElement | null = null;
  let pending: Disposer = () => {};
  let expiry: Disposer = () => {};

  const anchorOf = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) return null;
    const found = target.closest<HTMLElement>('[data-tip]');
    return found && root.contains(found) ? found : null;
  };

  function hide(): void {
    pending(); expiry();
    anchor = null;
    bubble.dataset.show = '0';
  }

  function place(target: HTMLElement): void {
    const box = root.getBoundingClientRect();
    const at = target.getBoundingClientRect();
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    const left = Math.min(Math.max(6, at.left - box.left + at.width / 2 - width / 2), Math.max(6, box.width - width - 6));
    let top = at.top - box.top - height - 8;
    if (top < 4) top = at.bottom - box.top + 8;
    bubble.style.left = `${Math.round(left)}px`;
    bubble.style.top = `${Math.round(top)}px`;
  }

  function show(target: HTMLElement): void {
    const text = target.dataset.tip;
    if (!text || !target.isConnected) { hide(); return; }
    anchor = target;
    bubble.textContent = text;
    place(target);
    bubble.dataset.show = '1';
    expiry();
    expiry = scope.after(maxMs, hide, timers);
  }

  function request(target: HTMLElement | null, wait: number): void {
    if (target === anchor) return;
    hide();
    if (!target) return;
    anchor = target;
    pending = scope.after(wait, () => { if (anchor === target) show(target); }, timers);
  }

  const on = <K extends keyof HTMLElementEventMap>(type: K, handler: (event: HTMLElementEventMap[K]) => void) => {
    root.addEventListener(type, handler);
    scope.add(() => root.removeEventListener(type, handler));
  };
  on('pointerover', (event) => request(anchorOf(event.target), delayMs));
  on('pointerout', (event) => { if (anchorOf(event.target) === anchor && anchorOf(event.relatedTarget) !== anchor) hide(); });
  on('pointerleave', hide);
  on('pointerdown', hide);
  on('focusin', (event) => {
    const target = anchorOf(event.target);
    if (target?.matches(':focus-visible')) request(target, 0);
  });
  on('focusout', hide);
  on('keydown', (event) => { if (event.key === 'Escape') hide(); });

  // A tip whose text changes while it is showing follows it; one whose anchor goes away hides.
  const observer = new MutationObserver(() => {
    if (!anchor || bubble.dataset.show !== '1') return;
    const text = anchor.isConnected ? anchor.dataset.tip : undefined;
    if (!text) hide();
    else if (text !== bubble.textContent) { bubble.textContent = text; place(anchor); }
  });
  observer.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-tip'], childList: true });
  scope.add(() => observer.disconnect());
  scope.add(hide);

  return () => scope.dispose();
}
