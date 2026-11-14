// A move from one place to another, as a function of time. Where Doozer is at any moment
// is worked out from the clock, not accumulated frame by frame, so a move ends when its
// time is up whether or not a single frame was drawn in between (a hidden window draws
// none), and stopping one half-way leaves Doozer exactly where it had got to.
// Pure: no DOM, no timers.

export interface Motion {
  /** A walk goes along the ground at a steady speed. A float drifts gently down. */
  readonly kind: 'walk' | 'float';
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  /** When it began, on the view's clock (ms). */
  readonly t0: number;
  /** How long it takes (ms). */
  readonly ms: number;
}

export interface Place {
  x: number;
  y: number;
  /** The move's time is up. */
  done: boolean;
}

/** Slow out, slow in. */
const ease = (t: number): number => t * t * (3 - 2 * t);

/** How far a float sways to either side on the way down, at most (px). */
const SWAY_PX = 7;

export function motionAt(motion: Motion, now: number): Place {
  const raw = motion.ms > 0 ? (now - motion.t0) / motion.ms : 1;
  const t = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
  if (t >= 1) return { x: motion.x1, y: motion.y1, done: true };
  if (motion.kind === 'walk') {
    return { x: motion.x0 + (motion.x1 - motion.x0) * t, y: motion.y0 + (motion.y1 - motion.y0) * t, done: false };
  }
  const e = ease(t);
  // A small sway, nothing at either end, less the shorter the drop.
  const drop = Math.abs(motion.y1 - motion.y0);
  const sway = Math.sin(t * Math.PI * 2) * Math.sin(t * Math.PI) * Math.min(SWAY_PX, drop / 20);
  return { x: motion.x0 + (motion.x1 - motion.x0) * e + sway, y: motion.y0 + (motion.y1 - motion.y0) * e, done: false };
}

/**
 * How long the gentle float down takes (DESIGN_SPEC.md 6.4: "released in mid-air, it
 * floats gently down to the taskbar"). No gravity and no bounce: a steady drift, a little
 * quicker from high up so that it is never a long wait.
 */
export function floatMs(dx: number, dy: number): number {
  const distance = Math.hypot(dx, dy);
  if (!(distance > 0)) return 0;
  return Math.round(Math.min(2400, Math.max(420, 300 + distance * 2.2)));
}
