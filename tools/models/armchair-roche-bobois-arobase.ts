/**
 * npx tsx tools/models/armchair-roche-bobois-arobase.ts — writes catalogue/armchair-roche-bobois-arobase/model.glb and
 * item.json, built from its own geometry (no third-party assets): Roche Bobois's Arobase swivel armchair (AR01),
 * design Antoine Fritsch & Vivien Durisotti.
 *
 * Sizes: Roche Bobois's technical sheet (technicals.roche-bobois.com/M142366512/TSv_AROBASE_2024(3).pdf), page 6, AR01:
 * 89 wide, 86 deep, 71 high, seat height 40, seat depth 53. Its side, front and top drawings are traced for the shapes
 * below (cm, item frame: x right as seen from the front, y up, z towards the front).
 *
 * Shape, after those drawings and Roche Bobois's photos:
 * - a plump, round seat, a soft pebble 82 × 55 cm in plan, on an upholstered swivel plinth set in under it;
 * - a separate back: a thick oval pillow, wider at the top, curved round the seat in plan and leaning back, its foot
 *   behind the seat down at the plinth; no arms and no legs;
 * - a small chrome plate in the middle of the back, shown as a plain bar.
 *
 * Built in cm and exported in metres. The materials are "Upholstery" and "Plate"; item.json maps them to its material
 * slots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Part } from "../../src/core/schema/common";
import { convexHull } from "../../src/core/geometry/convex";
import { closedSpline, r, signedArea, writeItem, type P2 } from "./parametric";

// GLTFExporter reads its output through FileReader, which Node does not have
class FileReaderShim {
  result: ArrayBuffer | null = null;
  onloadend: (() => void) | null = null;
  readAsArrayBuffer(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onloadend?.();
    });
  }
}
(globalThis as unknown as { FileReader?: unknown }).FileReader ??= FileReaderShim;

type Vec = [number, number, number];
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const dist = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ---- sizes (cm) ----
const ID = "armchair-roche-bobois-arobase";
const W = 89;
const D = 86;
const H = 71;
const SEAT_H = 40;

// ---- surfaces from rings ----
/**
 * A closed surface from rings of points (all with the same number of points, in the same order) between two poles,
 * turned outwards.
 */
