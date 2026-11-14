// The Island's arithmetic: the camera (camera.ts), the window and the island's shape
// (layout.ts), and the hit regions and picking built on them (regions.ts).

import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createProjector, hitEllipsoid } from '../../../src/views/island/camera';
import { CAMERA, ISLAND, MIN_WINDOW_WIDTH, PANEL_MARGIN, PANEL_SPACE, SCENE, groundY, islandLayout, islandWindow, panelTop } from '../../../src/views/island/layout';
import { ballRegion, convexHull, doozerPoints, doozerRegions, islandSilhouette, pick, slabs, type Point } from '../../../src/views/island/regions';
import type { Region } from '../../../src/shell';

const medium = islandLayout('medium');
const projector = createProjector(CAMERA, medium.sceneWidth, medium.sceneHeight);

/** Is a point inside a rounded rectangle, as the shell tests it? */
function inside(r: Region, x: number, y: number): boolean {
  if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) return false;
  const radius = Math.min(r.r ?? 0, r.w / 2, r.h / 2);
  const cx = Math.max(r.x + radius, Math.min(r.x + r.w - radius, x));
  const cy = Math.max(r.y + radius, Math.min(r.y + r.h - radius, y));
  return Math.hypot(x - cx, y - cy) <= radius + 1e-9 || (x >= r.x + radius && x <= r.x + r.w - radius) || (y >= r.y + radius && y <= r.y + r.h - radius);
}
const anyInside = (regions: readonly Region[], x: number, y: number): boolean => regions.some((r) => inside(r, x, y));

describe('the window', () => {
  it('draws the island at about 380 by 450, in three sizes', () => {
    expect([medium.sceneWidth, medium.sceneHeight]).toEqual([SCENE.width, SCENE.height]);
    expect([islandLayout('small').sceneWidth, islandLayout('small').sceneHeight]).toEqual([304, 360]);
    expect([islandLayout('large').sceneWidth, islandLayout('large').sceneHeight]).toEqual([475, 563]);
  });

  it('keeps a band above and below for the Card, and lets it hang off the screen', () => {
    for (const size of ['small', 'medium', 'large'] as const) {
      const layout = islandLayout(size);
      expect(layout.windowHeight).toBeGreaterThanOrEqual(PANEL_SPACE);
      expect(layout.windowWidth).toBeGreaterThanOrEqual(MIN_WINDOW_WIDTH);
      expect(layout.sceneTop).toBe(layout.band);
      expect(layout.sceneTop + layout.sceneHeight + layout.band).toBe(layout.windowHeight);
      expect(layout.sceneLeft * 2 + layout.sceneWidth).toBeLessThanOrEqual(layout.windowWidth + 1);
      const mode = islandWindow(size, null);
      expect(mode).toEqual({ kind: 'floating', width: layout.windowWidth, height: layout.windowHeight, bleed: layout.band });
    }
  });

  it('passes a remembered position straight back', () => {
    expect(islandWindow('medium', { x: 1234, y: 567 })).toMatchObject({ kind: 'floating', x: 1234, y: 567 });
  });

  it('centres a panel on the island when there is room, and keeps it on screen when there is not', () => {
    const height = 540;
    const centred = panelTop(medium, height);
    expect(centred + height / 2).toBeCloseTo(medium.sceneTop + medium.sceneHeight / 2, 0);
    // The bottom of the window is off the screen: the panel moves up to stay visible.
    const cut = medium.windowHeight - 180;
    expect(panelTop(medium, 400, 0, cut) + 400).toBe(cut - PANEL_MARGIN);
    // The top of it is off the screen: it moves down.
    expect(panelTop(medium, 400, 180, medium.windowHeight)).toBe(180 + PANEL_MARGIN);
    // Too tall for what is visible: its top stays in view.
    expect(panelTop(medium, 900, 100, 500)).toBe(100 + PANEL_MARGIN);
  });
});

describe('the island', () => {
  it('is highest in the middle and meets its rim at the edge', () => {
    expect(groundY(0, 0)).toBeCloseTo(0.004, 3);
    expect(groundY(ISLAND.radius, 0)).toBeCloseTo(ISLAND.centreY, 6);
    expect(groundY(5, 5)).toBe(ISLAND.centreY);
    expect(groundY(0.5, 0.5)).toBeLessThan(groundY(0, 0));
  });
});

