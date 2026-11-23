/**
 * npx tsx tools/models/roche-bobois-script.ts — writes catalogue/sofa-roche-bobois-script-194/ and
 * catalogue/sofa-roche-bobois-script-240-left/ (model.glb and item.json each), built from their own geometry (no
 * third-party assets): two modules of Roche Bobois's Script modular sofa (design Sacha Lakic), the 2.5-seat armless
 * sofa (module 34, 194 wide) and the large 3-seat 1-arm unit with its armrest on the left (module 38, 240 wide). One
 * builder makes both from their columns of segments, the armrest and the places of their back cushions.
 *
 * Sizes: Roche Bobois's technical sheet (technicals.roche-bobois.com/M191834697/TDSv_SCRIPT_2026.pdf). Page 2, the same
 * for every element: 121 deep with the backs closed (27 more with them opened), 85 high, seat height 43, feet 4 high;
 * the back cushions 92 wide, the lumbar cushions on them 79 wide and 61 high, the seat 56 deep in front of those; the
 * armrests 51 wide. Page 3: the modules' plans and fronts. Page 1: the backs are double-depth cushions on a rocking
 * mechanism, the lumbar cushions are fixed to them, the seat cushions are padded, and the feet are solid beech stained
 * wengé.
 *
 * Measured off the sheet's drawings (their vector paths, to scale): the base's segments run from front to back, 46 wide
 * and the outer ones 51 with their rounded side; a seam 40.4 from the back sets off the block under the back cushions;
 * module 38's armrest is a column of three square cushions (seams 40.4 and 80.6 from the back) at the seat's height.
 * Every outer face of the base bulges out most 26 cm up, tucks in 15 towards the feet below and rounds 17 in onto the
 * top above, its corners rounded 16 in plan; the seams between the segments sink into soft channels. The back cushions
 * lean back 30° (51 long, 27 thick), the lumbar rolls 34° (21 long, 13 thick). The feet are 6 cm square, about 25 in
 * from the ends.
 *
 * Shape, after the drawings and Roche Bobois's photos: a low base of plump, domed segments with soft channels between
 * them; on the block at the back, two thick rounded back cushions leaning back, each with a lumbar roll in front of it;
 * small square feet set well in. Shown with the backs closed, their normal position (121 deep).
 *
 * Built in cm in the catalogue frame (x right as seen from the front, y up, the front faces +z) and exported in metres.
 * The materials are "Upholstery" and "Feet"; each item.json maps them to its material slots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
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
const DEG = Math.PI / 180;

// ---- sizes (cm), the same for every module (page 2) ----
const D = 121;
const H = 85;
const SEAT_H = 43;
const SEAT_DEPTH = 56; // in front of the lumbar cushions
const FOOT = { size: 6, h: 4 };
const BLOCK = 40.4; // the seam behind the seat, from the back: the block under the back cushions
const ARMREST = { width: 51, seams: [40.4, 80.6] }; // three square cushions; their seams from the back
const CUSHION = { width: 92, length: 50.8, thickness: 26.9, lean: 30, at: [33.3, 58.9] as P2 }; // at: its middle, from the back and up
const LUMBAR = { width: 79, length: 20.8, thickness: 12.6, lean: 34, at: [56.7, 52] as P2 };

// ---- the base: soft cells, one per segment, block and armrest cushion ----
const WIDEST = 26; // the height where the outer faces bulge out most
const CROWN = 43.4; // the cells' tops at their middles, all as high (the sheet's front and side views)
const DOME = 2; // how much a cell's top domes up from its shoulders, at most
const OUTER_IN = 17; // an outer face's rounding onto the top: how far in
const CHANNEL = { in: 10, down: 7 }; // a seam's rounding onto the top: the channel between two cells
const FOOT_ROUND = 2.5; // a seam's rounding at the bottom
const OVERLAP = 0.3; // cells reach this far over a seam into their neighbour
const R_OUTER = 16; // the module's corners in plan
const R_SEAM = 9; // a cell's corners at a seam: the channels down the front and the back
/**
 * How far an outer face is set in from the plan at height y, for a cell whose top face begins at `top`: bulging out
 * most at WIDEST, rounding in above and below.
 */
