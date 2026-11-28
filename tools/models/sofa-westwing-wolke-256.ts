/**
 * npx tsx tools/models/sofa-westwing-wolke-256.ts — writes catalogue/sofa-westwing-wolke-256/model.glb and item.json,
 * built from its own geometry (no third-party assets): Westwing Collection's Wolke, the modular bouclé sofa as a
 * 3-seater, 256 cm wide.
 *
 * Sizes: Westwing's product pages (westwing.ch, "Modulares Sofa Wolke (3-Sitzer) aus Bouclé", light beige,
 * DEQ24WES49002-205519; westwing.ee, the same sofa in light blue, 24WES40649): 256 wide, 118 deep, 65 high; the seat
 * 180 wide, 84 deep and 41 high; the armrests 43 wide and 50 high; plastic feet 2 cm high.
 *
 * It is two modules, mirror images of each other, joined in the middle (the two packages it comes in, 122 × 132 × 70
 * each, hold one module each). Each module, after Westwing's photos (front, three-quarters, side, behind):
 * - a seat: a broad, soft block reaching almost to the floor, its front edge rolled over; the two seats meet in a
 *   narrow groove;
 * - a back behind it: a thick, rounded block from the floor to the top, leaning gently back above the seat, with a
 *   round shoulder at its outer end;
 * - an armrest at the outer end: a low, pillowed block, rounded all over, as deep as the seat: it ends at the back's
 *   front face, so behind the armrests the backs alone reach the rear (they are wider than the seats, 97 each).
 * The blocks overlap a little where they meet, as the upholstery is pressed together there.
 *
 * Each block is a stack of rounded rectangles (the plan at that height), each side set in by its own profile (the
 * bottom tucked in, the top rolled over, the back leaning), its faces bulging a little between the corners; its top
 * domes up gently. Built in cm in the catalogue frame (x right as seen from the front, y up, the front faces +z) and
 * exported in metres. The materials are "Upholstery" and "Feet"; item.json maps them to its material slots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Part } from "../../src/core/schema/common";
import { convexHull } from "../../src/core/geometry/convex";
import { r, writeItem, type P2 } from "./parametric";

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

// ---- sizes (cm) ----
const ID = "sofa-westwing-wolke-256";
const W = 256;
const D = 118;
const H = 65;
const SEAT_H = 41;
const SEAT_DEPTH = 84; // from the front to the back's front face, at the seat
const FEET = { r: 2.5, h: 2 };
const BACK_FRONT = D / 2 - SEAT_DEPTH; // -25

/** A quarter-ellipse rounding of a side: no inset at height `from`, `depth` at height `to` (above or below `from`). */
const round = (y: number, from: number, to: number, depth: number) => {
  const t = (y - from) / (to - from);
  if (t <= 0) return 0;
  return depth * (1 - Math.sqrt(Math.max(0, 1 - Math.min(1, t) ** 2)));
};
/** A straight lean, `slope` cm in per cm up from `from`, eased in over `ease` cm either side of it. */
const lean = (y: number, from: number, slope: number, ease: number) => {
  if (y <= from - ease) return 0;
  if (y >= from + ease) return slope * (y - from);
  return (slope * (y - from + ease) ** 2) / (4 * ease);
};
/** A face's soft bulge from bottom to top: no inset at height `at`, easing to `depth` at `half` cm above or below it. */
const plump = (y: number, at: number, half: number, depth: number) =>
  (depth * (1 - Math.cos(Math.PI * Math.min(1, Math.abs(y - at) / half)))) / 2;

type Profile = (y: number) => number;
/**
 * One block: its plan at its widest, [x0, x1] × [z0, z1]; per side (towards -x, +x, -z, +z) how far it is set in at
 * each height, and how much its face bulges out between the corners (its widest is the plan); the plan's corner radii
 * (-x-z, +x-z, +x+z, -x+z); its bottom (on the feet), the height where its top face begins and how much that domes up.
 */
interface Block {
  name: string;
  plan: [number, number, number, number];
  inset: [Profile, Profile, Profile, Profile];
  bulge: [number, number, number, number];
  radii: [number, number, number, number];
  y0: number;
  wallTop: number;
  dome: number;
  /** Where its sides start to roll over at the top (rings are close together above it). */
  topFrom: number;
}
const ARC = 14; // points per corner of a ring
const STEP = 4; // cm between points along a straight side, at the widest

