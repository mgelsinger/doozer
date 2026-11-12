// The four need meters. Used inside the Card (a 2 x 2 grid) and available to views as a
// slim strip (the Room shows one under the scene).
//
// A need's level is shown three ways at once: the bar's length, its colour
// (green, yellow, amber, red), and for low and urgent a "!" flag - urgent is striped too.
// The tooltip and the accessible value spell it out: "Tummy 23%, low".

import './kit.css';
import type { Brain, NeedKey } from '../core/contract';
import { createMemo, h, need } from './dom';
import { ICONS } from './icons';
import { NEED_ART, NEED_KEYS, clampNeed, needLevel, needText, needTone } from './needs';

export interface NeedMetersOptions {
  /** 'grid' is two columns (the Card); 'strip' is one row (under a scene). */
  layout?: 'grid' | 'strip';
  /** Repaint by itself on every brain change. Default true. The Card paints it by hand. */
  auto?: boolean;
}

export interface NeedMeters {
  readonly el: HTMLElement;
  paint(): void;
  destroy(): void;
}

export function createNeedMeters(brain: Brain, options: NeedMetersOptions = {}): NeedMeters {
  const memo = createMemo();
  const el = h('div', {
    class: 'dzk-needs', role: 'group', 'aria-label': 'Needs', 'data-layout': options.layout ?? 'grid',
    html: NEED_KEYS.map((key) => `
      <div class="dzk-need" data-need="${key}" role="meter" aria-label="${NEED_ART[key].label}" aria-valuemin="0" aria-valuemax="100">
        ${ICONS[NEED_ART[key].icon]}<span class="dzk-meter"><b></b></span><span class="dzk-flag" aria-hidden="true">!</span>
      </div>`).join(''),
  });
  const parts = new Map<NeedKey, { root: HTMLElement; bar: HTMLElement }>();
  for (const key of NEED_KEYS) {
    const root = need(el, `[data-need="${key}"]`);
    parts.set(key, { root, bar: need(root, '.dzk-meter b') });
  }

  function paint(): void {
    const limits = brain.limits;
    for (const key of NEED_KEYS) {
      const part = parts.get(key);
      if (!part) continue;
      const value = clampNeed(brain.state.needs[key]);
      const percent = Math.round(value);
      memo(`value-${key}`, percent, () => {
        const text = needText(key, value, limits);
        part.bar.style.width = `${percent}%`;
        part.root.setAttribute('aria-valuenow', String(percent));
        part.root.setAttribute('aria-valuetext', text);
        part.root.dataset.tip = text;
      });
      const tone = needTone(value, limits);
      memo(`tone-${key}`, tone, () => { part.root.dataset.tone = tone; });
      const level = needLevel(value, limits);
      memo(`level-${key}`, level, () => { part.root.dataset.level = level; });
    }
  }

  paint();
  const off = options.auto === false ? () => {} : brain.on('change', paint);

  return {
    el,
    paint,
    destroy() { off(); el.remove(); },
  };
}
