// Where the Island catches the mouse, and what is under the pointer. Pure arithmetic on
// top of camera.ts: no DOM, no three.js, no frame needed.
//
// The window is click-through except for its hit regions (docs/shell-spike.md), and a
// region is a rounded rectangle. The island is not one, so its outline is cut into thin
// horizontal slabs that follow it; Doozer, the ball and whatever is open add their own.

import type { Region } from '../../shell';
import { hitEllipsoid, type Projector, type Ray, type Vec3 } from './camera';
import { ISLAND, groundY } from './layout';
import { BALL_RADIUS } from './world';

export interface Point { x: number; y: number }

// ---- the island's outline ---------------------------------------------------------------

/** Points of the island's silhouette on screen: the rim of the grass and the earth hanging under it. */
export function islandSilhouette(projector: Projector): Point[] {
  const points: Point[] = [];
  const ring = (radius: number, y: number, count: number): void => {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      const p = projector.project([Math.cos(a) * radius, y, Math.sin(a) * radius]);
      points.push({ x: p.x, y: p.y });
    }
  };
  // The grass: its rim, and the gentle dome above it.
  ring(ISLAND.radius, ISLAND.centreY, 48);
  ring(ISLAND.radius * 0.8, groundY(ISLAND.radius * 0.8, 0), 24);
  // The earth: a lumpy bowl, taken a little generously (its lumps reach about 12 % further).
  for (let k = 1; k <= 7; k++) {
    const a = (k / 7) * (Math.PI / 2);
    ring(ISLAND.earthRadius * 1.1 * Math.cos(a), ISLAND.centreY - ISLAND.earthDepth * Math.sin(a), 20);
  }
  return convexHull(points);
}

/** The convex hull, counter-clockwise (Andrew's monotone chain). */
export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length < 3) return sorted;
  const cross = (o: Point, a: Point, b: Point): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const build = (list: readonly Point[]): Point[] => {
    const hull: Point[] = [];
    for (const p of list) {
      while (hull.length >= 2 && cross(hull[hull.length - 2] as Point, hull[hull.length - 1] as Point, p) <= 0) hull.pop();
      hull.push(p);
    }
    hull.pop();
    return hull;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
}

/**
 * A convex outline as a stack of slabs about `slab` pixels tall. Each slab is as wide as
 * the outline is at its widest inside that slab, so the stack covers the outline and
 * overshoots it by at most the outline's own slope across one slab.
 */