/** The same block on the other side of the middle (x mirrored). */
function mirrored(b: Block, name: string): Block {
  const [x0, x1, z0, z1] = b.plan;
  const [ixm, ixp, izm, izp] = b.inset;
  const [bxm, bxp, bzm, bzp] = b.bulge;
  const [c0, c1, c2, c3] = b.radii;
  return { ...b, name, plan: [-x1, -x0, z0, z1], inset: [ixp, ixm, izm, izp], bulge: [bxp, bxm, bzm, bzp], radii: [c1, c0, c3, c2] };
}

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

/** The ring heights of a block: close together at the bottom tuck and where the sides roll over at the top. */
function ringHeights(b: Block): number[] {
  const ys: number[] = [];
  const tuck = 8;
  for (let k = 0; k <= 6; k++) ys.push(b.y0 + tuck * (1 - Math.cos((k / 6) * (Math.PI / 2))));
  const mid = Math.max(1, Math.ceil((b.topFrom - (b.y0 + tuck)) / 4));
  for (let k = 1; k <= mid; k++) ys.push(b.y0 + tuck + ((b.topFrom - b.y0 - tuck) * k) / mid);
  const K = Math.max(14, Math.ceil(b.wallTop - b.topFrom));
  for (let k = 1; k <= K; k++) ys.push(b.topFrom + (b.wallTop - b.topFrom) * Math.sin((k / K) * (Math.PI / 2)));
  return ys;
}