const outerInset = (y: number, top: number) =>
  y <= WIDEST ? 15 * ((WIDEST - y) / (WIDEST - FOOT.h)) ** 1.6 : OUTER_IN * (1 - Math.sqrt(Math.max(0, 1 - ((y - WIDEST) / (top - WIDEST)) ** 2)));
/** How far a face on a seam is set in: straight, rounded in at the top (the channel) and a little at the bottom. */
const seamInset = (y: number, top: number) => {
  const start = top - CHANNEL.down;
  if (y > start) return CHANNEL.in * (1 - Math.sqrt(Math.max(0, 1 - ((y - start) / CHANNEL.down) ** 2)));
  const low = FOOT.h + FOOT_ROUND;
  if (y < low) return FOOT_ROUND * (1 - Math.sqrt(Math.max(0, 1 - ((low - y) / FOOT_ROUND) ** 2)));
  return 0;
};
/** A cell's rings' heights, up to its top face at `top`; closer together where the faces turn. */
const ringYs = (top: number): number[] => [
  ...[0, 0.04, 0.1, 0.18, 0.28, 0.4, 0.53, 0.66, 0.78, 0.89].map((f) => FOOT.h + (WIDEST - FOOT.h) * f),
  ...Array.from({ length: 13 }, (_, k) => WIDEST + (top - WIDEST) * Math.sin((k / 12) * (Math.PI / 2))),
];
const ARC = 6; // points per corner of a ring
const STEP = 5; // cm between points along a straight side

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
  return outwards(pos, index);
}
/** A mesh from positions and triangles, turned so that the volume it encloses comes out positive; with normals. */
function outwards(pos: number[], index: number[]): BufferGeometry {
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

/** One cell of the base, its plan [x0, x1] × [z0, z1]; for each side, whether it is an outer face (or on a seam). */
interface Cell {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
  left: boolean;
  right: boolean;
  back: boolean;
  front: boolean;
}
/** A soft cell: rounded rectangles stacked up from the feet, each side set in by its own profile, the top domed. */
function cell(c: Cell): BufferGeometry {
  const [xa, xb] = [c.x0 - (c.left ? 0 : OVERLAP), c.x1 + (c.right ? 0 : OVERLAP)];
  const [za, zb] = [c.z0 - (c.back ? 0 : OVERLAP), c.z1 + (c.front ? 0 : OVERLAP)];
  // the corners, round from the back left: rounder where two outer faces meet
  const radii = [c.back && c.left, c.back && c.right, c.front && c.right, c.front && c.left].map((o) => (o ? R_OUTER : R_SEAM));
  const nx = Math.max(3, Math.ceil((xb - xa) / STEP));
  const nz = Math.max(3, Math.ceil((zb - za) / STEP));
  // the top: it domes up in its middle from its shoulders, which end flat, so it bends up at its foot; on a small top a
  // high dome would make that a groove, so it is at most as high as keeps the bend's radius 8 cm or more (as on the
  // seat's segments); the shoulders end lower on a higher dome, all the crowns as high
  const insetAtTop = (outer: boolean) => (outer ? OUTER_IN : CHANNEL.in);
  const hx = (xb - xa - insetAtTop(c.left) - insetAtTop(c.right)) / 2;
  const hz = (zb - za - insetAtTop(c.back) - insetAtTop(c.front)) / 2;
  const dome = Math.min(DOME, Math.min(hx, hz) ** 2 / 64);
  const top = CROWN - dome;
  const ring = (y: number): Vec[] => {
    const set = (outer: boolean) => (outer ? outerInset(y, top) : seamInset(y, top));
    const [L, R, B, F] = [xa + set(c.left), xb - set(c.right), za + set(c.back), zb - set(c.front)];
    const rr = [...radii];
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
    const pts: Vec[] = [];
    const line = (x0: number, z0: number, x1: number, z1: number, n: number) => {
      for (let k = 0; k < n; k++) pts.push([x0 + ((x1 - x0) * k) / n, y, z0 + ((z1 - z0) * k) / n]);
    };
    const arc = (cx: number, cz: number, rad: number, a0: number) => {
      for (let k = 0; k < ARC; k++) {
        const a = a0 + (k / ARC) * (Math.PI / 2);
        pts.push([cx + rad * Math.cos(a), y, cz + rad * Math.sin(a)]);
      }
    };
    line(L + rr[0], B, R - rr[1], B, nx);
    arc(R - rr[1], B + rr[1], rr[1], -Math.PI / 2);
    line(R, B + rr[1], R, F - rr[2], nz);
    arc(R - rr[2], F - rr[2], rr[2], 0);
    line(R - rr[2], F, L + rr[3], F, nx);
    arc(L + rr[3], F - rr[3], rr[3], Math.PI / 2);
    line(L, F - rr[3], L, B + rr[0], nz);
    arc(L + rr[0], B + rr[0], rr[0], Math.PI);
    return pts;
  };
  const rings = ringYs(top).map(ring);
  const middle = (rg: Vec[]): P2 => {
    const xs = rg.map((p) => p[0]);
    const zs = rg.map((p) => p[2]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
  };
  const shrink = (edge: Vec[], c2: P2, s: number, y: (x: number, z: number) => number): Vec[] =>
    edge.map((p) => {
      const [x, z] = [c2[0] + s * (p[0] - c2[0]), c2[1] + s * (p[2] - c2[1])];
      return [x, y(x, z), z];
    });
  const [low, high] = [rings[0], rings[rings.length - 1]];
  const [cb, ct] = [middle(low), middle(high)];
  const BOTTOM_STEPS = 3;
  const TOP_STEPS = 11;
  // the dome, smooth both ways (one that followed the rings would crease towards the corners)
  const bump = (t: number) => (1 - Math.min(1, t * t)) ** 2;
  const topY = (x: number, z: number) => top + dome * bump((x - ct[0]) / hx) * bump((z - ct[1]) / hz);
  const bottom = Array.from({ length: BOTTOM_STEPS - 1 }, (_, j) => shrink(low, cb, (j + 1) / BOTTOM_STEPS, () => FOOT.h));
  const upper = Array.from({ length: TOP_STEPS - 1 }, (_, j) => shrink(high, ct, (TOP_STEPS - 1 - j) / TOP_STEPS, topY));
  return closedTube([...bottom, ...rings, ...upper], [cb[0], FOOT.h, cb[1]], [ct[0], CROWN, ct[1]]);
}

/**
 * A pillow: the superquadric (|x/a|^(2/e2) + |y/b|^(2/e2))^(e2/e1) + |z/c|^(2/e1) = 1, x across it, y along it, z
 * through it; e2 sets how square it looks from the front, e1 how round it is through its thickness. Meshed from a cube,
 * n × n on each face, each point pushed out along its ray from the middle onto the surface.
 */
function pillow(a: number, b: number, c: number, e1: number, e2: number, n: number): BufferGeometry {
  const F = (x: number, y: number, z: number) => (Math.abs(x / a) ** (2 / e2) + Math.abs(y / b) ** (2 / e2)) ** (e2 / e1) + Math.abs(z / c) ** (2 / e1);
  // each face: its normal and two directions across it, u × v = the normal
  const faces: [Vec, Vec, Vec][] = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    [[-1, 0, 0], [0, 0, 1], [0, 1, 0]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
    [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]],
    [[0, 0, -1], [0, 1, 0], [1, 0, 0]],
  ];
  const pos: number[] = [];
  const index: number[] = [];
  for (const [nrm, u, v] of faces) {
    const base = pos.length / 3;
    for (let i = 0; i <= n; i++) {
      for (let j = 0; j <= n; j++) {
        const s = Math.tan(((2 * i) / n - 1) * (Math.PI / 4));
        const t = Math.tan(((2 * j) / n - 1) * (Math.PI / 4));
        const q: Vec = [0, 1, 2].map((k) => nrm[k] + s * u[k] + t * v[k]) as Vec;
        const p: Vec = [q[0] * a, q[1] * b, q[2] * c];
        const k = F(...p) ** (-e1 / 2);
        pos.push(p[0] * k, p[1] * k, p[2] * k);
      }
    }
    const at = (i: number, j: number) => base + i * (n + 1) + j;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) index.push(at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i, j + 1));
    }
  }
  const raw = new BufferGeometry();
  raw.setAttribute("position", new Float32BufferAttribute(pos, 3));
  raw.setIndex(index);
  const welded = mergeVertices(raw, 1e-3);
  const wp = welded.getAttribute("position");
  return outwards(Array.from(wp.array as Float32Array), Array.from(welded.index!.array));
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

