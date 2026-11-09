/** Tape measure: snapping a clicked point to corners, midpoints and edges of walls, fixtures and furniture. */
import { closestOnSegment } from "../geometry/convex";
import type { Vec2 } from "../schema/common";

export interface MeasureTargets {
  corners: readonly Vec2[];
  edges: readonly (readonly [Vec2, Vec2])[];
}

export interface MeasureSnap {
  point: Vec2;
  kind: "corner" | "midpoint" | "edge" | "free";
}

/** Snap `p` to the nearest corner, else edge midpoint, else edge within `tol` (cm); otherwise keep it. */
export function snapMeasurePoint(p: Vec2, targets: MeasureTargets, tol: number): MeasureSnap {
  const dist = (q: Vec2) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  let best: { point: Vec2; d: number } | undefined;
  for (const c of targets.corners) {
    const d = dist(c);
    if (d <= tol && (!best || d < best.d)) best = { point: c, d };
  }
  if (best) return { point: [best.point[0], best.point[1]], kind: "corner" };
  for (const [a, b] of targets.edges) {
    const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = dist(m);
    if (d <= tol && (!best || d < best.d)) best = { point: m, d };
  }
  if (best) return { point: best.point, kind: "midpoint" };
  for (const [a, b] of targets.edges) {
    const q = closestOnSegment(p, a, b);
    const d = dist(q);
    if (d <= tol && (!best || d < best.d)) best = { point: q, d };
  }
  if (best) return { point: best.point, kind: "edge" };
  return { point: [p[0], p[1]], kind: "free" };
}

/** Keep `p` on the horizontal or vertical line through `from` (whichever is closer), for Shift-measuring. */
export function constrainToAxis(from: Vec2, p: Vec2): Vec2 {
  return Math.abs(p[0] - from[0]) >= Math.abs(p[1] - from[1]) ? [p[0], from[1]] : [from[0], p[1]];
}