/** A block as a closed soft body: its rings, a flat bottom on the feet and a top domed up from its last ring. */
function block(b: Block): BufferGeometry {
  const [x0, x1, z0, z1] = b.plan;
  // an even number of steps, so that the middle of each side, where it bulges most, is a point
  const nx = 2 * Math.max(2, Math.ceil((x1 - x0) / (2 * STEP)));
  const nz = 2 * Math.max(2, Math.ceil((z1 - z0) / (2 * STEP)));
  const swell = (u: number) => (4 * u * (1 - u)) ** 2; // 0 with no slope at the corners, 1 in the middle
  const ring = (y: number): Vec[] => {
    const ins = b.inset.map((f) => f(y));
    // the corners lie `bulge` further in than the middle of each side, where the side reaches its profile
    const [L, R, B, F] = [x0 + ins[0] + b.bulge[0], x1 - ins[1] - b.bulge[1], z0 + ins[2] + b.bulge[2], z1 - ins[3] - b.bulge[3]];
    const rr = [...b.radii];
    // two corners on a short side share at most 60 % of it, so that its points keep their spacing up to the top
    const fit = (i: number, j: number, len: number) => {
      if (rr[i] + rr[j] > len * 0.6) {
        const k = (len * 0.6) / (rr[i] + rr[j]);
        rr[i] *= k;
        rr[j] *= k;
      }
    };
    fit(0, 1, R - L);
    fit(3, 2, R - L);
    fit(0, 3, F - B);
    fit(1, 2, F - B);
    // the bulges shrink with their sides (in full at the widest, so that the plan is the outline there)
    const sx = Math.min(1, (R - L) / (x1 - x0 - b.bulge[0] - b.bulge[1]));
    const sz = Math.min(1, (F - B) / (z1 - z0 - b.bulge[2] - b.bulge[3]));
    const pts: Vec[] = [];
    const line = (xa: number, za: number, xb: number, zb: number, n: number, out: P2, bulge: number) => {
      for (let k = 0; k < n; k++) {
        const u = k / n;
        const s = bulge * swell(u);
        pts.push([xa + (xb - xa) * u + out[0] * s, y, za + (zb - za) * u + out[1] * s]);
      }
    };
    const arc = (cx: number, cz: number, rad: number, a0: number) => {
      for (let k = 0; k < ARC; k++) {
        const a = a0 + (k / ARC) * (Math.PI / 2);
        pts.push([cx + rad * Math.cos(a), y, cz + rad * Math.sin(a)]);
      }
    };
    line(L + rr[0], B, R - rr[1], B, nx, [0, -1], b.bulge[2] * sx);
    arc(R - rr[1], B + rr[1], rr[1], -Math.PI / 2);
    line(R, B + rr[1], R, F - rr[2], nz, [1, 0], b.bulge[1] * sz);
    arc(R - rr[2], F - rr[2], rr[2], 0);
    line(R - rr[2], F, L + rr[3], F, nx, [0, 1], b.bulge[3] * sx);
    arc(L + rr[3], F - rr[3], rr[3], Math.PI / 2);
    line(L, F - rr[3], L, B + rr[0], nz, [-1, 0], b.bulge[0] * sz);
    arc(L + rr[0], B + rr[0], rr[0], Math.PI);
    return pts;
  };
  const rings = ringHeights(b).map(ring);
  const extent = (rg: Vec[], k: 0 | 2) => [Math.min(...rg.map((p) => p[k])), Math.max(...rg.map((p) => p[k]))];
  const [low, high] = [rings[0], rings[rings.length - 1]];
  const middle = (rg: Vec[]): P2 => {
    const [ex, ez] = [extent(rg, 0), extent(rg, 2)];
    return [(ex[0] + ex[1]) / 2, (ez[0] + ez[1]) / 2];
  };
  const [cb, ct] = [middle(low), middle(high)];
  // the top domes up from its edge, smoothly both ways; it bends up at its foot, so a small top domes less (the bend's
  // radius stays 8 cm or more)
  const [ex, ez] = [extent(high, 0), extent(high, 2)];
  const [hx, hz] = [(ex[1] - ex[0]) / 2, (ez[1] - ez[0]) / 2];
  if (b.dome > Math.min(hx, hz) ** 2 / 64 + 1e-9) throw new Error(`${b.name}: its top (${(2 * hx).toFixed(1)} × ${(2 * hz).toFixed(1)}) is too small to dome up ${b.dome}`);
  const bump = (t: number) => (1 - Math.min(1, t * t)) ** 2;
  const topY = (x: number, z: number) => b.wallTop + b.dome * bump((x - ct[0]) / hx) * bump((z - ct[1]) / hz);
  const shrink = (edge: Vec[], c: P2, s: number, y: (x: number, z: number) => number): Vec[] =>
    edge.map((p) => {
      const [x, z] = [c[0] + s * (p[0] - c[0]), c[1] + s * (p[2] - c[1])];
      return [x, y(x, z), z];
    });
  const BOTTOM_STEPS = 3;
  const TOP_STEPS = 12;
  const bottom = Array.from({ length: BOTTOM_STEPS - 1 }, (_, j) => shrink(low, cb, (j + 1) / BOTTOM_STEPS, () => b.y0));
  const top = Array.from({ length: TOP_STEPS - 1 }, (_, j) => shrink(high, ct, (TOP_STEPS - 1 - j) / TOP_STEPS, topY));
  return closedTube([...bottom, ...rings, ...top], [cb[0], b.y0, cb[1]], [ct[0], b.wallTop + b.dome, ct[1]]);
}

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
const merge = (gs: BufferGeometry[]) => {
  const out = mergeGeometries(gs.map((g) => (g.index ? g : mergeVertices(g, 1e-4))));
  if (!out) throw new Error("could not merge");
  return out;
};
const box3 = (g: BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};
const points = (g: BufferGeometry): Vec[] => {
  const p = g.getAttribute("position");
  return Array.from({ length: p.count }, (_, i) => [p.getX(i), p.getY(i), p.getZ(i)] as Vec);
};

