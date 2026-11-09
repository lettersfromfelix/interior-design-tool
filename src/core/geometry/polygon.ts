import type { Vec2 } from "../schema/common";

/** Signed shoelace area (cm² for cm input). Positive = clockwise on screen (z down). */
export function signedArea(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * z2 - x2 * z1;
  }
  return a / 2;
}

export const area = (pts: readonly Vec2[]): number => Math.abs(signedArea(pts));

export function centroid(pts: readonly Vec2[]): Vec2 {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-9) {
    const sx = pts.reduce((s, p) => s + p[0], 0);
    const sz = pts.reduce((s, p) => s + p[1], 0);
    return [sx / pts.length, sz / pts.length];
  }
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i];
    const [x2, z2] = pts[(i + 1) % pts.length];
    const f = x1 * z2 - x2 * z1;
    cx += (x1 + x2) * f;
    cz += (z1 + z2) * f;
  }
  return [cx / (6 * a), cz / (6 * a)];
}

export function pointInPolygon(p: Vec2, pts: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, zi] = pts[i];
    const [xj, zj] = pts[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export const length = (a: Vec2, b: Vec2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Unit direction a -> b. */
export function direction(a: Vec2, b: Vec2): Vec2 {
  const l = length(a, b);
  return [(b[0] - a[0]) / l, (b[1] - a[1]) / l];
}

/** Normal to the LEFT of d as seen on the floor plan (x right, z down). */
export const leftNormal = (d: Vec2): Vec2 => [d[1], -d[0]];

/** Rotate (x, z) clockwise on the plan by `deg` degrees (the data-file convention). */
export function rotatePlan(p: Vec2, deg: number): Vec2 {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c];
}

/** Do two segments properly intersect (excluding shared endpoints)? */
export function segmentsIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): boolean {
  const o = (p: Vec2, q: Vec2, r: Vec2) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a);
  const d2 = o(c, d, b);
  const d3 = o(a, b, c);
  const d4 = o(a, b, d);
  return ((d1 > 1e-9 && d2 < -1e-9) || (d1 < -1e-9 && d2 > 1e-9)) && ((d3 > 1e-9 && d4 < -1e-9) || (d3 < -1e-9 && d4 > 1e-9));
}

export function distanceToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dz));
}

/**
 * A point well inside the polygon (approximate pole of inaccessibility), for labels.
 * Unlike the centroid it always lies inside, also for L-shaped rooms.
 */
export function labelPoint(pts: readonly Vec2[], step = 10): Vec2 {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of pts) {
    minX = Math.min(minX, x);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxZ = Math.max(maxZ, z);
  }
  const c = centroid(pts);
  let best: Vec2 = c;
  let bestScore = -Infinity;
  for (let x = minX + step / 2; x < maxX; x += step) {
    for (let z = minZ + step / 2; z < maxZ; z += step) {
      const p: Vec2 = [x, z];
      if (!pointInPolygon(p, pts)) continue;
      let d = Infinity;
      for (let i = 0; i < pts.length; i++) d = Math.min(d, distanceToSegment(p, pts[i], pts[(i + 1) % pts.length]));
      // prefer points close to the centroid when the clearance is similar
      const score = d - 0.05 * length(p, c);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
  }
  return best;
}

export function isSimplePolygon(pts: readonly Vec2[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(i - j) <= 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsIntersect(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return false;
    }
  }
  return true;
}