function closedTube(rings: Vec[][], a: Vec, b: Vec): BufferGeometry {
  const n = rings[0].length;
  const pos: number[] = [...a];
  for (const ring of rings) for (const p of ring) pos.push(...p);
  pos.push(...b);
  const R = rings.length;
  const v = (k: number, i: number) => 1 + k * n + ((i + n) % n);
  const last = 1 + R * n;
  const index: number[] = [];
  for (let i = 0; i < n; i++) index.push(0, v(0, i + 1), v(0, i));
  for (let k = 0; k < R - 1; k++) {
    for (let i = 0; i < n; i++) index.push(v(k, i), v(k, i + 1), v(k + 1, i + 1), v(k, i), v(k + 1, i + 1), v(k + 1, i));
  }
  for (let i = 0; i < n; i++) index.push(last, v(R - 1, i), v(R - 1, i + 1));
  // outwards: the volume it encloses must come out positive
  const P = (j: number): Vec => [pos[3 * j], pos[3 * j + 1], pos[3 * j + 2]];
  let volume = 0;
  for (let t = 0; t < index.length; t += 3) {
    const [p, q, s] = [P(index[t]), P(index[t + 1]), P(index[t + 2])];
    volume += p[0] * (q[1] * s[2] - q[2] * s[1]) + p[1] * (q[2] * s[0] - q[0] * s[2]) + p[2] * (q[0] * s[1] - q[1] * s[0]);
  }
  if (volume < 0) for (let t = 0; t < index.length; t += 3) [index[t + 1], index[t + 2]] = [index[t + 2], index[t + 1]];
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

interface Slab {
  y0: number;
  y1: number;
  bottom: [number, number]; // the lower edge's radii: inwards, upwards
  top: [number, number]; // the upper edge's radii: inwards, downwards
  dome: number; // the top rises by this much in the middle
  sag?: number; // the bottom drops by this much in the middle
  edge?: (p: P2, out: P2) => number; // scales the inward radii along the outline (1 = full rounding), from each point and its outward normal
}
const EDGE_STEPS = 8;

/**
 * A soft slab: the outline at its widest, rounded over at the bottom and the top with elliptical edges, its faces
 * filled towards their middles and the top domed. The outline must be star-shaped around its middle and curve no
 * tighter than the inward radii.
 */
function slab(outline: P2[], pr: Slab, topSteps: number, bottomSteps = 3): BufferGeometry {
  const n = outline.length;
  const inward = signedArea(outline) > 0 ? 1 : -1;
  const normals = outline.map((_, i) => {
    const a = outline[(i - 1 + n) % n];
    const b = outline[(i + 1) % n];
    const l = dist(a, b) || 1;
    return [(-(b[1] - a[1]) / l) * inward, ((b[0] - a[0]) / l) * inward] as P2;
  });
  const scale = outline.map((p, i) => pr.edge?.(p, [-normals[i][0], -normals[i][1]]) ?? 1);
  const ringAt = (dIn: number, y: number): Vec[] => outline.map((p, i) => [p[0] + normals[i][0] * dIn * scale[i], y, p[1] + normals[i][1] * dIn * scale[i]]);
  const [bx, by] = pr.bottom;
  const [tx, ty] = pr.top;
  const side = pr.y1 - ty - (pr.y0 + by);
  if (side < -1e-6) throw new Error("the edge radii are taller than the slab");
  const edge: Vec[][] = [];
  for (let k = 0; k <= EDGE_STEPS; k++) {
    const th = (k / EDGE_STEPS) * (Math.PI / 2);
    edge.push(ringAt(bx * (1 - Math.sin(th)), pr.y0 + by * (1 - Math.cos(th))));
  }
  for (let k = side > 0.5 ? 0 : 1; k <= EDGE_STEPS; k++) {
    const th = (k / EDGE_STEPS) * (Math.PI / 2);
    edge.push(ringAt(tx * (1 - Math.cos(th)), pr.y1 - ty + ty * Math.sin(th)));
  }
  const middle = (ring: Vec[]): P2 => [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[2], 0) / n];
  const [low, high] = [edge[0], edge[edge.length - 1]];
  const [cb, ct] = [middle(low), middle(high)];
  const shrink = (ring: Vec[], c: P2, s: number, y: number): Vec[] => ring.map((p) => [c[0] + s * (p[0] - c[0]), y, c[1] + s * (p[2] - c[1])]);
  const sag = pr.sag ?? 0;
  const bottom = Array.from({ length: bottomSteps - 1 }, (_, j) => {
    const s = (j + 1) / bottomSteps;
    return shrink(low, cb, s, pr.y0 - sag * smoothstep(0, 1, 1 - s));
  });
  const top = Array.from({ length: topSteps - 1 }, (_, j) => {
    const s = (topSteps - 1 - j) / topSteps;
    return shrink(high, ct, s, pr.y1 + pr.dome * smoothstep(0, 1, 1 - s));
  });
  return closedTube([...bottom, ...edge, ...top], [cb[0], pr.y0 - sag, cb[1]], [ct[0], pr.y1 + pr.dome, ct[1]]);
}

/** Turn a closed surface outwards again after moving its points (a mirroring step turns it inside out). */
function reorient(g: BufferGeometry): BufferGeometry {
  const p = g.getAttribute("position");
  const idx = g.index!.array;
  let volume = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    volume +=
      p.getX(a) * (p.getY(b) * p.getZ(c) - p.getZ(b) * p.getY(c)) +
      p.getY(a) * (p.getZ(b) * p.getX(c) - p.getX(b) * p.getZ(c)) +
      p.getZ(a) * (p.getX(b) * p.getY(c) - p.getY(b) * p.getX(c));
  }
  if (volume < 0) {
    const flipped = Array.from(idx);
    for (let t = 0; t < flipped.length; t += 3) [flipped[t + 1], flipped[t + 2]] = [flipped[t + 2], flipped[t + 1]];
    g.setIndex(flipped);
  }
  g.computeVertexNormals();
  return g;
}