export function slabs(outline: readonly Point[], slab = 16, pad = 0): Region[] {
  if (outline.length < 3) return [];
  const top = Math.min(...outline.map((p) => p.y));
  const bottom = Math.max(...outline.map((p) => p.y));
  const count = Math.max(1, Math.ceil((bottom - top) / slab));
  const height = (bottom - top) / count;
  const out: Region[] = [];
  for (let i = 0; i < count; i++) {
    const y0 = top + i * height;
    const y1 = y0 + height;
    let left = Infinity;
    let right = -Infinity;
    const see = (x: number): void => { left = Math.min(left, x); right = Math.max(right, x); };
    for (let k = 0; k < outline.length; k++) {
      const a = outline[k] as Point;
      const b = outline[(k + 1) % outline.length] as Point;
      if (a.y >= y0 && a.y <= y1) see(a.x);
      for (const y of [y0, y1]) {
        if ((a.y - y) * (b.y - y) < 0) see(a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    if (right <= left) continue;
    out.push({ x: left - pad, y: y0 - (i === 0 ? pad : 0), w: right - left + pad * 2, h: height + (i === 0 ? pad : 0) + (i === count - 1 ? pad : 0), r: 0 });
  }
  // Round off the two ends, where a square corner would stick out past the outline.
  const first = out[0];
  const last = out[out.length - 1];
  if (first) first.r = Math.min(first.h / 2, first.w / 2);
  if (last && last !== first) last.r = Math.min(last.h / 2, last.w / 2);
  return out;
}

// ---- Doozer and the ball ------------------------------------------------------------------

export interface DoozerAt {
  /** Where its feet are on the island. */
  x: number;
  z: number;
  /** How high it has hopped. */
  y: number;
}

/** The model's size in world units (build_doozer.py): half its width, its height, the ears and the tuft. */
const DOOZER = { halfWidth: 0.64, height: 1.42, earTop: 1.46, earHalfSpan: 0.6, tuftTop: 1.66 } as const;

/** Two rounded boxes over Doozer: the body, and the ears and tuft above it. */
export function doozerRegions(projector: Projector, at: DoozerAt, pad = 10): Region[] {
  const ground = groundY(at.x, at.z) + at.y;
  const feet = projector.project([at.x, ground, at.z]);
  const top = projector.project([at.x, ground + DOOZER.height, at.z]);
  const crown = projector.project([at.x, ground + DOOZER.tuftTop, at.z]);
  const ears = projector.project([at.x, ground + 1.08, at.z]);
  const half = DOOZER.halfWidth * feet.scale + pad;
  const body: Region = { x: feet.x - half, y: top.y - pad, w: half * 2, h: feet.y - top.y + pad * 2 + 6, r: half };
  const earHalf = DOOZER.earHalfSpan * ears.scale + pad;
  const head: Region = { x: ears.x - earHalf, y: crown.y - pad, w: earHalf * 2, h: ears.y - crown.y + pad, r: 18 };
  return [body, head];
}

export function ballRegion(projector: Projector, ball: { x: number; y: number; z: number }, pad = 8): Region {
  const p = projector.project([ball.x, ball.y, ball.z]);
  const r = BALL_RADIUS * p.scale + pad;
  return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2, r };
}

/** Where on screen Doozer's middle and the top of its head are (for the Radial and the emotes). */
export function doozerPoints(projector: Projector, at: DoozerAt): { middle: Point; head: Point; scale: number } {
  const ground = groundY(at.x, at.z) + at.y;
  const middle = projector.project([at.x, ground + 0.72, at.z]);
  const head = projector.project([at.x, ground + DOOZER.height, at.z]);
  return { middle: { x: middle.x, y: middle.y }, head: { x: head.x, y: head.y }, scale: middle.scale };
}

// ---- what is under the pointer ---------------------------------------------------------------

export type Picked = 'doozer' | 'ball' | 'snack' | 'island' | null;

export interface PickScene {
  doozer: DoozerAt & { stretch?: number; bulge?: number };
  ball: { x: number; y: number; z: number } | null;
  snack: { x: number; y: number; z: number; size: number } | null;
}

/** The nearest thing a ray from the camera meets. */
export function pick(ray: Ray, scene: PickScene): Picked {
  let best: Picked = null;
  let nearest = Infinity;
  const consider = (kind: Exclude<Picked, null>, t: number | null): void => {
    if (t !== null && t < nearest) { nearest = t; best = kind; }
  };
  const d = scene.doozer;
  const ground = groundY(d.x, d.z) + d.y;
  const stretch = d.stretch ?? 1;
  const bulge = d.bulge ?? 1;
  // The body, the ears and the tuft, each as a rounded blob a little larger than drawn.
  consider('doozer', hitEllipsoid(ray, [d.x, ground + 0.72 * stretch, d.z], [0.68 * bulge, 0.74 * stretch, 0.62 * bulge]));
  consider('doozer', hitEllipsoid(ray, [d.x - 0.4 * bulge, ground + 1.26 * stretch, d.z - 0.03], [0.22, 0.22, 0.14]));
  consider('doozer', hitEllipsoid(ray, [d.x + 0.4 * bulge, ground + 1.26 * stretch, d.z - 0.03], [0.22, 0.22, 0.14]));
  consider('doozer', hitEllipsoid(ray, [d.x + 0.07, ground + 1.52 * stretch, d.z], [0.14, 0.16, 0.1]));
  if (scene.ball) consider('ball', hitEllipsoid(ray, [scene.ball.x, scene.ball.y, scene.ball.z], [0.3, 0.3, 0.3]));
  if (scene.snack) {
    const r = 0.14 + 0.2 * scene.snack.size;
    consider('snack', hitEllipsoid(ray, [scene.snack.x, scene.snack.y + 0.2 * scene.snack.size, scene.snack.z], [r, r, r]));
  }
  const grass: Vec3 = [ISLAND.radius, ISLAND.dome, ISLAND.radius];
  consider('island', hitEllipsoid(ray, [0, ISLAND.centreY, 0], grass));
  // The earth is only the lower half of its ball: a ray that meets the upper half meets air.
  const earth = hitEllipsoid(ray, [0, ISLAND.centreY, 0], [ISLAND.earthRadius * 1.06, ISLAND.earthDepth, ISLAND.earthRadius * 1.06]);
  if (earth !== null && ray.origin[1] + ray.dir[1] * earth <= ISLAND.centreY) consider('island', earth);
  return best;
}
