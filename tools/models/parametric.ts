/**
 * Helpers shared by the parametric item generators in this folder (scripts that write catalogue/<id>.json from
 * primitives): parts from coordinate ranges, tilting a whole assembly, smooth outlines, fitting the parts to the item's
 * box, and writing the file in the catalogue's house style.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { partsBounds } from "../../src/core/catalogue/bounds";
import { CatalogueItem } from "../../src/core/schema/catalogue";
import type { Part } from "../../src/core/schema/common";

export type R2 = readonly [number, number];
export type P2 = [number, number];
type Vec = { x: number; y: number; z: number };

/** Rounded to 0.01 cm, without -0. */
export const r = (v: number) => Math.round(v * 100) / 100 + 0;
/** Rounded to 0.1 cm (outline points). */
export const r1 = (v: number) => Math.round(v * 10) / 10 + 0;
export const mid = ([a, b]: R2) => (a + b) / 2;
export const len = ([a, b]: R2) => b - a;
export const vec = (x = 0, y = 0, z = 0): Vec => ({ x: r(x), y: r(y), z: r(z) });
export const DEG = Math.PI / 180;

export interface Extra {
  cornerRadius?: number;
  rotation?: { x?: number; y?: number; z?: number };
  repeat?: { count: number; step: Vec };
  repeatAround?: { count: number; step: number };
  mirror?: ("x" | "z")[];
  plan?: "solid" | "dashed" | "hidden";
}

/** The part properties after the shape's own ones, in the order the catalogue files use. */
export function tail(position: Vec, material: string, e: Extra = {}) {
  const rotation = e.rotation && Object.fromEntries(Object.entries(e.rotation).filter(([, v]) => v !== undefined && r(v) !== 0).map(([k, v]) => [k, r(v!)]));
  return {
    position: vec(position.x, position.y, position.z),
    ...(rotation && Object.keys(rotation).length > 0 && { rotation }),
    ...(e.repeat && { repeat: { count: e.repeat.count, step: vec(e.repeat.step.x, e.repeat.step.y, e.repeat.step.z) } }),
    ...(e.repeatAround && { repeatAround: e.repeatAround }),
    ...(e.mirror && { mirror: e.mirror }),
    ...(e.plan && { plan: e.plan }),
    material,
  };
}

/** A box spanning x, y and z (item frame). */
export function box(name: string, x: R2, y: R2, z: R2, material: string, e: Extra = {}): Part {
  return {
    name,
    shape: "box",
    size: vec(len(x), len(y), len(z)),
    ...(e.cornerRadius ? { cornerRadius: r(e.cornerRadius) } : {}),
    ...tail({ x: mid(x), y: mid(y), z: mid(z) }, material, e),
  } as Part;
}

/** A box of `size` centred on `at`. */
export function boxAt(name: string, size: Vec, at: Vec, material: string, e: Extra = {}): Part {
  return { name, shape: "box", size: vec(size.x, size.y, size.z), ...(e.cornerRadius ? { cornerRadius: r(e.cornerRadius) } : {}), ...tail(at, material, e) } as Part;
}

// --- rotations

type M3 = number[][];
const mm = (a: M3, b: M3): M3 => a.map((row) => b[0].map((_, j) => row.reduce((s, v, k) => s + v * b[k][j], 0)));
const rx = (a: number): M3 => [
  [1, 0, 0],
  [0, Math.cos(a), -Math.sin(a)],
  [0, Math.sin(a), Math.cos(a)],
];
const ry = (a: number): M3 => [
  [Math.cos(a), 0, Math.sin(a)],
  [0, 1, 0],
  [-Math.sin(a), 0, Math.cos(a)],
];
const rz = (a: number): M3 => [
  [Math.cos(a), -Math.sin(a), 0],
  [Math.sin(a), Math.cos(a), 0],
  [0, 0, 1],
];
/** A part's rotation matrix, as the engine applies it: z, then x, then y (y clockwise seen from above). */
export const rotationMatrix = (rot: Extra["rotation"] = {}): M3 => mm(mm(ry(-(rot.y ?? 0) * DEG), rx((rot.x ?? 0) * DEG)), rz((rot.z ?? 0) * DEG));
/** The part rotation (degrees, applied z, x, y) of a rotation matrix. */
export function rotationOf(m: M3): { x: number; y: number; z: number } {
  // m = Ry(-y)·Rx(x)·Rz(z): m[1][2] = -sin x, m[0][2] = cos x·sin(-y), m[2][2] = cos x·cos(-y), m[1][0] = cos x·sin z, m[1][1] = cos x·cos z
  const x = Math.asin(Math.max(-1, Math.min(1, -m[1][2])));
  const y = -Math.atan2(m[0][2], m[2][2]);
  const z = Math.atan2(m[1][0], m[1][1]);
  return { x: x / DEG, y: y / DEG, z: z / DEG };
}
const apply = (m: M3, v: Vec): Vec => ({
  x: m[0][0] * v.x + m[0][1] * v.y + m[0][2] * v.z,
  y: m[1][0] * v.x + m[1][1] * v.y + m[1][2] * v.z,
  z: m[2][0] * v.x + m[2][1] * v.y + m[2][2] * v.z,
});

