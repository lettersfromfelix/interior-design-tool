/**
 * Bounding box of parametric parts, computed without Three.js (so validation can run anywhere).
 *
 * Every part is described by a few "blobs": the set { c + M·u : |u| <= r } for a centre c, a linear map M and a
 * radius r. A point is M = 0, a sphere M = I, an ellipsoid M = diag(scale), a flat disc M = [u v 0] (two in-plane
 * axes). Rotations, mirrors and translations keep that form, and the extent along a world axis i is
 * r · |row i of M|, so rotated discs (cylinder ends), rounded boxes and spheres stay exact.
 * Partial arcs (torus, lathe) are sampled every 2°.
 */
import { convexHull } from "../geometry/convex";
import type { Part, Vec2, Vec3 } from "../schema/common";

type V3 = [number, number, number];
/** Row-major 3×3 matrix. */
type M3 = [number, number, number, number, number, number, number, number, number];

interface Blob {
  c: V3;
  m: M3;
  r: number;
}

export interface Box3D {
  min: Vec3;
  max: Vec3;
}

const DEG = Math.PI / 180;
const ZERO: M3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
/** Horizontal disc (x/z plane). */
const FLAT: M3 = [1, 0, 0, 0, 0, 0, 0, 0, 1];

function mul(a: M3, b: M3): M3 {
  const o = [0, 0, 0, 0, 0, 0, 0, 0, 0] as M3;
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) o[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  }
  return o;
}

const apply = (a: M3, v: V3): V3 => [
  a[0] * v[0] + a[1] * v[1] + a[2] * v[2],
  a[3] * v[0] + a[4] * v[1] + a[5] * v[2],
  a[6] * v[0] + a[7] * v[1] + a[8] * v[2],
];

const rotX = (a: number): M3 => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
const rotY = (a: number): M3 => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
const rotZ = (a: number): M3 => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];

/**
 * Rotation of a part, identical to the engine's Euler(x, −y, z, "YXZ") in degrees: y is clockwise seen from above,
 * x and z tilt by the right-hand rule.
 */
export function partRotation(r: Part["rotation"]): M3 {
  return mul(mul(rotY(-(r?.y ?? 0) * DEG), rotX((r?.x ?? 0) * DEG)), rotZ((r?.z ?? 0) * DEG));
}

const transform = (b: Blob, a: M3, t: V3 = [0, 0, 0]): Blob => {
  const c = apply(a, b.c);
  return { c: [c[0] + t[0], c[1] + t[1], c[2] + t[2]], m: mul(a, b.m), r: b.r };
};

/** Angles from 0 to `arc` (degrees) at most 2° apart, both ends included. */
function arcSamples(arc: number): number[] {
  const n = Math.max(2, Math.ceil(arc / 2));
  return Array.from({ length: n + 1 }, (_, i) => ((arc * i) / n) * DEG);
}

/** Blobs of one part in part-local coordinates (before its position and rotation). */
function localBlobs(part: Part): Blob[] {
  switch (part.shape) {
    case "box": {
      const { x, y, z } = part.size;
      // same clamping as the engine (RoundedBoxGeometry): a rounded box is a smaller box plus a sphere
      const r = Math.min(part.cornerRadius ?? 0, Math.min(x, y, z) / 2 - 0.01);
      const round = r > 0.05;
      const k = round ? r : 0;
      const out: Blob[] = [];
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) {
            out.push({ c: [sx * (x / 2 - k), sy * (y / 2 - k), sz * (z / 2 - k)], m: round ? IDENTITY : ZERO, r: k });
          }
        }
      }
      return out;
    }
    case "cylinder":
      return [
        { c: [0, part.height / 2, 0], m: FLAT, r: part.radiusTop ?? part.radius },
        { c: [0, -part.height / 2, 0], m: FLAT, r: part.radius },
      ];
    case "sphere": {
      const s = part.scale ?? { x: 1, y: 1, z: 1 };
      return [{ c: [0, 0, 0], m: [s.x, 0, 0, 0, s.y, 0, 0, 0, s.z], r: part.radius }];
    }
    case "torus":
      // ring in the x/z plane from +x clockwise seen from above; the tube's cross-section is a circle in the plane
      // of the radial direction and y
      return arcSamples(part.arc ?? 360).map((u) => {
        const [cu, su] = [Math.cos(u), Math.sin(u)];
        return { c: [part.radius * cu, 0, part.radius * su], m: [cu, 0, 0, 0, 1, 0, su, 0, 0], r: part.tube };
      });
    case "extrusion":
      return part.points.flatMap(([x, z]) => [
        { c: [x, 0, z] as V3, m: ZERO, r: 0 },
        { c: [x, part.height, z] as V3, m: ZERO, r: 0 },
      ]);
    case "lathe": {
      const arc = part.arc ?? 360;
      if (arc >= 360) return part.profile.map(([r, y]) => ({ c: [0, y, 0] as V3, m: FLAT, r }));
      const angles = arcSamples(arc);
      return part.profile.flatMap(([r, y]) =>
        angles.map((a) => ({ c: [r * Math.cos(a), y, r * Math.sin(a)] as V3, m: ZERO, r: 0 })),
      );
    }
  }
}

