// Emotes: the small wordless icons that float up from Doozer (DESIGN_SPEC.md 5.3) -
// heart, sparkle, "z", a snack, and "?" for refusals. Also the soap bubbles of a wash.
//
// Every emote removes itself. Removal is driven by a timer in `Transients`, never by an
// animation event, so an emote in a hidden or throttled window still goes away.

import type { FoodId, UnlockId } from '../core/contract';
import type { Timers } from '../character/timers';
import { h } from './dom';
import { ICONS, type IconName } from './icons';
import { Transients } from './lifecycle';
import type { EmoteKind } from './presenter';

export interface EmoteOptions {
  count?: number;
  /** For 'snack': which food (or unlocked thing) to show. */
  icon?: FoodId | UnlockId;
}

export interface EmoteLayerOptions {
  timers?: Timers;
  random?: () => number;
  /** Most emotes on screen at once. */
  max?: number;
  /**
   * Where emotes appear, as fractions of the layer: centre and half-spread.
   * Default suits a layer that covers Doozer with its head in the upper middle.
   */
  origin?: { x: number; y: number; spreadX: number; spreadY: number };
}

export interface EmoteLayer {
  /** Put this over Doozer. It ignores the pointer. */
  readonly el: HTMLElement;
  /** How many emotes are on screen right now. */
  readonly count: number;
  emit(kind: EmoteKind, options?: EmoteOptions): void;
  /** With motion reduced an emote fades in and out in place instead of floating up. */
  setReduceMotion(on: boolean): void;
  clear(): void;
  destroy(): void;
}

const RISE_MS = 1250;
const BURST_MS = 900;
const STAGGER_MS = 110;

const KIND_ICON: Record<Exclude<EmoteKind, 'snack'>, IconName> = {
  heart: 'heart', sparkle: 'sparkle', z: 'z', question: 'question', bubble: 'bubble',
};

export function createEmoteLayer(options: EmoteLayerOptions = {}): EmoteLayer {
  const random = options.random ?? Math.random;
  const origin = options.origin ?? { x: 0.5, y: 0.4, spreadX: 0.2, spreadY: 0.12 };
  const el = h('div', { class: 'dzk-emotes', 'aria-hidden': 'true' });
  const live = new Transients<HTMLElement>({
    remove: (node) => node.remove(),
    timers: options.timers,
    max: options.max ?? 16,
  });
  const between = (lo: number, hi: number) => lo + random() * (hi - lo);

  return {
    el,
    get count() { return live.size; },

    emit(kind, emitOptions = {}) {
      const count = Math.min(8, Math.max(1, Math.round(emitOptions.count ?? 1)));
      const iconName: IconName = kind === 'snack' ? (emitOptions.icon ?? 'biscuit') : KIND_ICON[kind];
      const burst = kind === 'bubble';
      for (let i = 0; i < count; i++) {
        const delay = burst ? i * 40 : i * STAGGER_MS;
        const node = h('span', { class: 'dzk-emote', 'data-kind': kind, html: ICONS[iconName] });
        const spreadX = burst ? origin.spreadX * 1.5 : origin.spreadX;
        node.style.left = `${(origin.x + between(-spreadX, spreadX)) * 100}%`;
        node.style.top = `${(origin.y + between(-origin.spreadY, origin.spreadY) + (burst ? 0.18 : 0)) * 100}%`;
        node.style.setProperty('--dx', `${between(-20, 20).toFixed(1)}px`);
        node.style.setProperty('--dy', burst ? `${between(-34, 6).toFixed(1)}px` : `${between(-58, -46).toFixed(1)}px`);
        node.style.animationDelay = `${delay}ms`;
        if (kind === 'sparkle' || burst) node.style.setProperty('--dzk-emote-scale', between(0.6, 1).toFixed(2));
        el.append(node);
        live.add(node, (burst ? BURST_MS : RISE_MS) + delay + 60);
      }
    },

    setReduceMotion(on) { el.dataset.motion = on ? 'reduce' : 'full'; },

    clear() { live.clear(); },

    destroy() {
      live.destroy();
      el.remove();
    },
  };
}