// ---- one module ----
interface Module {
  id: string;
  width: number;
  /** The seams between the base's columns, from the left side (as on the sheet's drawings). */
  seams: number[];
  /** The first column (on the left) is the armrest, three square cushions. */
  armrest: boolean;
  /** The back cushions' left sides, from the left side; each is CUSHION.width wide, its lumbar roll in its middle. */
  cushions: number[];
  /** The feet's middles: from the left side and from the back. */
  feet: P2[];
  name: string;
  tags: string[];
  notes: string;
}
interface Built {
  upholstery: BufferGeometry;
  feet: BufferGeometry;
  surfaces: { name: string; height: number; width: number; depth: number; center: [number, number] }[];
  collisionParts: Part[];
  report: string[];
}

function build(m: Module): Built {
  const W = m.width;
  const X = (fromLeft: number) => fromLeft - W / 2;
  const Z = (fromBack: number) => fromBack - D / 2;
  const edges = [0, ...m.seams, W];
  const cells: Cell[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const zs = m.armrest && i === 0 ? [0, ...ARMREST.seams, D] : [0, BLOCK, D];
    for (let j = 0; j < zs.length - 1; j++) {
      cells.push({
        x0: X(edges[i]),
        x1: X(edges[i + 1]),
        z0: Z(zs[j]),
        z1: Z(zs[j + 1]),
        left: i === 0,
        right: i === edges.length - 2,
        back: j === 0,
        front: j === zs.length - 2,
      });
    }
  }
  const base = merge(
    cells.map((c, i) => {
      const g = cell(c);
      assertNoFolds(`${m.id}: cell ${i + 1}`, g);
      return g;
    }),
  );

  // the back cushions and their lumbar rolls, leaned back into place
  const place = (g: BufferGeometry, lean: number, x: number, at: P2) => g.rotateX(-lean * DEG).translate(x, at[1], Z(at[0]));
  const cushions = m.cushions.map((left) => {
    const g = place(pillow(CUSHION.width / 2, CUSHION.length / 2, CUSHION.thickness / 2, 0.85, 0.55, 18), CUSHION.lean, X(left + CUSHION.width / 2), CUSHION.at);
    assertNoFolds(`${m.id}: back cushion`, g);
    return g;
  });
  // the cushions' tops at the sheet's height
  const lift = H - Math.max(...cushions.map((g) => box3(g).max.y));
  for (const g of cushions) g.translate(0, lift, 0);
  const lumbars = m.cushions.map((left) => {
    const g = place(pillow(LUMBAR.width / 2, LUMBAR.length / 2, LUMBAR.thickness / 2, 1, 0.33, 16), LUMBAR.lean, X(left + CUSHION.width / 2), LUMBAR.at);
    assertNoFolds(`${m.id}: lumbar roll`, g);
    return g;
  });
  const upholstery = merge([base, ...cushions, ...lumbars]);

  // the feet, under the cells' flat bottoms
  const feetAt = m.feet.map(([x, z]) => [X(x), Z(z)] as P2);
  const feet = merge(feetAt.map(([x, z]) => new BoxGeometry(FOOT.size, FOOT.h + 0.3, FOOT.size).translate(x, (FOOT.h + 0.3) / 2, z)));

  // ---- the surfaces: the seat in front of the lumbar rolls, and the armrest; each up to 11 cm from the outer faces,
  // where their tops have dropped about half a centimetre; at the sheet's seat height, between the channels and the
  // segments' crowns (the report gives the heights under them)
  const lumbarFront = Math.max(...lumbars.map((g) => box3(g).max.z));
  const baseMesh = new Mesh(base);
  const ray = new Raycaster();
  const heightsUnder = (x0: number, x1: number, z0: number, z1: number) => {
    const hs: number[] = [];
    for (let i = 0; i <= 16; i++) {
      for (let j = 0; j <= 8; j++) {
        ray.set(new Vector3(x0 + ((x1 - x0) * i) / 16, 200, z0 + ((z1 - z0) * j) / 8), new Vector3(0, -1, 0));
        const hit = ray.intersectObject(baseMesh)[0];
        if (hit) hs.push(hit.point.y);
      }
    }
    return hs.sort((a, b) => a - b);
  };
  const EDGE = 11;
  const rect = (name: string, x0: number, x1: number, z0: number, z1: number) => {
    const hs = heightsUnder(x0, x1, z0, z1);
    const [median, crowns] = [hs[hs.length >> 1], hs[Math.floor(hs.length * 0.9)]];
    if (SEAT_H < median - 0.5 || SEAT_H > crowns + 0.5) throw new Error(`${m.id}: the ${name}'s top is ${median.toFixed(1)} (median) to ${crowns.toFixed(1)} (crowns), not about ${SEAT_H}`);
    return {
      surface: { name, height: SEAT_H, width: r(x1 - x0), depth: r(z1 - z0), center: [r((x0 + x1) / 2), r((z0 + z1) / 2)] as [number, number] },
      heights: [hs[0], median, crowns, hs[hs.length - 1]],
    };
  };
  // the seat runs over the armrest's front too (as high, and free): a drop in 3D goes on an item's first surface of the
  // height it points at, so one on the armrest's front lands where it was aimed
  const rects = [rect("seat", Math.ceil(-W / 2 + EDGE), Math.floor(W / 2 - EDGE), Math.ceil(lumbarFront + 1.5), Math.floor(D / 2 - EDGE))];
  if (m.armrest) rects.push(rect("armrest", Math.ceil(-W / 2 + EDGE), Math.floor(X(m.seams[0]) - 1), Math.ceil(-D / 2 + EDGE), Math.floor(D / 2 - EDGE)));

  // ---- the segments, counted on the model: dips in the base's top across it (in front of the lumbar rolls) and, on the
  // armrest, along it
  const dips = (vs: number[], deeper: number) => {
    let count = 0;
    for (let i = 1; i < vs.length - 1; i++) {
      const win = vs.slice(Math.max(0, i - 12), i + 13);
      const around = vs.slice(Math.max(0, i - 30), i + 31);
      if (vs[i] === Math.min(...win) && Math.max(...around) - vs[i] > deeper) count++;
    }
    return count;
  };
  const topAt = (x: number, z: number) => {
    ray.set(new Vector3(x, 200, z), new Vector3(0, -1, 0));
    return ray.intersectObject(baseMesh)[0]?.point.y ?? NaN;
  };
  const across = Array.from({ length: Math.floor((W - 30) / 0.5) + 1 }, (_, i) => topAt(-W / 2 + 15 + i * 0.5, 38));
  const columns = dips(across, 2) + 1;
  if (columns !== edges.length - 1) throw new Error(`${m.id}: ${columns} columns on the model, expected ${edges.length - 1}`);
  let armCushions = 0;
  if (m.armrest) {
    const along = Array.from({ length: Math.floor((D - 30) / 0.5) + 1 }, (_, i) => topAt(X(m.seams[0] / 2), -D / 2 + 15 + i * 0.5));
    armCushions = dips(along, 2) + 1;
    if (armCushions !== 3) throw new Error(`${m.id}: ${armCushions} armrest cushions on the model, expected 3`);
  }

  // ---- collision: the base's widest outline up to its top, each back cushion and lumbar roll (the convex outline of
  // its plan) over its own heights
  const fewer = (hull: P2[], most = 24) => {
    const step = Math.ceil(hull.length / most);
    return hull.filter((_, i) => i % step === 0).map(([x, z]) => [r(x), r(z)] as P2);
  };
  const part = (name: string, g: BufferGeometry, fromFloor = false): Part => {
    const b = box3(g);
    const plan = points(g).map((p) => [p[0], p[2]] as P2);
    const y0 = fromFloor ? 0 : b.min.y;
    return { name, shape: "extrusion", points: fewer(convexHull(plan)), height: r(b.max.y - y0), position: { x: 0, y: r(y0), z: 0 }, material: "upholstery" } as Part;
  };
  const side = (i: number, n: number) => (n === 1 ? "" : i === 0 ? ", left" : ", right");
  const collisionParts: Part[] = [
    part("base", base, true), // with the feet under it
    ...cushions.map((g, i) => part(`back cushion${side(i, cushions.length)}`, g)),
    ...lumbars.map((g, i) => part(`lumbar roll${side(i, lumbars.length)}`, g)),
  ];

  const cm = (v: number) => v.toFixed(1);
  const fromBack = (z: number) => cm(z + D / 2);
  const bb = (g: BufferGeometry) => box3(g);
  const report = [
    `  base: ${cells.length} cells, top ${cm(bb(base).max.y)}; ${columns} columns across${m.armrest ? `, ${armCushions} armrest cushions` : ""}`,
    `  back cushions: y ${cm(bb(cushions[0]).min.y)}…${cm(bb(cushions[0]).max.y)}, ${fromBack(bb(cushions[0]).min.z)}…${fromBack(bb(cushions[0]).max.z)} from the back (sheet: 40…85, 15…53)`,
    `  lumbar rolls: y ${cm(bb(lumbars[0]).min.y)}…${cm(bb(lumbars[0]).max.y)}, ${fromBack(bb(lumbars[0]).min.z)}…${fromBack(bb(lumbars[0]).max.z)} from the back (sheet: 42.7…61, 48.6…65); seat depth in front of them ${cm(D / 2 - lumbarFront)} (sheet: ${SEAT_DEPTH})`,
    ...rects.map(
      ({ surface: s, heights: h }) =>
        `  surface ${s.name}: ${s.width} × ${s.depth} at [${s.center.join(", ")}], height ${s.height}; top ${h.map(cm).join(" / ")} cm (lowest / median / crowns / highest)`,
    ),
    `  feet at ${feetAt.map((p) => `[${p.map(r).join(", ")}]`).join(" ")}`,
  ];
  return { upholstery, feet, surfaces: rects.map((x) => x.surface), collisionParts, report };
}

