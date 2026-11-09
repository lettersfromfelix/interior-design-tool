/**
 * Door leaves in the host wall's local frame: x along the centre line from the wall's start, z across it
 * (+z = the wall's right side). Shared by the renderer (leaves, swing arcs) and placement (door-swing areas).
 */
import type { Opening } from "../schema/apartment";

export interface DoorLeaf {
  /** Hinge position along the wall. */
  x: number;
  /** +1: the leaf closes towards larger x; −1: towards smaller x. */
  dir: 1 | -1;
}

export interface DoorGeometry {
  /** Opening from `a` to `b` along the wall. */
  a: number;
  b: number;
  jamb: number;
  leafWidth: number;
  /** +1: the leaves swing to the wall's right side, −1: to its left side. */
  sgn: 1 | -1;
  leaves: DoorLeaf[];
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Start of an opening along its wall (cm from the wall's start). */
export const openingStart = (o: Opening): number => Math.max(0, o.centerFromStart - o.width / 2);

export function doorGeometry(o: Opening): DoorGeometry | undefined {
  const d = o.door;
  if (!d) return undefined;
  const a = openingStart(o);
  const b = a + o.width;
  const leafWidth = d.leafWidth ?? (o.width - 8) / d.leaves;
  const jamb = clamp((o.width - d.leaves * leafWidth) / 2, 2, 8);
  const leaves: DoorLeaf[] =
    d.leaves === 2
      ? [
          { x: a + jamb, dir: 1 },
          { x: b - jamb, dir: -1 },
        ]
      : [d.hinge === "start" ? { x: a + jamb, dir: 1 } : { x: b - jamb, dir: -1 }];
  return { a, b, jamb, leafWidth, sgn: d.opensTo === "right" ? 1 : -1, leaves };
}

/**
 * Outline of a leaf's swing (a quarter disc around the hinge) in wall-local [x, z], from the closed position to
 * open at 90°. `t` is the wall thickness.
 */
export function swingOutline(leaf: DoorLeaf, g: DoorGeometry, t: number, segments = 12): [number, number][] {
  const pts: [number, number][] = [[leaf.x, (g.sgn * t) / 2]];
  for (let i = 0; i <= segments; i++) {
    const th = (i / segments) * (Math.PI / 2);
    pts.push([leaf.x + leaf.dir * g.leafWidth * Math.cos(th), g.sgn * (t / 2 + g.leafWidth * Math.sin(th))]);
  }
  return pts;
}
