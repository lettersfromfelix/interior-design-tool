/** Live distances while moving an item: from each side of its footprint to the nearest obstacle in that direction. */
import { overlapDepth, rayToPolygon } from "../geometry/convex";
import type { WorldPose } from "../layout/poses";
import type { Vec2 } from "../schema/common";
import { rectCorners, toWorld, type Solid } from "./shapes";

export interface SideDistance {
  side: "front" | "back" | "left" | "right";
  from: Vec2;
  to: Vec2;
  length: number;
}

/** Rays per side. */
const SAMPLES = 5;

/**
 * Distances (cm) from the item's four sides (width × depth at `pose`, height `height`) to the nearest of `obstacles`
 * that overlap it in height, up to `max`. Obstacles the item is already under or inside (a chair under a table top)
 * are skipped; sides touching something get no line.
 */
export function sideDistances(
  size: { width: number; depth: number; height: number },
  pose: WorldPose,
  obstacles: readonly Solid[],
  max = 1000,
): SideDistance[] {
  const { width: w, depth: d, height: h } = size;
  const rect = rectCorners(w, d).map((p) => toWorld(p, pose));
  const near = obstacles.filter((o) => Math.min(o.y1, pose.y + h) - Math.max(o.y0, pose.y) > 0.5 && overlapDepth(rect, o.poly) <= 0.5);
  const inset = 0.5;
  const sides: { side: SideDistance["side"]; dir: Vec2; from: Vec2; to: Vec2 }[] = [
    { side: "front", dir: [0, 1], from: [-w / 2 + inset, d / 2], to: [w / 2 - inset, d / 2] },
    { side: "back", dir: [0, -1], from: [-w / 2 + inset, -d / 2], to: [w / 2 - inset, -d / 2] },
    { side: "right", dir: [1, 0], from: [w / 2, -d / 2 + inset], to: [w / 2, d / 2 - inset] },
    { side: "left", dir: [-1, 0], from: [-w / 2, -d / 2 + inset], to: [-w / 2, d / 2 - inset] },
  ];
  const origin = toWorld([0, 0], pose);
  const out: SideDistance[] = [];
  for (const s of sides) {
    const tip = toWorld(s.dir, pose);
    const dir: Vec2 = [tip[0] - origin[0], tip[1] - origin[1]];
    let best: { from: Vec2; t: number } | undefined;
    for (let i = 0; i < SAMPLES; i++) {
      const k = i / (SAMPLES - 1);
      const from = toWorld([s.from[0] + (s.to[0] - s.from[0]) * k, s.from[1] + (s.to[1] - s.from[1]) * k], pose);
      for (const o of near) {
        const t = rayToPolygon(from, dir, o.poly);
        if (t !== undefined && t <= max && (!best || t < best.t)) best = { from, t };
      }
    }
    if (best && best.t > 0.5) {
      out.push({ side: s.side, from: best.from, to: [best.from[0] + dir[0] * best.t, best.from[1] + dir[1] * best.t], length: best.t });
    }
  }
  return out;
}
