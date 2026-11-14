// The things that appear beside Doozer for the length of a scene: a snack, the ball (or
// the yarn ball), the bath duck. Each belongs to a scene, which removes it when it ends,
// however it ends; `clear()` removes whatever is left, and the view calls it whenever a
// scene ends, so nothing can be left lying on the desktop.

import type { FoodId, ToyId } from '../../core/contract';
import type { Timers } from '../../character/timers';
import { h } from '../../ui/dom';
import { ICONS } from '../../ui/icons';
import { Transients } from '../../ui/lifecycle';
import type { Ball } from './ball';

export interface FoodProp {
  /** Where its middle is. */
  readonly x: number;
  /** How many bites are gone, 0..3. */
  bite(step: number): void;
  remove(): void;
}

export interface BallProp {
  readonly ball: Ball;
  readonly el: HTMLElement;
  /** Put the element where the ball is. */
  draw(): void;
  remove(): void;
}

export interface SideProp {
  remove(): void;
}

export interface Props {
  /** `eatenFrom`: the side Doozer is on, so the bites are taken out of that side. */
  food(item: FoodId, x: number, ground: number, eatenFrom?: 'left' | 'right'): FoodProp;
  ball(toy: Exclude<ToyId, 'duck'>, x: number, y: number): BallProp;
  duck(x: number, ground: number): SideProp;
  /** The ball in play, if there is one. */
  readonly inPlay: BallProp | null;
  /** How many props are out (a ball that is fading away does not count). */
  readonly count: number;
  /** Remove everything, now. */
  clear(): void;
  destroy(): void;
}

export const FOOD_PX = 38;
export const BALL_RADIUS = 18;
const DUCK_PX = 34;
/** How long a ball takes to shrink away once play is over. */
const BYE_MS = 260;

export function createProps(layer: HTMLElement, options: { timers?: Timers } = {}): Props {
  const out = new Set<HTMLElement>();
  let inPlay: BallProp | null = null;
  // A ball shrinks away rather than vanishing; a timer, not an animation event, removes it.
  const leaving = new Transients<HTMLElement>({ remove: (node) => node.remove(), timers: options.timers, max: 4 });

  const put = (node: HTMLElement): void => {
    layer.append(node);
    out.add(node);
  };
  const take = (node: HTMLElement): boolean => out.delete(node);

  return {
    food(item, x, ground, eatenFrom = 'left') {
      const node = h('div', { class: 'deskv-prop deskv-food', 'data-item': item, 'aria-hidden': 'true', html: ICONS[item] });
      node.style.setProperty('--deskv-bite-x', eatenFrom === 'left' ? '8%' : '92%');
      node.style.left = `${Math.round(x - FOOD_PX / 2)}px`;
      node.style.top = `${Math.round(ground - FOOD_PX + 3)}px`;
      put(node);
      return {
        x,
        bite(step) { node.dataset.bite = String(Math.max(0, Math.min(3, Math.round(step)))); },
        remove() { if (take(node)) node.remove(); },
      };
    },

    ball(toy, x, y) {
      inPlay?.remove();
      const node = h('div', { class: 'deskv-prop deskv-ball', 'data-item': toy, 'data-ball': '', 'aria-hidden': 'true', html: ICONS[toy] });
      const ball: Ball = { x, y, vx: 0, vy: 0, r: BALL_RADIUS, spin: 0 };
      const prop: BallProp = {
        ball,
        el: node,
        draw() {
          node.style.translate = `${(ball.x - BALL_RADIUS).toFixed(1)}px ${(ball.y - BALL_RADIUS).toFixed(1)}px`;
          node.style.rotate = `${ball.spin.toFixed(0)}deg`;
        },
        remove() {
          if (!take(node)) return;
          if (inPlay === prop) inPlay = null;
          node.dataset.bye = '1';
          leaving.add(node, BYE_MS);
        },
      };
      prop.draw();
      put(node);
      inPlay = prop;
      return prop;
    },

    duck(x, ground) {
      const node = h('div', { class: 'deskv-prop deskv-duck', 'aria-hidden': 'true', html: ICONS.duck });
      node.style.left = `${Math.round(x - DUCK_PX / 2)}px`;
      node.style.top = `${Math.round(ground - DUCK_PX + 4)}px`;
      put(node);
      return { remove() { if (take(node)) node.remove(); } };
    },

    get inPlay() { return inPlay; },
    get count() { return out.size; },

    clear() {
      for (const node of [...out]) {
        out.delete(node);
        node.remove();
      }
      inPlay = null;
      leaving.clear();
    },

    destroy() {
      this.clear();
      leaving.destroy();
    },
  };
}