describe('the camera', () => {
  it('agrees with the three.js camera set up from the same numbers', () => {
    const camera = new PerspectiveCamera(CAMERA.fovDeg, medium.sceneWidth / medium.sceneHeight, CAMERA.near, CAMERA.far);
    camera.position.set(...CAMERA.position);
    camera.lookAt(...CAMERA.target);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    for (const point of [[0, 0, 0], [1.9, -0.3, 0], [-1.2, 0.8, 0.7], [0.4, 1.6, -1.5], [0, -1.6, 0], [-1.7, 2.7, -1.5]] as const) {
      const v = new Vector3(...point).project(camera);
      const mine = projector.project(point);
      expect(mine.x).toBeCloseTo((v.x * 0.5 + 0.5) * medium.sceneWidth, 3);
      expect(mine.y).toBeCloseTo((0.5 - v.y * 0.5) * medium.sceneHeight, 3);
      expect(mine.depth).toBeGreaterThan(0);
    }
  });

  it('a ray through a point on screen passes through the point it came from', () => {
    for (const point of [[0, 0.7, 0.3], [1.1, 0, 0.4], [-0.9, 1.3, -0.6]] as const) {
      const at = projector.project(point);
      const ray = projector.ray(at.x, at.y);
      const t = Math.hypot(point[0] - ray.origin[0], point[1] - ray.origin[1], point[2] - ray.origin[2]);
      for (let i = 0; i < 3; i++) expect((ray.origin[i] as number) + (ray.dir[i] as number) * t).toBeCloseTo(point[i] as number, 4);
    }
  });

  it('frames the island: all of it on screen, most of the width used', () => {
    const outline = islandSilhouette(projector);
    const xs = outline.map((p) => p.x);
    const ys = outline.map((p) => p.y);
    expect(Math.min(...xs)).toBeGreaterThan(8);
    expect(Math.max(...xs)).toBeLessThan(medium.sceneWidth - 8);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(medium.sceneWidth * 0.72);
    expect(Math.max(...ys)).toBeLessThan(medium.sceneHeight - 28);        // room for the focus chip underneath
    // Doozer, standing at home, with the top of its tuft: room above for the Radial.
    const tuft = projector.project([0, groundY(0, 0.3) + 1.66, 0.3]);
    expect(tuft.y).toBeGreaterThan(110);
  });

  it('finds where a ray meets an ellipsoid, or that it misses', () => {
    const ray = { origin: [0, 0, 10] as const, dir: [0, 0, -1] as const };
    expect(hitEllipsoid(ray, [0, 0, 0], [1, 2, 3])).toBeCloseTo(7, 6);
    expect(hitEllipsoid(ray, [0, 1.9, 0], [1, 2, 3])).not.toBeNull();
    expect(hitEllipsoid(ray, [0, 2.1, 0], [1, 2, 3])).toBeNull();
    expect(hitEllipsoid(ray, [0, 0, 20], [1, 2, 3])).toBeNull();        // behind the ray
    expect(hitEllipsoid(ray, [0, 0, 10], [1, 2, 3])).toBe(0);           // starts inside
  });
});

describe('the island\'s outline as hit regions', () => {
  const outline = islandSilhouette(projector);
  const regions = slabs(outline, 16, 3);

  it('a convex hull keeps the outermost points and drops the rest', () => {
    const square: Point[] = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }, { x: 2, y: 2 }, { x: 1, y: 3 }];
    expect(convexHull(square)).toHaveLength(4);
  });

  it('covers every point of the island that is drawn', () => {
    // Points on the grass, on its rim and on the earth below.
    for (let i = 0; i < 64; i++) {
      const a = (i / 64) * Math.PI * 2;
      for (const r of [0.2, 0.9, 1.5, ISLAND.radius]) {
        const p = projector.project([Math.cos(a) * r, groundY(Math.cos(a) * r, Math.sin(a) * r), Math.sin(a) * r]);
        expect(anyInside(regions, p.x, p.y), `grass at ${r}, angle ${i}`).toBe(true);
      }
      for (const depth of [0.3, 0.7, 1.0]) {
        const r = ISLAND.earthRadius * Math.cos((depth / ISLAND.earthDepth) * (Math.PI / 2));
        const p = projector.project([Math.cos(a) * r, ISLAND.centreY - depth, Math.sin(a) * r]);
        expect(anyInside(regions, p.x, p.y), `earth at depth ${depth}, angle ${i}`).toBe(true);
      }
    }
  });

  it('follows the outline: the empty corners of the drawing let clicks through', () => {
    const { sceneWidth: w, sceneHeight: h } = medium;
    for (const [x, y] of [[4, 4], [w - 4, 4], [4, h - 4], [w - 4, h - 4], [w / 2, 20], [20, h / 2 - 60], [w - 20, h - 80], [30, h - 60]] as const) {
      expect(anyInside(regions, x, y), `${x}, ${y}`).toBe(false);
    }
  });

  it('hugs the outline closely: the slabs cover little more than the island itself', () => {
    const area = (points: readonly Point[]): number => Math.abs(points.reduce((sum, p, i) => {
      const q = points[(i + 1) % points.length] as Point;
      return sum + (p.x * q.y - q.x * p.y);
    }, 0)) / 2;
    const covered = regions.reduce((sum, r) => sum + r.w * r.h, 0);
    expect(covered).toBeGreaterThan(area(outline));
    expect(covered).toBeLessThan(area(outline) * 1.22);
  });

  it('uses a handful of slabs, far inside what the shell accepts', () => {
    expect(regions.length).toBeGreaterThanOrEqual(6);
    expect(regions.length).toBeLessThanOrEqual(16);
    for (const r of regions) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });

  it('scales with the window', () => {
    const small = islandLayout('small');
    const smaller = slabs(islandSilhouette(createProjector(CAMERA, small.sceneWidth, small.sceneHeight)), 16, 3);
    const widest = (list: readonly Region[]): number => Math.max(...list.map((r) => r.w));
    expect(widest(smaller)).toBeCloseTo(widest(regions) * 0.8, -1);
  });
});