/** A closed outline resampled into evenly spaced points, about `step` cm apart (no short closing segment). */
function resample(poly: P2[], step: number): P2[] {
  const cum = [0];
  for (let i = 0; i < poly.length; i++) cum.push(cum[i] + dist(poly[i], poly[(i + 1) % poly.length]));
  const total = cum[poly.length];
  const n = Math.max(3, Math.round(total / step));
  const out: P2[] = [];
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = (k * total) / n;
    while (cum[j + 1] < t) j++;
    const [a, b] = [poly[j], poly[(j + 1) % poly.length]];
    const f = (t - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

/** A superellipse in plan: `w` across, `d` deep, centred on `c`. */
const superellipse = (w: number, d: number, c: P2, e = 2.6, n = 96): P2[] =>
  Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    const [co, si] = [Math.cos(t), Math.sin(t)];
    return [c[0] + (w / 2) * Math.sign(co) * Math.abs(co) ** (2 / e), c[1] + (d / 2) * Math.sign(si) * Math.abs(si) ** (2 / e)] as P2;
  });

// ---- the seat: a pebble, traced from the top view (its widest), on the plinth ----
const SEAT_PLAN: P2[] = [
  [-40.9, 15.2], [-40.8, 8.7], [-39.1, 2.5], [-35.7, -3], [-30.7, -7.1], [-24.6, -9.4], [-18.9, -10.8], [-13.6, -11.6],
  [-8.8, -11.9], [-4.3, -12.1], [0, -12.1], [4.3, -12.1], [8.8, -11.9], [13.6, -11.6], [18.9, -10.8], [24.6, -9.4],
  [30.7, -7.1], [35.7, -3], [39.1, 2.5], [40.8, 8.7], [40.9, 15.2], [39.5, 21.4], [37.1, 27.2], [33.6, 32.3], [29.2, 36.4],
  [24.2, 39.4], [18.8, 41], [13.6, 41.8], [8.8, 42.2], [4.3, 42.5], [0, 42.5], [-4.3, 42.5], [-8.8, 42.2], [-13.6, 41.8],
  [-18.8, 41], [-24.2, 39.4], [-29.2, 36.4], [-33.6, 32.3], [-37.1, 27.2], [-39.5, 21.4],
];
const PLINTH = { top: 5.2, upper: { w: 67.4, d: 51.6 }, lower: { w: 61.4, d: 45.6, h: 1.2 }, cz: 6.8 };
// the side view puts the seat's front at the item's front: the traced plan, stretched front to back to meet it
const seatPlan = (() => {
  const zs = SEAT_PLAN.map((p) => p[1]);
  const [z0, z1] = [Math.min(...zs), Math.max(...zs)];
  return resample(closedSpline(SEAT_PLAN.map(([x, z]) => [x, z0 + ((z - z0) * (D / 2 - z0)) / (z1 - z0)] as P2), 6), 1.8);
})();
// widest 15.8 cm above its foot; the drawings' side and front views give the rounding of its edges, nearly square
// only where it faces the back and presses against it, rounding more gradually round its back corners
const SEAT = {
  y0: PLINTH.top,
  y1: SEAT_H - 0.4,
  bottom: [9.5, 15.8] as [number, number],
  top: [16, 18.6] as [number, number],
  dome: 0.4,
  edge: (_p: P2, out: P2) => 0.3 + 0.7 * (1 - smoothstep(0.3, 0.98, -out[1])),
};
const seat = slab(seatPlan, SEAT, 16);
const plinth = slab(superellipse(PLINTH.upper.w, PLINTH.upper.d, [0, PLINTH.cz]), { y0: PLINTH.lower.h - 0.2, y1: PLINTH.top + 0.3, bottom: [1.2, 1.2], top: [1.2, 1.4], dome: 0 }, 5);
const plinthFoot = slab(superellipse(PLINTH.lower.w, PLINTH.lower.d, [0, PLINTH.cz]), { y0: 0, y1: PLINTH.lower.h, bottom: [0.4, 0.4], top: [0.4, 0.4], dome: 0 }, 4);

