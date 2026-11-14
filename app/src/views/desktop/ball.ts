// The ball Doozer plays with. Simple bouncing, as in the Desk Buddy mockup: gravity, a
// lossy bounce on the ground and off the edges of the screen, and it comes to rest.
// Pure: stepped with a time difference, so it behaves the same whether it is driven by
// animation frames or by a timer.

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radius in px. */
  readonly r: number;
  /** Degrees it has rolled, for drawing. */
  spin: number;
}

export interface BallBounds {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  /** The line the ball rests on (the same line as Doozer's feet). */
  readonly ground: number;
}

export const GRAVITY = 2100;
/** No step is longer than this, so a stalled page cannot fling the ball through the floor. */
const MAX_STEP = 1 / 120;

/** Move the ball on by `dt` seconds. Returns true if it struck the ground hard enough to hear. */
export function stepBall(ball: Ball, dt: number, bounds: BallBounds): boolean {
  let left = Number.isFinite(dt) ? Math.min(0.25, Math.max(0, dt)) : 0;
  let thud = false;
  while (left > 0) {
    const step = Math.min(left, MAX_STEP);
    left -= step;
    thud = advance(ball, step, bounds) || thud;
  }
  if (![ball.x, ball.y, ball.vx, ball.vy].every(Number.isFinite)) restBall(ball, bounds);
  return thud;
}

function advance(ball: Ball, dt: number, bounds: BallBounds): boolean {
  let thud = false;
  ball.vy += GRAVITY * dt;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;
  if (ball.x < bounds.left + ball.r) { ball.x = bounds.left + ball.r; ball.vx = Math.abs(ball.vx) * 0.75; }
  if (ball.x > bounds.right - ball.r) { ball.x = bounds.right - ball.r; ball.vx = -Math.abs(ball.vx) * 0.75; }
  if (ball.y < bounds.top + ball.r) { ball.y = bounds.top + ball.r; ball.vy = Math.abs(ball.vy) * 0.6; }
  if (ball.y > bounds.ground - ball.r) {
    ball.y = bounds.ground - ball.r;
    thud = ball.vy > 160;
    ball.vy = ball.vy > 120 ? -ball.vy * 0.62 : 0;
    ball.vx *= 0.985;
    if (Math.abs(ball.vx) < 4) ball.vx = 0;
  }
  ball.spin = (ball.spin + ball.vx * dt * 3) % 360;
  return thud;
}

/** Put the ball down where it is, still. */
export function restBall(ball: Ball, bounds: BallBounds): void {
  const mid = (bounds.left + bounds.right) / 2;
  ball.x = Number.isFinite(ball.x) ? Math.min(bounds.right - ball.r, Math.max(bounds.left + ball.r, ball.x)) : mid;
  ball.y = bounds.ground - ball.r;
  ball.vx = 0;
  ball.vy = 0;
  if (!Number.isFinite(ball.spin)) ball.spin = 0;
}

/** True once the ball is lying still on the ground. */
export function ballAtRest(ball: Ball, bounds: BallBounds): boolean {
  return ball.vx === 0 && ball.vy === 0 && ball.y >= bounds.ground - ball.r - 0.5;
}

/** Send the ball up and to one side. `dir` is -1 or 1; `power` is 0..1. */
export function kickBall(ball: Ball, dir: number, power: number, random: () => number): void {
  const p = Math.min(1, Math.max(0, power));
  ball.vx = (dir < 0 ? -1 : 1) * (60 + p * (200 + random() * 260));
  ball.vy = -(430 + p * (190 + random() * 280));
}
