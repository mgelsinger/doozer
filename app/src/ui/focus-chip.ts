// A small dark-glass chip showing the time left in a focus session (DESIGN_SPEC.md 4.6):
// the Island shows it under the island, the Desktop shows it while hovering Doozer.
// Hidden when no session is on, unless the view asks for it to be always shown.

import './kit.css';
import type { Brain } from '../core/contract';
import { createMemo, h } from './dom';
import { clockText, formatClock } from './format';
import { ICONS } from './icons';
import { Scope } from './lifecycle';
import { watchReduceMotion } from './motion';

export interface FocusChip {
  readonly el: HTMLElement;
  /** Views that only reveal it on hover call this. Default: shown whenever a session is on. */
  setRevealed(on: boolean): void;
  destroy(): void;
}

export function createFocusChip(brain: Brain): FocusChip {
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
    const text = formatClock(focus.remainingMs);
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
    destroy() { scope.dispose(); el.remove(); },
  };
}