// ---- the back: a thick oval pillow, curved round the seat in plan and leaning back ----
const BACK = {
  half: 7, // half its thickness
  rim: [6.5, 7] as [number, number], // its rounded rim: inwards, through
  puff: 1.2, // its faces bulge by this much in the middle
};
/** Its middle surface at x = 0, seen from the side: [height, z]. */
const SPINE: P2[] = [
  [4.5, -21.6],
  [9, -21.8],
  [15, -22.6],
  [21, -22.8],
  [27, -22.8],
  [33, -24],
  [39, -25.7],
  [45, -28.1],
  [51, -31],
  [57, -34],
  [63, -35.8],
  [71, -36.5],
];
/** In plan it curves round a vertical axis, nearer at the top: there its edge curls forward more than its wings do. */
const axisZ = (y: number) => 45 + 17 * (1 - smoothstep(48, 66, y));
/** Its outline as seen from the front, one side: [half-width, height], from its foot to its top. */
const BACK_SIDE: P2[] = [
  [0, 4.5],
  [18, 5.1],
  [28, 6.8],
  [33.5, 10],
  [37.3, 15.5],
  [40.3, 22],
  [42.5, 30],
  [43.6, 37],
  [43.6, 44],
  [42.6, 51],
  [39.8, 57.5],
  [35.8, 62.5],
  [30.6, 66.5],
  [21.5, 69.8],
  [0, 71],
];
const spineZ = (y: number) => {
  for (let i = 1; i < SPINE.length; i++) {
    if (y <= SPINE[i][0] || i === SPINE.length - 1) {
      // a smooth (Catmull–Rom) curve through the points
      const [p0, p1, p2, p3] = [SPINE[Math.max(0, i - 2)], SPINE[i - 1], SPINE[i], SPINE[Math.min(SPINE.length - 1, i + 1)]];
      const t = Math.min(1, Math.max(0, (y - p1[0]) / (p2[0] - p1[0])));
      const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0]);
      const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0]);
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
    }
  }
  return SPINE[SPINE.length - 1][1];
};
/** The back's curve in plan at height y: its middle surface's radius round the axis (lengths across it are kept). */
const bendRadius = (y: number) => axisZ(y) - spineZ(y);
/** The back's frame: across s, up the outline's height y, through it t (front +); curved in plan last. */
const backPoint = (s: number, y: number, t: number): Vec => {
  const slope = (spineZ(y + 0.25) - spineZ(y - 0.25)) / 0.5;
  const l = Math.hypot(1, slope);
  const [nz, ny] = [1 / l, -slope / l];
  const z = spineZ(y) + t * nz;
  const ax = axisZ(y);
  const th = s / bendRadius(y);
  const rr = ax - z;
  return [rr * Math.sin(th), y + t * ny, ax - rr * Math.cos(th)];
};
/** The outline flat, before it is curved: each half-width as seen from the front becomes the width round the curve. */
const backOutline: P2[] = (() => {
  const flat = BACK_SIDE.map(([w, y]) => [bendRadius(y) * Math.asin(Math.min(1, w / bendRadius(y))), y] as P2);
  return resample(closedSpline([...flat, ...flat.slice(1, -1).reverse().map(([s, y]) => [-s, y] as P2)], 6), 2.2);
})();
const BACK_MIDDLE = 37; // the plate's height, about the middle of the back's face
const back = (() => {
  // built flat in its own frame (x across, y through it, z up its outline), then curved into place
  const g = slab(backOutline, { y0: -BACK.half, y1: BACK.half, bottom: BACK.rim, top: BACK.rim, dome: BACK.puff, sag: BACK.puff }, 14, 12);
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...backPoint(p.getX(i), p.getZ(i), p.getY(i)));
  return reorient(g);
})();