/**
 * Turn whole parts around a horizontal axis along x through `pivot` (y, z), by `deg` degrees with the top going
 * backwards (towards −z) for positive `deg`, as a mirror leaning back. Positions, rotations and repeat steps turn
 * with the assembly. Mirroring in x commutes with the turn; mirroring in z doesn't and is refused.
 */
export function tiltBack(parts: Part[], deg: number, pivot: { y: number; z: number }): Part[] {
  const t = rx(-deg * DEG);
  return parts.map((p) => {
    if (p.mirror?.includes("z")) throw new Error(`${p.name}: can't tilt a part mirrored in z`);
    const local = { x: p.position.x, y: p.position.y - pivot.y, z: p.position.z - pivot.z };
    const at = apply(t, local);
    const rot = rotationOf(mm(t, rotationMatrix(p.rotation)));
    const out = { ...p, position: vec(at.x, at.y + pivot.y, at.z + pivot.z), rotation: { x: r(rot.x), y: r(rot.y), z: r(rot.z) } } as Part;
    if (p.repeat) out.repeat = { count: p.repeat.count, step: (({ x, y, z }) => vec(x, y, z))(apply(t, p.repeat.step)) };
    return reorder(out);
  });
}

/** Keep the house-style property order after changing a part, and drop zero rotations. */
function reorder(p: Part): Part {
  const { position, rotation, repeat, repeatAround, mirror, plan, material, ...shape } = p as Part & Extra;
  return { ...shape, ...tail(position, material, { rotation, repeat, repeatAround, mirror, plan }) } as Part;
}

/** Move parts by (dx, dy, dz). Parts mirrored in an axis can't move along it. */
export function translate(parts: Part[], dx: number, dy: number, dz: number): Part[] {
  const [mx, mz] = [Math.abs(dx) > 1e-6, Math.abs(dz) > 1e-6];
  return parts.map((p) => {
    if ((mx && p.mirror?.includes("x")) || (mz && p.mirror?.includes("z"))) throw new Error(`${p.name}: can't move a mirrored part off its mirror plane`);
    return { ...p, position: vec(p.position.x + (mx ? dx : 0), p.position.y + dy, p.position.z + (mz ? dz : 0)) } as Part;
  });
}

/**
 * Stand the parts on the floor (lowest point at y = 0) and centre them in z (and in x unless `keepX`), so that they
 * fill a box around the item's origin. Returns the moved parts and that box's size (rounded up to 0.1 cm).
 */
export function fitToBox(parts: Part[], keepX = false): { parts: Part[]; dimensions: { width: number; depth: number; height: number } } {
  const b = partsBounds(parts)!;
  const dx = keepX ? 0 : -(b.min.x + b.max.x) / 2;
  const moved = translate(parts, dx, -b.min.y, -(b.min.z + b.max.z) / 2);
  const c = partsBounds(moved)!;
  const up = (v: number) => Math.ceil(v * 10 - 1e-6) / 10;
  return { parts: moved, dimensions: { width: up(2 * Math.max(-c.min.x, c.max.x)), depth: up(c.max.z - c.min.z), height: up(c.max.y) } };
}

// --- outlines (as [x, y] seen from the front, or [x, z] seen from above)