/** Blobs of every copy of a part (`repeat`, `repeatAround` and `mirror` copies separately), in item-local cm. */
function partCopyBlobs(part: Part): Blob[][] {
  const local = localBlobs(part);
  const rot = partRotation(part.rotation);
  const count = part.repeat?.count ?? 1;
  const step = part.repeat?.step ?? { x: 0, y: 0, z: 0 };
  const around = part.repeatAround ?? { count: 1, step: 0 };
  const copies: Blob[][] = [];
  for (let k = 0; k < around.count; k++) {
    const pivot = rotY(-k * around.step * DEG);
    for (let i = 0; i < count; i++) {
      const t: V3 = [part.position.x + step.x * i, part.position.y + step.y * i, part.position.z + step.z * i];
      copies.push(local.map((b) => transform(transform(b, rot, t), pivot)));
    }
  }
  const mirrors = part.mirror ?? [];
  const out = [...copies];
  const variants: [number, number][] = [];
  if (mirrors.includes("x")) variants.push([-1, 1]);
  if (mirrors.includes("z")) variants.push([1, -1]);
  if (mirrors.includes("x") && mirrors.includes("z")) variants.push([-1, -1]);
  for (const [sx, sz] of variants) {
    const mirror: M3 = [sx, 0, 0, 0, 1, 0, 0, 0, sz];
    for (const c of copies) out.push(c.map((b) => transform(b, mirror)));
  }
  return out;
}

const partBlobs = (part: Part): Blob[] => partCopyBlobs(part).flat();

/** Axis-aligned bounding box of the parts in item-local cm, or undefined for an empty list. */
export function partsBounds(parts: readonly Part[]): Box3D | undefined {
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (const b of partBlobs(part)) {
      for (let i = 0; i < 3; i++) {
        const e = b.r * Math.hypot(b.m[i * 3], b.m[i * 3 + 1], b.m[i * 3 + 2]);
        min[i] = Math.min(min[i], b.c[i] - e);
        max[i] = Math.max(max[i], b.c[i] + e);
      }
    }
  }
  if (!Number.isFinite(min[0])) return undefined;
  return { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } };
}

/** The floor area a solid takes up (convex, plan cm) and its height range. Used for collisions. */
export interface Footprint {
  poly: Vec2[];
  y0: number;
  y1: number;
}

/** Directions for sampling round outlines (every 22.5°): footprints of discs and spheres are 16-gons. */
const DIRS: Vec2[] = Array.from({ length: 16 }, (_, i) => [Math.cos((i * Math.PI) / 8), Math.sin((i * Math.PI) / 8)]);

function blobsFootprint(blobs: readonly Blob[]): Footprint {
  const pts: Vec2[] = [];
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const b of blobs) {
    const ey = b.r * Math.hypot(b.m[3], b.m[4], b.m[5]);
    y0 = Math.min(y0, b.c[1] - ey);
    y1 = Math.max(y1, b.c[1] + ey);
    if (b.r === 0) {
      pts.push([b.c[0], b.c[2]]);
      continue;
    }
    for (const [dx, dz] of DIRS) {
      // support point of { c + M·u : |u| <= r } in the horizontal direction D = (dx, 0, dz): c + r·M·Mᵀ·D / |Mᵀ·D|
      const t0 = b.m[0] * dx + b.m[6] * dz;
      const t1 = b.m[1] * dx + b.m[7] * dz;
      const t2 = b.m[2] * dx + b.m[8] * dz;
      const len = Math.hypot(t0, t1, t2);
      if (len < 1e-12) {
        pts.push([b.c[0], b.c[2]]);
        continue;
      }
      const sx = (b.m[0] * t0 + b.m[1] * t1 + b.m[2] * t2) / len;
      const sz = (b.m[6] * t0 + b.m[7] * t1 + b.m[8] * t2) / len;
      pts.push([b.c[0] + b.r * sx, b.c[2] + b.r * sz]);
    }
  }
  return { poly: convexHull(pts), y0, y1 };
}

/** One footprint per part copy (every leg, cushion and shelf separately), in item-local cm. */
export function partFootprints(parts: readonly Part[]): Footprint[] {
  return parts.flatMap((part) => partCopyBlobs(part).map(blobsFootprint));
}