describe('Doozer and the ball as hit regions', () => {
  it('covers Doozer from its feet to the tip of its tuft, wherever it stands', () => {
    for (const at of [{ x: 0, z: 0.3, y: 0 }, { x: -0.8, z: 0.5, y: 0 }, { x: 0.7, z: -0.3, y: 0 }, { x: 0.2, z: 0.3, y: 0.35 }]) {
      const regions = doozerRegions(projector, at);
      const ground = groundY(at.x, at.z) + at.y;
      for (const [dx, dy] of [[0, 0.05], [0, 0.7], [0.6, 0.7], [-0.6, 0.7], [0, 1.4], [0.5, 1.3], [-0.5, 1.3], [0.1, 1.62]] as const) {
        const p = projector.project([at.x + dx, ground + dy, at.z]);
        expect(anyInside(regions, p.x, p.y), `${JSON.stringify(at)} + ${dx}, ${dy}`).toBe(true);
      }
      expect(regions).toHaveLength(2);
    }
  });

  it('moves with Doozer', () => {
    const left = doozerRegions(projector, { x: -0.8, z: 0.3, y: 0 })[0] as Region;
    const right = doozerRegions(projector, { x: 0.8, z: 0.3, y: 0 })[0] as Region;
    expect(right.x - left.x).toBeGreaterThan(100);
    const up = doozerRegions(projector, { x: 0, z: 0.3, y: 0.4 })[0] as Region;
    const down = doozerRegions(projector, { x: 0, z: 0.3, y: 0 })[0] as Region;
    expect(down.y - up.y).toBeGreaterThan(20);
  });

  it('gives the ball a round region and says where Doozer\'s middle and head are', () => {
    const r = ballRegion(projector, { x: 0.5, y: 1.2, z: 0.2 });
    expect(r.w).toBeCloseTo(r.h, 6);
    expect(r.r).toBeCloseTo(r.w / 2, 6);
    const p = doozerPoints(projector, { x: 0, z: 0.3, y: 0 });
    expect(p.head.y).toBeLessThan(p.middle.y);
    expect(p.middle.x).toBeCloseTo(medium.sceneWidth / 2, 3);
  });
});

describe('what is under the pointer', () => {
  const scene = { doozer: { x: 0, z: 0.3, y: 0 }, ball: { x: 1.0, y: groundY(1.0, 0.6) + 0.24, z: 0.6 }, snack: { x: -1.0, y: groundY(-1.0, 0.5), z: 0.5, size: 1 } };
  const at = (point: readonly [number, number, number]) => {
    const p = projector.project(point);
    return pick(projector.ray(p.x, p.y), scene);
  };

  it('tells Doozer, the ball, the snack, the island and the air apart', () => {
    expect(at([0, 0.8, 0.3])).toBe('doozer');
    expect(at([-0.4, 1.28, 0.3])).toBe('doozer');                        // an ear
    expect(at([1.0, scene.ball.y, 0.6])).toBe('ball');
    expect(at([-1.0, scene.snack.y + 0.2, 0.5])).toBe('snack');
    expect(at([1.5, groundY(1.5, -0.6), -0.6])).toBe('island');
    expect(at([0, -1.2, 0])).toBe('island');                             // the earth underneath
    expect(pick(projector.ray(6, 6), scene)).toBeNull();
    expect(pick(projector.ray(medium.sceneWidth / 2, 30), scene)).toBeNull();       // the sky above Doozer
    expect(pick(projector.ray(20, medium.sceneHeight - 30), scene)).toBeNull();     // beside the earth
  });

  it('Doozer in front of the island is Doozer; with nothing there the same spot is island or air', () => {
    const bare = { doozer: { x: 5, z: 5, y: 0 }, ball: null, snack: null };
    const p = projector.project([0, 0.3, 0.3]);
    expect(pick(projector.ray(p.x, p.y), scene)).toBe('doozer');
    expect(pick(projector.ray(p.x, p.y), bare)).toBe('island');
    const air = projector.project([0, 1.2, 0.3]);
    expect(pick(projector.ray(air.x, air.y), bare)).toBeNull();
  });

  it('follows Doozer as it squashes', () => {
    const tall = projector.project([0, 1.38, 0.3]);
    expect(pick(projector.ray(tall.x, tall.y), { ...scene, doozer: { ...scene.doozer, stretch: 1, bulge: 1 } })).toBe('doozer');
    expect(pick(projector.ray(tall.x, tall.y), { ...scene, doozer: { ...scene.doozer, stretch: 0.7, bulge: 1.2 } })).not.toBe('doozer');
  });
});
