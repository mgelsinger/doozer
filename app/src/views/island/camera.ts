// The Island's camera as plain arithmetic: where a point of the world lands on screen, and
// the ray under a point of the screen. The three.js camera is set up from the same numbers
// (stage3d.ts), so this can answer "what is under the pointer?" and "where does the
// island's outline run?" without three.js, without a frame, and in a test.

export type Vec3 = readonly [number, number, number];

export interface CameraSpec {
  readonly position: Vec3;
  readonly target: Vec3;
  /** Vertical field of view, degrees. */
  readonly fovDeg: number;
}

export interface ScreenPoint {
  /** CSS pixels from the top-left of the drawing. */
  x: number;
  y: number;
  /** Distance in front of the camera. Not positive means behind it. */
  depth: number;
  /** Pixels per world unit at that distance. */
  scale: number;
}

export interface Ray {
  origin: Vec3;
  /** Unit length. */
  dir: Vec3;
}

export interface Projector {
  readonly width: number;
  readonly height: number;
  project(point: Vec3): ScreenPoint;
  ray(x: number, y: number): Ray;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec3): Vec3 => {
  const length = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};

export function createProjector(camera: CameraSpec, width: number, height: number): Projector {
  const forward = unit(sub(camera.target, camera.position));
  const right = unit(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tan = Math.tan((camera.fovDeg * Math.PI) / 360);
  const aspect = width / Math.max(1, height);

  return {
    width,
    height,
    project(point) {
      const d = sub(point, camera.position);
      const depth = dot(d, forward);
      const safe = Math.max(1e-6, depth);
      return {
        x: (dot(d, right) / (safe * tan * aspect) * 0.5 + 0.5) * width,
        y: (0.5 - dot(d, up) / (safe * tan) * 0.5) * height,
        depth,
        scale: height / (2 * safe * tan),
      };
    },
    ray(x, y) {
      const nx = (x / Math.max(1, width) * 2 - 1) * tan * aspect;
      const ny = (1 - y / Math.max(1, height) * 2) * tan;
      return {
        origin: camera.position,
        dir: unit([forward[0] + right[0] * nx + up[0] * ny, forward[1] + right[1] * nx + up[1] * ny, forward[2] + right[2] * nx + up[2] * ny]),
      };
    },
  };
}

/**
 * Where a ray first meets an ellipsoid, as a distance along the ray, or null. `radii` may
 * be any positive numbers; a ray that starts inside counts as a hit at 0.
 */
export function hitEllipsoid(ray: Ray, centre: Vec3, radii: Vec3): number | null {
  // Squeeze space so the ellipsoid is a unit ball.
  const o: Vec3 = [(ray.origin[0] - centre[0]) / radii[0], (ray.origin[1] - centre[1]) / radii[1], (ray.origin[2] - centre[2]) / radii[2]];
  const d: Vec3 = [ray.dir[0] / radii[0], ray.dir[1] / radii[1], ray.dir[2] / radii[2]];
  const a = dot(d, d);
  const b = 2 * dot(o, d);
  const c = dot(o, o) - 1;
  if (c <= 0) return 0;
  const disc = b * b - 4 * a * c;
  if (disc < 0 || a === 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 ? t : null;
}