// ---- the plate in the middle of the back, curved with it ----
const PLATE = { w: 14, h: 1.1, proud: 0.35, depth: 1 };
const plate = (() => {
  const g = new BoxGeometry(PLATE.w, PLATE.h, PLATE.depth, 14, 1, 1);
  const p = g.getAttribute("position");
  const surface = -BACK.half - 0.95 * BACK.puff; // the back's face, bulging there
  for (let i = 0; i < p.count; i++) {
    // the box's back face stands `proud` behind the back's surface
    const q = backPoint(p.getX(i), BACK_MIDDLE + p.getY(i), surface - PLATE.proud + PLATE.depth / 2 + p.getZ(i));
    p.setXYZ(i, ...q);
  }
  g.deleteAttribute("normal");
  g.deleteAttribute("uv");
  const out = mergeVertices(g, 1e-4);
  out.computeVertexNormals();
  return out;
})();

// ---- assemble, measure, export in metres ----
/** Every triangle must face the way its corners' normals do; one that doesn't is folded over (a dark streak). */
function assertNoFolds(name: string, g: BufferGeometry) {
  const p = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  const idx = g.index!.array;
  let folds = 0;
  const where: string[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    const u = [p.getX(b) - p.getX(a), p.getY(b) - p.getY(a), p.getZ(b) - p.getZ(a)];
    const w = [p.getX(c) - p.getX(a), p.getY(c) - p.getY(a), p.getZ(c) - p.getZ(a)];
    const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const vn = [a, b, c].reduce((s, v) => [s[0] + nrm.getX(v), s[1] + nrm.getY(v), s[2] + nrm.getZ(v)], [0, 0, 0]);
    if (f[0] * vn[0] + f[1] * vn[1] + f[2] * vn[2] < 0) {
      folds++;
      if (where.length < 8) where.push(`(${[p.getX(a), p.getY(a), p.getZ(a)].map((v) => v.toFixed(1)).join(", ")}) #${a}`);
    }
  }
  if (folds) throw new Error(`${name}: ${folds} folded triangles, e.g. at ${where.join(" ")}`);
}
const pieces: [string, BufferGeometry][] = [
  ["seat", seat],
  ["plinth", plinth],
  ["plinth foot", plinthFoot],
  ["back", back],
];
for (const [name, g] of pieces) assertNoFolds(name, g);
const merge = (gs: BufferGeometry[]) => {
  const indexed = gs.map((g) => {
    if (g.getAttribute("uv")) g.deleteAttribute("uv");
    return g.index ? g : mergeVertices(g, 1e-4);
  });
  const out = mergeGeometries(indexed);
  if (!out) throw new Error("could not merge");
  return out;
};
const upholstery = merge([seat, plinth, plinthFoot, back]);
const all: [string, BufferGeometry, MeshStandardMaterial][] = [
  ["upholstery", upholstery, new MeshStandardMaterial({ name: "Upholstery", color: "#ede6da", roughness: 0.97 })],
  ["plate", merge([plate]), new MeshStandardMaterial({ name: "Plate", color: "#dadde0", roughness: 0.15, metalness: 0.35 })],
];
const box3 = (g: BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};
const box = { min: [Infinity, Infinity, Infinity] as Vec, max: [-Infinity, -Infinity, -Infinity] as Vec };
for (const [, g] of all) {
  const b = box3(g);
  for (let k = 0; k < 3; k++) {
    box.min[k] = Math.min(box.min[k], b.min.getComponent(k));
    box.max[k] = Math.max(box.max[k], b.max.getComponent(k));
  }
}
const size: Vec = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
const off: Vec = [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2];
const report = () => `box ${size.map((v) => v.toFixed(1)).join(" × ")} (W × H × D), off by ${off.map((v) => v.toFixed(1)).join(", ")}`;
if (Math.abs(size[0] - W) > 0.5 || Math.abs(size[2] - D) > 0.5 || Math.abs(size[1] - H) > 0.5 || Math.hypot(...off) > 0.5) {
  throw new Error(`${report()}, expected ${W} × ${H} × ${D} centred`);
}
const chair = new Group();
chair.name = ID;
for (const [name, g, material] of all) {
  const m = new Mesh(g.clone().translate(-off[0], -off[1], -off[2]).scale(0.01, 0.01, 0.01), material);
  m.name = name;
  chair.add(m);
}
const dir = resolve(import.meta.dirname, "..", "..", "catalogue", ID);
mkdirSync(dir, { recursive: true });
const glb = (await new GLTFExporter().parseAsync(chair, { binary: true })) as ArrayBuffer;
writeFileSync(resolve(dir, "model.glb"), Buffer.from(glb));