// ---- the two modules ----
const SOURCE = `Sizes from Roche Bobois's technical sheet (technicals.roche-bobois.com/M191834697/TDSv_SCRIPT_2026.pdf, pages 2–3)`;
const COMMON = (segments: string) =>
  `Shown with the backs closed, their normal position: each back cushion sits on a rocking mechanism that opens it 27 cm further back (148 deep overall), and the planner shows the one position, so plan for the ${D} cm and leave room behind to open the backs. model.glb is generated by \`npx tsx tools/models/roche-bobois-script.ts\` from its own geometry after the sheet's drawings and Roche Bobois's photos: a low base of ${segments}, plump and domed with soft channels between them, the block behind the seat carrying the back cushions; two thick rounded back cushions leaning back, each with its lumbar roll; small square feet in wengé-stained beech, set well in. Roche Bobois makes Script only in its stretch fabrics (Bamboo, Chroma, Orsetto Flex, Passion, Pixel, Smile Flex, Techno 2D, 3D and 4D) and shows it in green Orsetto Flex; the fabrics here are planning colours, not Roche Bobois's, the default cream bouclé among them, as are the dark browns (fabric.espresso, fabric.dark-chocolate, fabric.dark-walnut, fabric.dark-umber).`;
const MODULES: Module[] = [
  {
    id: "sofa-roche-bobois-script-194",
    width: 194,
    seams: [51, 97, 143],
    armrest: false,
    cushions: [5, 97],
    feet: [
      [27, 28],
      [167, 28],
      [27, 93.1],
      [167, 93.1],
    ],
    name: "Sofa, Roche Bobois Script 194, 2.5-seater",
    tags: ["living room", "roche bobois", "script", "sacha lakic", "modular", "armless", "2.5-seater", "puffy", "boucle", "low"],
    notes: `Roche Bobois Script (design Sacha Lakic), module 34: "Banquette 2,5 places", the 2.5-seat armless sofa, 194 cm. ${SOURCE}: 194 wide, ${D} deep, ${H} high, seat height ${SEAT_H}, feet 4 high; two back cushions 92 wide, each with a 79 wide lumbar cushion fixed in front of it, the seat ${SEAT_DEPTH} deep in front of those. Armless, so modules stand side by side; this is the module on its own. ${COMMON("four segments running from front to back")} The seat is a surface, so cushions and throws can go on it.`,
  },
  {
    id: "sofa-roche-bobois-script-240-left",
    width: 240,
    seams: [51, 97, 143, 189],
    armrest: true,
    cushions: [51, 143],
    feet: [
      [25.4, 28],
      [213, 28],
      [25.4, 93.1],
      [213, 93.1],
    ],
    name: "Sofa, Roche Bobois Script 240, large 3-seater, armrest left",
    tags: ["living room", "roche bobois", "script", "sacha lakic", "modular", "3-seater", "armrest", "puffy", "boucle", "low"],
    notes: `Roche Bobois Script (design Sacha Lakic), module 38: "Grand bâtard 3 places gauche", the large 3-seat 1-arm unit with its armrest on the LEFT as you face it (x < 0; on the right of someone sitting on it), 240 cm. ${SOURCE}: 240 wide, ${D} deep, ${H} high, seat height ${SEAT_H}, feet 4 high; the armrest 51 wide: not a raised arm but three square cushions at the seat's height, an open end to sit or put things on; the two back cushions, 92 wide with their 79 wide lumbar cushions, stand over the four seat segments to its right, the seat ${SEAT_DEPTH} deep in front of them. Roche Bobois also makes it with the armrest on the right (module 37), which this item is not; the app can't mirror an item. ${COMMON("four segments running from front to back beside the armrest")} The seat and the armrest are surfaces, so cushions and throws can go on them.`,
  },
];

