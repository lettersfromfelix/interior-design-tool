/** Convex-polygon helpers for placement: hulls, overlap tests (SAT), ray casts and circle push-out. Plan cm. */
import type { Vec2 } from "../schema/common";
import { signedArea } from "./polygon";

export interface Rect2 {
  minX: number;
  minZ: number;
  maxX: number;
  maxZ: number;
}

export function boundsOf(points: readonly Vec2[]): Rect2 {
  const r: Rect2 = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const [x, z] of points) {
    r.minX = Math.min(r.minX, x);
    r.minZ = Math.min(r.minZ, z);
    r.maxX = Math.max(r.maxX, x);
    r.maxZ = Math.max(r.maxZ, z);
  }
  return r;
}

export function unionRect(rects: readonly Rect2[]): Rect2 {
  const r: Rect2 = { minX: Infinity, minZ: Infinity, maxX: -Infinity, maxZ: -Infinity };
  for (const b of rects) {
    r.minX = Math.min(r.minX, b.minX);
    r.minZ = Math.min(r.minZ, b.minZ);
    r.maxX = Math.max(r.maxX, b.maxX);
    r.maxZ = Math.max(r.maxZ, b.maxZ);
  }
  return r;
}

/** Do the rectangles overlap by more than `tol` (cm) on both axes? */
export const rectsOverlap = (a: Rect2, b: Rect2, tol = 0): boolean =>
  a.minX < b.maxX - tol && b.minX < a.maxX - tol && a.minZ < b.maxZ - tol && b.minZ < a.maxZ - tol;

const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/**
 * Convex hull (Andrew's monotone chain). Degenerate input (a point or a line) becomes a thin polygon, so every
 * result has at least 3 corners and a usable area.
 */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-9) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-9) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  if (hull.length >= 3) return hull;
  // a point or a segment: give it 1 mm of width
  const b = boundsOf(pts.length ? pts : [[0, 0]]);
  const e = 0.05;
  return [
    [b.minX - e, b.minZ - e],
    [b.maxX + e, b.minZ - e],
    [b.maxX + e, b.maxZ + e],
    [b.minX - e, b.maxZ + e],
  ];
}

function project(poly: readonly Vec2[], nx: number, nz: number): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const [x, z] of poly) {
    const d = x * nx + z * nz;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return [lo, hi];
}

/**
 * How deep two convex polygons overlap (separating axis theorem): > 0 = overlap depth in cm, <= 0 = they are
 * apart by at least −result.
 */
export function overlapDepth(a: readonly Vec2[], b: readonly Vec2[]): number {
  let depth = Infinity;
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (len < 1e-9) continue;
      const nx = (q[1] - p[1]) / len;
      const nz = -(q[0] - p[0]) / len;
      const [a0, a1] = project(a, nx, nz);
      const [b0, b1] = project(b, nx, nz);
      depth = Math.min(depth, Math.min(a1, b1) - Math.max(a0, b0));
      if (depth <= 0) return depth;
    }
  }
  return depth;
}

/** Point inside a convex polygon (either winding). `tol` > 0 accepts points up to tol cm outside, < 0 demands depth. */
export function insideConvex(p: Vec2, poly: readonly Vec2[], tol = 0): boolean {
  const w = Math.sign(signedArea(poly)) || 1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (len < 1e-9) continue;
    if ((w * cross(a, b, p)) / len < -tol) return false;
  }
  return true;
}

export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / l2));
  return [a[0] + t * dx, a[1] + t * dz];
}

/** Distance along the ray `origin + t·dir` (dir of unit length) to the polygon's boundary; 0 if it starts inside. */
export function rayToPolygon(origin: Vec2, dir: Vec2, poly: readonly Vec2[]): number | undefined {
  if (insideConvex(origin, poly, 1e-6)) return 0;
  let best: number | undefined;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const den = dir[0] * ez - dir[1] * ex;
    if (Math.abs(den) < 1e-12) continue; // parallel
    const ox = a[0] - origin[0];
    const oz = a[1] - origin[1];
    const t = (ox * ez - oz * ex) / den;
    const s = (ox * dir[1] - oz * dir[0]) / den;
    if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9 && (best === undefined || t < best)) best = t;
  }
  return best;
}

/**
 * Smallest move that takes a circle out of a convex polygon, or undefined if they don't touch. Used to keep the
 * walking camera out of walls and furniture.
 */
export function pushCircleOut(center: Vec2, radius: number, poly: readonly Vec2[]): Vec2 | undefined {
  if (insideConvex(center, poly)) {
    // out through the nearest edge
    let best: { d: number; n: Vec2 } | undefined;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const q = closestOnSegment(center, a, b);
      const d = Math.hypot(center[0] - q[0], center[1] - q[1]);
      if (!best || d < best.d) {
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        // outward normal: away from the polygon's centre
        let n: Vec2 = [(b[1] - a[1]) / len, -(b[0] - a[0]) / len];
        const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const c = polygonCenter(poly);
        if ((mid[0] - c[0]) * n[0] + (mid[1] - c[1]) * n[1] < 0) n = [-n[0], -n[1]];
        best = { d, n };
      }
    }
    if (!best) return undefined;
    return [best.n[0] * (best.d + radius), best.n[1] * (best.d + radius)];
  }
  let nearest: Vec2 | undefined;
  let dist = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const q = closestOnSegment(center, poly[i], poly[(i + 1) % poly.length]);
    const d = Math.hypot(center[0] - q[0], center[1] - q[1]);
    if (d < dist) {
      dist = d;
      nearest = q;
    }
  }
  if (!nearest || dist >= radius) return undefined;
  if (dist < 1e-9) return undefined;
  const k = (radius - dist) / dist;
  return [(center[0] - nearest[0]) * k, (center[1] - nearest[1]) * k];
}

export function polygonCenter(poly: readonly Vec2[]): Vec2 {
  let x = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    z += p[1];
  }
  return [x / poly.length, z / poly.length];
}