// ---- the left module (x < 0); the right one is its mirror image ----
const SEAM = 0.1; // each half reaches this far past the middle
const seat: Block = {
  name: "seat, left",
  plan: [-90, SEAM, BACK_FRONT - 2, D / 2],
  inset: [
    (y) => round(y, 5, 2, 1.5) + round(y, 36.7, 40.7, 4), // in the armrest
    (y) => round(y, 5, 2, 1.5) + round(y, 36.7, 40.7, 3.5), // the groove down the middle
    (y) => round(y, 5, 2, 1.5), // in the back
    (y) => round(y, 6, 2, 3.5) + round(y, 33, 40.7, 7) + plump(y, 21.5, 19, 1.2), // the front, rolled over at the top
  ],
  bulge: [0, 0, 0, 2.2],
  radii: [2, 2, 6, 6],
  y0: FEET.h,
  wallTop: 40.7,
  dome: 0.6,
  topFrom: 33,
};
const back: Block = {
  name: "back, left",
  plan: [-96, SEAM, -D / 2, BACK_FRONT],
  inset: [
    (y) => round(y, 5, 2, 2) + round(y, 38, 64.85, 18), // the shoulder at the outer end
    (y) => round(y, 5, 2, 1.5) + round(y, 56, 64.85, 8.5), // the notch in the middle
    (y) => round(y, 6, 2, 3) + round(y, 44, 64.85, 9.8) + plump(y, 26, 22, 1.2), // the rear, rolled over at the top
    (y) => lean(y, 41, 0.29, 2) + round(y, 52, 64.85, 8), // the front, leaning back above the seat
  ],
  bulge: [0, 0, 2, 0.6],
  radii: [12, 6, 6, 6],
  y0: FEET.h,
  wallTop: 64.85,
  dome: 0.15,
  topFrom: 38,
};
const arm: Block = {
  name: "armrest, left",
  plan: [-W / 2, -85, BACK_FRONT - 0.5, D / 2],
  inset: [
    (y) => round(y, 9, 2, 7) + round(y, 14, 49.2, 19), // the outer side, rounding over from low down
    (y) => round(y, 5, 2, 2) + round(y, 41, 49.2, 9), // the inner side, above the seat
    (y) => round(y, 6, 2, 3) + round(y, 36, 49.2, 10), // the rear end, in front of the back's outer end
    (y) => round(y, 8, 2, 6) + round(y, 30, 49.2, 14) + plump(y, 14, 17, 0.8), // the front
  ],
  bulge: [0.5, 0, 0, 0],
  radii: [10, 5, 9, 20],
  y0: FEET.h,
  wallTop: 49.2,
  dome: 0.8,
  topFrom: 14,
};
const BLOCKS = [seat, back, arm].flatMap((b) => [b, mirrored(b, b.name.replace("left", "right"))]);
/** The feet: [x, z] on the left; mirrored. */
const FEET_AT: P2[] = [
  [-12, 47],
  [-12, -50],
  [-78, -50],
  [-110, 45],
  [-110, -15],
];

// ---- build ----
const geometries = BLOCKS.map((b) => {
  const g = block(b);
  assertNoFolds(b.name, g);
  return g;
});
const upholstery = merge(geometries);
const feetAt = FEET_AT.flatMap(([x, z]) => [[x, z] as P2, [-x, z] as P2]);
const feet = merge(feetAt.map(([x, z]) => new CylinderGeometry(FEET.r, FEET.r, FEET.h + 0.3, 20).translate(x, (FEET.h + 0.3) / 2, z)));
for (const [x, z] of feetAt) {
  const under = BLOCKS.some((b) => {
    const [x0, x1, z0, z1] = b.plan;
    return x > x0 + 10 && x < x1 - 10 && z > z0 + 6 && z < z1 - 6;
  });
  if (!under) throw new Error(`the foot at ${x}, ${z} is not under a block's flat bottom`);
}

const all: [string, BufferGeometry, MeshStandardMaterial][] = [
  ["upholstery", upholstery, new MeshStandardMaterial({ name: "Upholstery", color: "#ede6da", roughness: 0.97 })],
  ["feet", feet, new MeshStandardMaterial({ name: "Feet", color: "#1a1a1a", roughness: 0.42 })],
];
const box = { min: [Infinity, Infinity, Infinity] as Vec, max: [-Infinity, -Infinity, -Infinity] as Vec };
for (const [, g] of all) {
  const bb = box3(g);
  for (let k = 0; k < 3; k++) {
    box.min[k] = Math.min(box.min[k], bb.min.getComponent(k));
    box.max[k] = Math.max(box.max[k], bb.max.getComponent(k));
  }
}
const size: Vec = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
const off: Vec = [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2];
const boxText = `box ${size.map((v) => v.toFixed(2)).join(" × ")} (W × H × D), off by ${off.map((v) => v.toFixed(2)).join(", ")}`;
if (Math.abs(size[0] - W) > 0.3 || Math.abs(size[2] - D) > 0.3 || Math.abs(size[1] - H) > 0.3 || Math.hypot(...off) > 0.3) {
  throw new Error(`${boxText}, expected ${W} × ${H} × ${D} centred`);
}

