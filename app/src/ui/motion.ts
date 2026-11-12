// Reduce motion (DESIGN_SPEC.md section 9): the setting is 'system' | 'on' | 'off', and
// 'system' follows the operating system. Every kit root carries data-motion="reduce|full";
// kit.css and the rig do the rest.

import type { Brain, Settings } from '../core/contract';
import type { Disposer } from './lifecycle';

/** Pure: the setting plus what the system says. */
export function resolveReduceMotion(setting: Settings['reduceMotion'], systemPrefersReduce: boolean): boolean {
  return setting === 'on' ? true : setting === 'off' ? false : systemPrefersReduce;
}

const QUERY = '(prefers-reduced-motion: reduce)';

export function systemPrefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia(QUERY).matches;
}

/**
 * Calls `apply` now and whenever the answer changes (the setting, or the system preference).
 * Returns the function that stops watching.
 */
export function watchReduceMotion(brain: Brain, apply: (reduce: boolean) => void): Disposer {
  let last: boolean | null = null;
  const update = () => {
    const next = resolveReduceMotion(brain.settings.reduceMotion, systemPrefersReducedMotion());
    if (next !== last) { last = next; apply(next); }
  };
  update();
  const offSettings = brain.on('settings', ({ key }) => { if (key === 'reduceMotion') update(); });
  const media = typeof matchMedia === 'function' ? matchMedia(QUERY) : null;
  media?.addEventListener('change', update);
  return () => {
    offSettings();
    media?.removeEventListener('change', update);
  };
}