// ---- the seat surface: the largest rectangle on its free top, clear of the back, half the rounding of its edges in
// from them (8 cm at its front and sides, about 1 at the back, where it is square against the back) ----
const inside = (p: P2, poly: P2[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const seatArea = (() => {
  const n = seatPlan.length;
  const inward = signedArea(seatPlan) > 0 ? 1 : -1;
  return seatPlan.map((p, i) => {
    const [a, b] = [seatPlan[(i - 1 + n) % n], seatPlan[(i + 1) % n]];
    const l = dist(a, b) || 1;
    const nIn: P2 = [(-(b[1] - a[1]) / l) * inward, ((b[0] - a[0]) / l) * inward];
    const d = (SEAT.top[0] / 2) * SEAT.edge(p, [-nIn[0], -nIn[1]]);
    return [p[0] + nIn[0] * d, p[1] + nIn[1] * d] as P2;
  });
})();
const backAbove: P2[] = [];
{
  const p = back.getAttribute("position");
  for (let i = 0; i < p.count; i++) if (p.getY(i) > SEAT_H - 2) backAbove.push([p.getX(i), p.getZ(i)]);
}
const clearOfBack = (x: number, z: number) => backAbove.every(([bx, bz]) => Math.abs(bx - x) > 2 || bz < z - 2);
const surface = (() => {
  let best = { area: 0, hw: 0, z0: 0, z1: 0 };
  for (let hw = 15; hw <= 40; hw += 0.5) {
    for (let z0 = -12; z0 <= 20; z0 += 0.5) {
      let z1 = z0;
      const ok = (z: number) => [-hw, -hw / 2, 0, hw / 2, hw].every((x) => inside([x, z], seatArea) && clearOfBack(x, z));
      if (!ok(z0)) continue;
      while (z1 < 45 && ok(z1 + 0.5)) z1 += 0.5;
      if (2 * hw * (z1 - z0) > best.area) best = { area: 2 * hw * (z1 - z0), hw, z0, z1 };
    }
  }
  return { name: "seat", height: SEAT_H, width: r(2 * best.hw), depth: r(best.z1 - best.z0), center: [0, r((best.z0 + best.z1) / 2)] };
})();
const seatHeights = (() => {
  const mesh = new Mesh(seat);
  const ray = new Raycaster();
  const hs: number[] = [];
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const [x, z] = [surface.width * (i / 8 - 0.5), surface.center[1] + surface.depth * (j / 8 - 0.5)];
      ray.set(new Vector3(x, 200, z), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      if (hit) hs.push(hit.point.y);
    }
  }
  hs.sort((a, b) => a - b);
  return [hs[0], hs[hs.length >> 1], hs[hs.length - 1]];
})();

// ---- collision: the seat on its plinth, and the back in three pieces (each the convex outline of its plan) ----
const fewer = (hull: P2[], most = 24) => {
  const step = Math.ceil(hull.length / most);
  return hull.filter((_, i) => i % step === 0).map(([x, z]) => [r(x), r(z)] as P2);
};
const collisionParts: Part[] = [
  { name: "seat and plinth", shape: "extrusion", points: fewer(convexHull(seatPlan)), height: r(box3(seat).max.y), position: { x: 0, y: 0, z: 0 }, material: "upholstery" } as Part,
];
{
  const p = back.getAttribute("position");
  const cuts = [-Infinity, -24, 24, Infinity];
  const names = ["back, left wing", "back, middle", "back, right wing"];
  for (let k = 0; k < 3; k++) {
    const plan: P2[] = [];
    let [lo, hi] = [Infinity, -Infinity];
    for (let i = 0; i < p.count; i++) {
      if (p.getX(i) < cuts[k] - 1 || p.getX(i) > cuts[k + 1] + 1) continue;
      plan.push([p.getX(i), p.getZ(i)]);
      [lo, hi] = [Math.min(lo, p.getY(i)), Math.max(hi, p.getY(i))];
    }
    collisionParts.push({ name: names[k], shape: "extrusion", points: fewer(convexHull(plan)), height: r(hi - lo), position: { x: 0, y: r(lo), z: 0 }, material: "upholstery" } as Part);
  }
}

const path = writeItem(
  {
    $schema: "../../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: ID,
    name: "Armchair, Roche Bobois Arobase",
    category: "seating",
    tags: ["living room", "roche bobois", "arobase", "swivel", "lounge chair", "organic", "puffy", "boucle", "cream"],
    dimensions: { width: W, depth: D, height: H },
    placement: { type: "floor" },
    geometry: { type: "model", src: "model.glb", materialMap: { Upholstery: "upholstery", Plate: "plate" } },
    materialSlots: {
      upholstery: { label: "Upholstery", default: "fabric.boucle-cream", allowed: ["fabric.*", "leather.*"] },
      plate: { label: "Plate on the back", default: "metal.chrome", allowed: ["metal.chrome"] },
    },
    surfaces: [surface],
    collision: "parts",
    collisionParts,
    clearance: { front: 45, note: "Legroom in front of the seat; a coffee table can stand 45 cm away. It swivels: leave room to turn it." },
    productUrl: "https://www.roche-bobois.com/en/product/arobase-armchair-/5683.html",
    notes: `Roche Bobois Arobase swivel armchair (AR01), design Antoine Fritsch & Vivien Durisotti. Sizes from Roche Bobois's technical sheet (technicals.roche-bobois.com/M142366512/TSv_AROBASE_2024(3).pdf, page 6): ${W} wide, ${D} deep, ${H} high, seat height ${SEAT_H}, seat depth 53. Not the 142 cm Arobase 1.5-seat sofa (AR02) nor its loose rectangular cushion (AR03). It turns on an upholstered swivel base that returns to its position by itself; in the app it stands as placed. model.glb is generated by \`npx tsx tools/models/${ID}.ts\` from its own geometry after the sheet's side, front and top drawings and Roche Bobois's photos: a plump round seat on an upholstered plinth set in under it, and a separate back, a thick oval pillow curved round the seat and leaning back, its foot behind the seat; the chrome plate in the middle of the back is shown as a plain bar. Roche Bobois makes it in all its coverings except rigid fabrics and velvets; the fabrics and leathers here are planning colours, not Roche Bobois's, and the velvets among them aren't offered for this chair. The seat is a surface, so cushions and throws can go on it.`,
  },
  `${ID}/item.json`,
);

// ---- report ----
const cm = (v: number) => v.toFixed(1);
console.log(`wrote ${resolve(dir, "model.glb")} (${(glb.byteLength / 1024).toFixed(0)} KB) and ${path}`);
console.log(`${report()}; ${upholstery.getAttribute("position").count} vertices`);
for (const [name, g] of [...pieces, ["plate", plate] as [string, BufferGeometry]]) {
  const b = box3(g);
  console.log(`  ${name.padEnd(12)} x ${cm(b.min.x)}…${cm(b.max.x)}  y ${cm(b.min.y)}…${cm(b.max.y)}  z ${cm(b.min.z)}…${cm(b.max.z)}`);
}
console.log(`  surface ${surface.width} × ${surface.depth} at [${surface.center.join(", ")}], seat ${seatHeights.map(cm).join(" / ")} cm (lowest / median / highest)`);
console.log(`  collision parts: ${collisionParts.length}`);