// ---- the seat as a surface: across both seats, between the armrests, from the backs to the front's roll ----
const seats = merge([geometries[0], geometries[1]]);
const seatMesh = new Mesh(seats);
const ray = new Raycaster();
const down = (x: number, z: number, mesh: Mesh) => {
  ray.set(new Vector3(x, 200, z), new Vector3(0, -1, 0));
  return ray.intersectObject(mesh)[0]?.point.y ?? NaN;
};
const [sx0, sx1, sz0, sz1] = [-84, 84, BACK_FRONT + 2, D / 2 - 8];
const heights: number[] = [];
for (let i = 0; i <= 24; i++) for (let j = 0; j <= 10; j++) heights.push(down(sx0 + ((sx1 - sx0) * i) / 24, sz0 + ((sz1 - sz0) * j) / 10, seatMesh));
heights.sort((a, b) => a - b);
const [median, crowns] = [heights[heights.length >> 1], heights[Math.floor(heights.length * 0.9)]];
if (SEAT_H < median - 0.5 || SEAT_H > crowns + 0.5) throw new Error(`the seat's top is ${median.toFixed(1)} (median) to ${crowns.toFixed(1)} (crowns), not about ${SEAT_H}`);
const surface = { name: "seat", height: SEAT_H, width: r(sx1 - sx0), depth: r(sz1 - sz0), center: [r((sx0 + sx1) / 2), r((sz0 + sz1) / 2)] as [number, number] };

// ---- the two sections, counted on the model: dips in the seats' top across, and in the backs' front at its middle ----
const dips = (raw: number[], deeper: number) => {
  // a ray that finds nothing went through a gap: the deepest dip there is
  const low = Math.min(...raw.filter((v) => !Number.isNaN(v))) - 10;
  const vs = raw.map((v) => (Number.isNaN(v) ? low : v));
  let count = 0;
  for (let i = 1; i < vs.length - 1; i++) {
    const win = vs.slice(Math.max(0, i - 12), i + 13);
    const around = vs.slice(Math.max(0, i - 30), i + 31);
    if (vs[i] === Math.min(...win) && vs[i - 1] !== vs[i] && Math.max(...around) - vs[i] > deeper) count++;
  }
  return count;
};
const across = Array.from({ length: 321 }, (_, i) => -80 + i * 0.5);
const seatSections = dips(
  across.map((x) => down(x, 15, seatMesh)),
  1,
) + 1;
const backMesh = new Mesh(merge([geometries[2], geometries[3]]));
const backFronts = across.map((x) => {
  ray.set(new Vector3(x, 50, 100), new Vector3(0, 0, -1));
  return ray.intersectObject(backMesh)[0]?.point.z ?? NaN;
});
const backSections = dips(backFronts, 1) + 1;
if (seatSections !== 2 || backSections !== 2) throw new Error(`${seatSections} seat and ${backSections} back sections, expected 2 and 2`);

// ---- collision: each block, the convex outline of its plan, from the floor to its top ----
const fewer = (hull: P2[], most = 24) => {
  const step = Math.ceil(hull.length / most);
  return hull.filter((_, i) => i % step === 0).map(([x, z]) => [r(x), r(z)] as P2);
};
const collisionParts: Part[] = BLOCKS.map(
  (b, i) =>
    ({
      name: b.name,
      shape: "extrusion",
      points: fewer(convexHull(points(geometries[i]).map((p) => [p[0], p[2]] as P2))),
      height: r(box3(geometries[i]).max.y),
      position: { x: 0, y: 0, z: 0 },
      material: "upholstery",
    }) as Part,
);

// ---- export, in metres ----
const sofa = new Group();
sofa.name = ID;
for (const [name, g, material] of all) {
  const mesh = new Mesh(g.clone().translate(-off[0], -off[1], -off[2]).scale(0.01, 0.01, 0.01), material);
  mesh.name = name;
  sofa.add(mesh);
}
const dir = resolve(import.meta.dirname, "..", "..", "catalogue", ID);
mkdirSync(dir, { recursive: true });
const glb = (await new GLTFExporter().parseAsync(sofa, { binary: true })) as ArrayBuffer;
writeFileSync(resolve(dir, "model.glb"), Buffer.from(glb));