for (const m of MODULES) {
  const b = build(m);
  const all: [string, BufferGeometry, MeshStandardMaterial][] = [
    ["upholstery", b.upholstery, new MeshStandardMaterial({ name: "Upholstery", color: "#ede6da", roughness: 0.97 })],
    ["feet", b.feet, new MeshStandardMaterial({ name: "Feet", color: "#3a2c24", roughness: 0.6 })],
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
  const boxText = `box ${size.map((v) => v.toFixed(1)).join(" × ")} (W × H × D), off by ${off.map((v) => v.toFixed(1)).join(", ")}`;
  if (Math.abs(size[0] - m.width) > 0.5 || Math.abs(size[2] - D) > 0.5 || Math.abs(size[1] - H) > 0.5 || Math.hypot(...off) > 0.5) {
    throw new Error(`${m.id}: ${boxText}, expected ${m.width} × ${H} × ${D} centred`);
  }
  const group = new Group();
  group.name = m.id;
  for (const [name, g, material] of all) {
    const mesh = new Mesh(g.clone().translate(-off[0], -off[1], -off[2]).scale(0.01, 0.01, 0.01), material);
    mesh.name = name;
    group.add(mesh);
  }
  const dir = resolve(import.meta.dirname, "..", "..", "catalogue", m.id);
  mkdirSync(dir, { recursive: true });
  const glb = (await new GLTFExporter().parseAsync(group, { binary: true })) as ArrayBuffer;
  writeFileSync(resolve(dir, "model.glb"), Buffer.from(glb));
  const path = writeItem(
    {
      $schema: "../../schemas/catalogue-item.schema.json",
      schemaVersion: 1,
      id: m.id,
      name: m.name,
      category: "seating",
      tags: m.tags,
      dimensions: { width: m.width, depth: D, height: H },
      placement: { type: "floor" },
      geometry: { type: "model", src: "model.glb", materialMap: { Upholstery: "upholstery", Feet: "feet" } },
      materialSlots: {
        upholstery: { label: "Upholstery", default: "fabric.boucle-cream", allowed: ["fabric.*"] },
        feet: { label: "Feet", default: "wood.wenge", allowed: ["wood.wenge"] },
      },
      surfaces: b.surfaces,
      collision: "parts",
      collisionParts: b.collisionParts,
      clearance: { front: 45, note: "Legroom in front of the seat; a coffee table can stand 45 cm away" },
      productUrl: "https://www.roche-bobois.com/en-US/product/script-u-shaped-modular-sofa/A1245398270.html",
      notes: m.notes,
    },
    `${m.id}/item.json`,
  );
  console.log(`wrote ${resolve(dir, "model.glb")} (${(glb.byteLength / 1024).toFixed(0)} KB) and ${path}`);
  console.log(`${boxText}; ${b.upholstery.getAttribute("position").count} vertices`);
  for (const line of b.report) console.log(line);
}