/** Points on a circular arc around (cx, cy) from angle a0 to a1 (degrees, counter-clockwise from +x), every `stepDeg`. */
export function arcPoints(cx: number, cy: number, radius: number, a0: number, a1: number, stepDeg = 7.5): P2[] {
  const n = Math.max(1, Math.round(Math.abs(a1 - a0) / stepDeg));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    return [cx + radius * Math.cos(a), cy + radius * Math.sin(a)] as P2;
  });
}

/** A closed centripetal Catmull–Rom spline through `pts`, `per` points per segment (smooth, no overshoot loops). */
export function closedSpline(pts: P2[], per: number): P2[] {
  const n = pts.length;
  const out: P2[] = [];
  const knot = (a: P2, b: P2) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-6;
  const lerp = (a: P2, b: P2, ta: number, tb: number, t: number): P2 => {
    const u = (t - ta) / (tb - ta);
    return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
  };
  for (let i = 0; i < n; i++) {
    const [p0, p1, p2, p3] = [pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n], pts[(i + 2) % n]];
    const t0 = 0;
    const t1 = t0 + knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let k = 0; k < per; k++) {
      const t = t1 + ((t2 - t1) * k) / per;
      const a1 = lerp(p0, p1, t0, t1, t);
      const a2 = lerp(p1, p2, t1, t2, t);
      const a3 = lerp(p2, p3, t2, t3, t);
      const b1 = lerp(a1, a2, t0, t2, t);
      const b2 = lerp(a2, a3, t1, t3, t);
      out.push(lerp(b1, b2, t1, t2, t));
    }
  }
  return out;
}

/** Twice the signed area: positive for counter-clockwise outlines (x right, y up). */
export const signedArea = (pts: P2[]) => pts.reduce((s, [x, y], i) => s + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0);

/** The outline moved outwards by d (inwards for negative d), along the bisector of each corner's edge normals. */
export function offsetOutline(pts: P2[], d: number): P2[] {
  const ccw = signedArea(pts) > 0 ? 1 : -1;
  const n = pts.length;
  const normal = (a: P2, b: P2): P2 => {
    const [ex, ey] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(ex, ey) || 1;
    return [(ccw * ey) / l, (-ccw * ex) / l];
  };
  return pts.map((p, i) => {
    const n1 = normal(pts[(i - 1 + n) % n], p);
    const n2 = normal(p, pts[(i + 1) % n]);
    const [bx, by] = [n1[0] + n2[0], n1[1] + n2[1]];
    const cos = (bx * n1[0] + by * n1[1]) / (Math.hypot(bx, by) || 1);
    const k = d / Math.max(cos, 0.3) / (Math.hypot(bx, by) || 1);
    return [p[0] + bx * k, p[1] + by * k] as P2;
  });
}

// --- the file

/** House style: two-space indent, one part per line. */
export const inline = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (v && typeof v === "object") return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }`;
  return JSON.stringify(v);
};

/**
 * Validate the item against the catalogue schema and write catalogue/<id>.json (or `file`, relative to catalogue/) in
 * the house style: the keys in the given order, one part per line, one material slot per line.
 */
export function writeItem(item: Record<string, unknown> & { id: string }, file = `${item.id}.json`): string {
  CatalogueItem.parse(item); // throws on anything the schema rejects
  const lines = Object.entries(item).map(([k, v]) => {
    if (k === "geometry" && (v as { type: string }).type === "parametric") {
      const parts = (v as { parts: Part[] }).parts;
      return [`  "geometry": {`, `    "type": "parametric",`, `    "parts": [`, parts.map((p) => `      ${inline(p)}`).join(",\n"), `    ]`, `  }`].join("\n");
    }
    if (k === "collisionParts") return [`  "collisionParts": [`, (v as Part[]).map((p) => `    ${inline(p)}`).join(",\n"), `  ]`].join("\n");
    if (k === "materialSlots") return [`  "materialSlots": {`, Object.entries(v as object).map(([s, d]) => `    ${JSON.stringify(s)}: ${inline(d)}`).join(",\n"), `  }`].join("\n");
    return `  ${JSON.stringify(k)}: ${inline(v)}`;
  });
  const out = resolve(import.meta.dirname, "../../catalogue", file);
  writeFileSync(out, `{\n${lines.join(",\n")}\n}\n`);
  return out;
}