const backB = box3(geometries[2]);
const path = writeItem(
  {
    $schema: "../../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: ID,
    name: "Sofa, Westwing Wolke 256, 3-seater",
    category: "seating",
    tags: ["living room", "westwing", "wolke", "modular", "3-seater", "boucle", "puffy", "organic", "cream", "low"],
    dimensions: { width: W, depth: D, height: H },
    placement: { type: "floor" },
    geometry: { type: "model", src: "model.glb", materialMap: { Upholstery: "upholstery", Feet: "feet" } },
    materialSlots: {
      upholstery: { label: "Upholstery", default: "fabric.boucle-cream", allowed: ["fabric.*"] },
      feet: { label: "Feet", default: "plastic.deep-black", allowed: ["plastic.deep-black"] },
    },
    surfaces: [surface],
    collision: "parts",
    collisionParts,
    clearance: { front: 45, note: "Legroom in front of the seat; a coffee table can stand 45 cm away" },
    productUrl: "https://www.westwing.ch/modulares-sofa-wolke-3-sitzer-aus-boucle-159800.html",
    notes: `Westwing Collection Wolke, the modular bouclé sofa as a 3-seater, ${W} cm. Sizes from Westwing's product pages (westwing.ch, "Modulares Sofa Wolke (3-Sitzer) aus Bouclé", light beige, DEQ24WES49002-205519; the same sofa in light blue on westwing.ee, 24WES40649): ${W} wide, ${D} deep, ${H} high; the seat 180 wide, ${SEAT_DEPTH} deep and ${SEAT_H} high; the armrests 43 wide and 50 high; plastic feet ${FEET.h} cm high, hidden underneath. Westwing calls it a 3-seater, though it is two modules, each a seat with its back and one armrest, joined in the middle; this item is the whole sofa. model.glb is generated by \`npx tsx tools/models/${ID}.ts\` from its own geometry after Westwing's photos: two broad, soft seat blocks reaching almost to the floor, with a narrow groove between them; two thick, rounded backs leaning gently back above the seats; and a low, pillowed armrest at each end. The armrests are as deep as the seats, so behind them the backs alone reach the rear: plan for the full ${W} × ${D} cm, though the rear ${r(BACK_FRONT + D / 2)} cm are only ${r(2 * -back.plan[0])} wide. Westwing makes Wolke in bouclé (light beige: 96 % polyester, 4 % acrylic; light blue: 100 % polyester), in teddy bouclé (taupe, fabric SIC Euphoria 6, 100 % polyester: westwing.ch, "Modulares Teddy-Bouclé-Sofa Wolke (3-Sitzer)", DEQ25WES85443-908012, the same sizes) and other fabrics. The fabrics here are planning colours, not Westwing's swatches: the default cream bouclé is close to its light beige, fabric.boucle-light-blue to its light blue, and fabric.teddy-boucle-taupe to its taupe teddy bouclé, a texture generated after Westwing's photos (its curly pile and mottling; the shade an approximation). The seat is a surface, so cushions and throws can go on it.`,
  },
  `${ID}/item.json`,
);

// ---- report ----
const cm = (v: number) => v.toFixed(1);
console.log(`wrote ${resolve(dir, "model.glb")} (${(glb.byteLength / 1024).toFixed(0)} KB) and ${path}`);
console.log(`${boxText}; ${upholstery.getAttribute("position").count} vertices`);
for (const [i, b] of BLOCKS.entries()) {
  const bb = box3(geometries[i]);
  console.log(`  ${b.name.padEnd(15)} x ${cm(bb.min.x)}…${cm(bb.max.x)}  y ${cm(bb.min.y)}…${cm(bb.max.y)}  z ${cm(bb.min.z)}…${cm(bb.max.z)}`);
}
console.log(`  sections: ${seatSections} seats, ${backSections} backs; the backs' top at ${cm(backB.max.y)}`);
console.log(`  surface ${surface.width} × ${surface.depth} at [${surface.center.join(", ")}], height ${surface.height}; seat ${heights[0].toFixed(1)} / ${median.toFixed(1)} / ${crowns.toFixed(1)} / ${heights[heights.length - 1].toFixed(1)} cm (lowest / median / crowns / highest)`);
console.log(`  feet at ${feetAt.map((p) => `[${p.join(", ")}]`).join(" ")}`);
console.log(`  collision parts: ${collisionParts.length}`);
