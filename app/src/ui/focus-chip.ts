// A small dark-glass chip showing the time left in a focus session (DESIGN_SPEC.md 4.6):
// the Island shows it under the island, the Desktop shows it while hovering Doozer.
// Hidden when no session is on, unless the view asks for it to be always shown.

import './kit.css';
import type { Brain } from '../core/contract';
import { createMemo, h } from './dom';
import { clockText, formatClock, quietClock } from './format';
import { ICONS } from './icons';
import { Scope } from './lifecycle';
import { watchReduceMotion } from './motion';

export interface FocusChip {
  readonly el: HTMLElement;
  /** Views that only reveal it on hover call this. Default: shown whenever a session is on. */
  setRevealed(on: boolean): void;
  /** Paint again now (whether anyone is looking has changed). */
  refresh(): void;
  destroy(): void;
}

export interface FocusChipOptions {
  /**
   * Is someone looking? While nobody is, a running session is shown in whole minutes, so
   * that the chip changes once a minute and not once a second (see `quietClock`).
   * Default: always, to the second.
   */
  precise?: () => boolean;
}

export function createFocusChip(brain: Brain, options: FocusChipOptions = {}): FocusChip {
  const scope = new Scope();
  const memo = createMemo();
  const time = h('span', { role: 'timer' });
  const el = h('div', { class: 'dzk dzk-focus-chip', 'data-show': '0', html: ICONS.timer }, [time]);
  let revealed = true;

  const paint = () => {
    const focus = brain.state.focus;
    const show = revealed && focus.status !== 'idle';
    memo('show', show, () => { el.dataset.show = show ? '1' : '0'; });
    memo('status', focus.status, () => { el.dataset.status = focus.status; });
    if (!show) return;
    // A paused clock stands still by itself; a running one is only counted in seconds for someone.
    const exact = focus.status !== 'running' || (options.precise?.() ?? true);
    const text = exact ? formatClock(focus.remainingMs) : quietClock(focus.remainingMs);
    memo('time', text, () => { time.textContent = text; });
    memo('label', `${focus.status}:${Math.ceil(focus.remainingMs / 60_000)}`, () => {
      time.setAttribute('aria-label', `${focus.status === 'paused' ? 'Paused. ' : ''}${clockText(Math.ceil(focus.remainingMs / 60_000) * 60_000)}`);
    });
  };

  scope.add(brain.on('change', paint));
  scope.add(watchReduceMotion(brain, (reduce) => { el.dataset.motion = reduce ? 'reduce' : 'full'; }));
  paint();

  return {
    el,
    setRevealed(on) { revealed = on; paint(); },
    refresh() { if (!scope.disposed) paint(); },
    destroy() { scope.dispose(); el.remove(); },
  };
}
