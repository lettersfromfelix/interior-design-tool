/**
 * npx tsx tools/models/sofa-roche-bobois-sense-240-left.ts — writes catalogue/sofa-roche-bobois-sense-240-left/model.glb
 * and item.json, built from its own geometry (no third-party assets): Roche Bobois's Sense, the large curved 3-seat
 * sofa, 240 cm, with its deep end on the LEFT as you face it (on the right of someone sitting on it).
 *
 * Sizes: Roche Bobois's technical sheet (technicals.roche-bobois.com/M125338841/TDSv_SENSE_2024.pdf), page 3, the
 * 3-seater "3SX" in the plan "ÉLÉMENT MESURE B", the wall along its back: 240 wide, 146 deep overall and 107 at the
 * shallow end, 75 high, seat height 38, black metal legs 6 cm high. (The plan "MESURE A" is the same sofa turned.)
 *
 * OUTLINE and RUNGS are traced from that plan, in the item's frame (x right as seen from the front, z towards the
 * front, the back against z = −73): the footprint, and the back as pairs of points across it, on its outer and inner
 * edges, from its left end round to its right end. The drawing is to scale for the 240 and the 107 but draws the deep
 * end 141.8 deep; the trace stretches the deep end alone to 146.
 *
 * Shape, after the sheet's elevation and Roche Bobois's photos: one padded base, a soft pebble on low legs whose top is
 * the seat, buttoned; on it, wrapping round from end to end, the back: a thick upholstered roll leaning back, with a
 * crease and a row of buttons along its inner face, and rounded pads as its ends.
 *
 * Built in cm in the catalogue frame (y up, the front faces +z) and exported in metres. The materials are "Upholstery"
 * and "Legs"; item.json maps them to its material slots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Part } from "../../src/core/schema/common";
import { convexHull } from "../../src/core/geometry/convex";
import { closedSpline, offsetOutline, r, signedArea, writeItem, type P2 } from "./parametric";

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
const gauss = (d: number, sigma: number) => Math.exp(-(d * d) / (2 * sigma * sigma));
const dist = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ---- sizes (cm) ----
const ID = "sofa-roche-bobois-sense-240-left";
const W = 240;
const D = 146;
const H = 75;
const SEAT_H = 38;
const LEG = { r: 2.5, h: 6 };

// ---- the trace (cm, item frame) ----
const OUTLINE: P2[] = [
  [-76, -72.9], [-87.3, -70.8], [-97.7, -66.1], [-106.8, -59.1], [-113.7, -50], [-118.2, -39.4], [-120, -28.1], [-119.3, -16.6],
  [-116.3, -5.6], [-111.7, 5], [-106.4, 15.1], [-100, 24.7], [-92.8, 33.6], [-84.8, 41.8], [-76.4, 49.7], [-67.5, 57], [-58, 63.5],
  [-47.9, 68.9], [-37.1, 72.7], [-25.7, 72.1], [-15.5, 67], [-7.1, 59.1], [0.4, 50.4], [8.7, 42.5], [18.4, 36.4], [28.9, 31.9],
  [40.1, 29.2], [51.5, 29.2], [62.9, 30.7], [74.1, 33.2], [85.6, 33.8], [96.7, 31.2], [106.4, 25], [113.7, 16.2], [117.9, 5.6],
  [119.9, -5.7], [119.8, -17.2], [117.6, -28.5], [113.3, -39.1], [107.2, -48.8], [99.3, -57.2], [90.1, -64], [79.7, -68.9],
  [68.7, -71.9], [57.2, -72.8], [45.8, -71.6], [34.7, -68.5], [23.7, -65.2], [12.7, -61.9], [1.7, -58.6], [-9.5, -56.5],
  [-20.6, -59.1], [-31.6, -62.7], [-42.5, -66.3], [-53.4, -69.9], [-64.5, -72.6],
];
/** Across the back: [outer x, outer z, inner x, inner z]; the first and the last are its slanted end faces. */
const RUNGS: [number, number, number, number][] = [
  [-104.3, 18.2, -82, 27.6], [-109.1, 10.4, -75.3, 20], [-113, 2.1, -76.5, 4.7], [-116.5, -6.3, -83.4, -9.5],
  [-119.1, -15.1, -87.4, -19.3], [-120, -24.2, -88.3, -25.1], [-119.5, -33.3, -88.1, -28.7], [-117.4, -42.2, -87.4, -31.7],
  [-113.5, -50.5, -86.2, -34.2], [-108, -57.9, -84.6, -36.4], [-101.2, -63.9, -82.6, -38.2], [-93.3, -68.5, -80, -39.7],
  [-84.7, -71.6, -76.5, -40.8], [-75.6, -73, -73, -41.3], [-66.5, -73, -69.3, -41.1], [-57.5, -71.1, -64.5, -40.1],
  [-48.7, -68.4, -58.1, -38.1], [-40.1, -65.5, -50, -35.3], [-31.4, -62.6, -41.2, -32.4], [-22.6, -59.8, -31.7, -29.3],
  [-13.9, -57, -18.9, -25.6], [-4.8, -56.7, -0.8, -25.1], [4, -59.2, 12.4, -28.6], [12.7, -61.9, 22, -31.5],
  [21.5, -64.5, 30.7, -34.1], [30.3, -67.2, 39.2, -36.7], [39.1, -69.8, 46.8, -39], [48, -72, 52.6, -40.6],
  [57.1, -73, 57.4, -41], [66.2, -72.3, 62.4, -40.8], [75.2, -70.5, 66.7, -39.9], [83.8, -67.3, 70.8, -38.3],
  [91.8, -62.9, 74.7, -36.2], [99.1, -57.4, 78.2, -33.6], [105.5, -50.9, 81.3, -30.4], [110.9, -43.5, 83.9, -26.8],
  [115.1, -35.4, 86.3, -21.9], [118.1, -26.7, 88.7, -10.3], [119.9, -17.7, 94.3, 4.7], [120, -8.6, 102.6, 10.4],
  [119, 0.5, 105.1, 10.1],
];

// ---- curves ----
/** An open centripetal Catmull–Rom spline through all of `pts`, `per` points per span, both ends included. */
function openSpline(pts: P2[], per: number): P2[] {
  const n = pts.length;
  const ext: P2[] = [
    [2 * pts[0][0] - pts[1][0], 2 * pts[0][1] - pts[1][1]],
    ...pts,
    [2 * pts[n - 1][0] - pts[n - 2][0], 2 * pts[n - 1][1] - pts[n - 2][1]],
  ];
  const knot = (a: P2, b: P2) => Math.sqrt(dist(a, b)) || 1e-6;
  const mix = (a: P2, b: P2, ta: number, tb: number, t: number): P2 => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
  const out: P2[] = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const [p0, p1, p2, p3] = [ext[i - 1], ext[i], ext[i + 1], ext[i + 2]];
    const t1 = knot(p0, p1);
    const t2 = t1 + knot(p1, p2);
    const t3 = t2 + knot(p2, p3);
    for (let k = 0; k < per; k++) {
      const t = t1 + ((t2 - t1) * k) / per;
      const a1 = mix(p0, p1, 0, t1, t);
      const a2 = mix(p1, p2, t1, t2, t);
      const a3 = mix(p2, p3, t2, t3, t);
      out.push(mix(mix(a1, a2, 0, t2, t), mix(a2, a3, t1, t3, t), t1, t2, t));
    }
  }
  out.push(pts[n - 1]);
  return out;
}

const inside = (p: P2, poly: P2[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
/** The distance from p to an open polyline. */
const distToLine = (p: P2, line: P2[]) => {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    const [a, b] = [line[i - 1], line[i]];
    const [ex, ez] = [b[0] - a[0], b[1] - a[1]];
    const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ez) / (ex * ex + ez * ez || 1)));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ez));
  }
  return best;
};
const assertStar = (name: string, ring: P2[], c: P2) => {
  const sign = Math.sign(signedArea(ring));
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    if (Math.sign((a[0] - c[0]) * (b[1] - c[1]) - (a[1] - c[1]) * (b[0] - c[0])) !== sign) {
      throw new Error(`${name} is not star-shaped around its middle, at ${a.map((v) => v.toFixed(1)).join(", ")}`);
    }
  });
};

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
  dent: (x: number, z: number) => number; // pushes the top down (buttons)
}
const EDGE_STEPS = 8;

/**
 * A soft slab: the outline at its widest, rounded over at the bottom and the top with elliptical edges, its faces
 * filled towards their middles; the top domed and dented. The outline must curve no tighter than the inward radii.
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
  const ringAt = (dIn: number, y: number): Vec[] => outline.map((p, i) => [p[0] + normals[i][0] * dIn, y, p[1] + normals[i][1] * dIn]);
  const [bx, by] = pr.bottom;
  const [tx, ty] = pr.top;
  const side = pr.y1 - ty - (pr.y0 + by);
  if (side < 0) throw new Error("the edge radii are taller than the slab");
  const edge: Vec[][] = [];
  for (let k = 0; k <= EDGE_STEPS; k++) {
    const th = (k / EDGE_STEPS) * (Math.PI / 2);
    edge.push(ringAt(bx * (1 - Math.sin(th)), pr.y0 + by * (1 - Math.cos(th))));
  }
  for (let k = side > 0.5 ? 0 : 1; k <= EDGE_STEPS; k++) {
    const th = (k / EDGE_STEPS) * (Math.PI / 2);
    edge.push(ringAt(tx * (1 - Math.cos(th)), pr.y1 - ty + ty * Math.sin(th)));
  }
  const plan = (ring: Vec[]) => ring.map((p) => [p[0], p[2]] as P2);
  const middle = (ring: Vec[]): P2 => [ring.reduce((s, p) => s + p[0], 0) / n, ring.reduce((s, p) => s + p[2], 0) / n];
  const [low, high] = [edge[0], edge[edge.length - 1]];
  const [cb, ct] = [middle(low), middle(high)];
  assertStar("the base's bottom", plan(low), cb);
  assertStar("the base's top", plan(high), ct);
  const shrink = (ring: Vec[], c: P2, s: number, y: (x: number, z: number) => number): Vec[] =>
    ring.map((p) => {
      const [x, z] = [c[0] + s * (p[0] - c[0]), c[1] + s * (p[2] - c[1])];
      return [x, y(x, z), z];
    });
  const topY = (s: number) => (x: number, z: number) => pr.y1 + pr.dome * smoothstep(0, 1, 1 - s) - pr.dent(x, z);
  const bottom = Array.from({ length: bottomSteps - 1 }, (_, j) => shrink(low, cb, (j + 1) / bottomSteps, () => pr.y0));
  const top = Array.from({ length: topSteps - 1 }, (_, j) => {
    const s = (topSteps - 1 - j) / topSteps;
    return shrink(high, ct, s, topY(s));
  });
  return closedTube([...bottom, ...edge, ...top], [cb[0], pr.y0, cb[1]], [ct[0], topY(0)(ct[0], ct[1]), ct[1]]);
}

// ---- the footprint: a smooth outline through the traced points, exactly W × D ----
const footprint: P2[] = (() => {
  const raw = closedSpline(OUTLINE, 4);
  const xs = raw.map((p) => p[0]);
  const zs = raw.map((p) => p[1]);
  const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
  return raw.map(([x, z]) => [-W / 2 + ((x - x0) * W) / (x1 - x0), -D / 2 + ((z - z0) * D) / (z1 - z0)] as P2);
})();

// ---- the back: the band from end to end, densely sampled; its edges ----
const PER = 24;
const outer = openSpline(
  RUNGS.map(([x, z]) => [x, z] as P2),
  PER,
).map(([x, z]) => [Math.min(W / 2, Math.max(-W / 2, x)), Math.max(-D / 2, z)] as P2);
const inner = openSpline(
  RUNGS.map(([, , x, z]) => [x, z] as P2),
  PER,
);
const K = outer.length;
const centre = (k: number): P2 => [(outer[k][0] + inner[k][0]) / 2, (outer[k][1] + inner[k][1]) / 2];
const along = [0]; // along the centre line
const alongInner = [0]; // along the inner edge, the foot of the back
for (let k = 1; k < K; k++) {
  along.push(along[k - 1] + dist(centre(k), centre(k - 1)));
  alongInner.push(alongInner[k - 1] + dist(inner[k], inner[k - 1]));
}

/** The back's section across the band, for a band 32 wide: cm from its inner edge, height. */
const SECTION: P2[] = [
  [1, 34.5], // hidden in the seat
  [0, 40],
  [0.2, 47],
  [1.3, 55],
  [2.9, 62],
  [5.1, 67.5],
  [8.3, 71.5], // the shoulder: the plan's inner seam
  [12.8, 74.3],
  [16.6, 75],
  [22.1, 73.3], // the plan's outer seam
  [26.9, 69.5],
  [30.4, 62],
  [32, 53], // the widest, over the base's outline
  [31, 43],
  [28.8, 35],
  [25.6, 30], // into the base
  [19.2, 28],
  [11.2, 28.5],
  [3.8, 31],
];
const SECTION_POINTS = 64;
/** The section resampled: denser on the inner face, around the crease; u from 0 (inner edge) to 1 (outer edge). */
const section: P2[] = (() => {
  const dense = closedSpline(SECTION, 40);
  const weight = ([u, v]: P2) => (u < 8 && v > 45 && v < 67 ? 3 : 1);
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const [a, b] = [dense[i - 1], dense[i % dense.length]];
    cum.push(cum[i - 1] + (dist(a, b) * (weight(a) + weight(b))) / 2);
  }
  const out: P2[] = [];
  let j = 0;
  for (let m = 0; m < SECTION_POINTS; m++) {
    const t = (m / SECTION_POINTS) * cum[dense.length];
    while (cum[j + 1] < t) j++;
    const [a, b] = [dense[j], dense[(j + 1) % dense.length]];
    const f = (t - cum[j]) / (cum[j + 1] - cum[j] || 1);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  const us = out.map((p) => p[0]);
  const [u0, u1, v1] = [Math.min(...us), Math.max(...us), Math.max(...out.map((p) => p[1]))];
  return out.map(([u, v]) => [(u - u0) / (u1 - u0), v + H - v1] as P2);
})();
const innerFace = section.map(([u, v]) => u < 0.25 && v > 41 && v < 71);

// the band stops short of the plan's end faces by the length of its rounded end pads
const PAD = { length: 10, trim: 9, steps: 9, p: 2.6, middle: 54 };
const k0 = along.findIndex((l) => l >= PAD.trim);
const k1 = along.findLastIndex((l) => along[K - 1] - l >= PAD.trim);
const RING = 1.9; // the most either edge moves between rings
const picks = [k0];
{
  let [o, i] = [0, 0];
  for (let k = k0 + 1; k < k1; k++) {
    o += dist(outer[k], outer[k - 1]);
    i += dist(inner[k], inner[k - 1]);
    if (Math.max(o, i) >= RING) {
      picks.push(k);
      [o, i] = [0, 0];
    }
  }
  picks.push(k1);
}

// the crease along the inner face and its buttons, fading out towards the pads
const CREASE = { v: 56, depth: 1.1, sigma: 1.4 };
const BACK_BUTTON = { depth: 1.7, sigma: 2.3, every: 18 };
const [s0, s1] = [alongInner[k0], alongInner[k1]];
const backButtons = (() => {
  const n = Math.round((s1 - s0 - 24) / BACK_BUTTON.every);
  return Array.from({ length: n + 1 }, (_, i) => s0 + 12 + ((s1 - s0 - 24) * i) / n);
})();
const backDent = (s: number, v: number) => {
  const fade = smoothstep(s0, s0 + 6, s) * (1 - smoothstep(s1 - 6, s1, s));
  let d = CREASE.depth * gauss(v - CREASE.v, CREASE.sigma);
  for (const b of backButtons) d += BACK_BUTTON.depth * gauss(s - b, BACK_BUTTON.sigma) * gauss(v - CREASE.v, BACK_BUTTON.sigma + 0.5);
  return d * fade;
};
const ringAt = (k: number): Vec[] => {
  const [I, O] = [inner[k], outer[k]];
  const w = dist(I, O);
  const e: P2 = [(O[0] - I[0]) / w, (O[1] - I[1]) / w];
  return section.map(([u, v], j) => {
    const d = u * w + (innerFace[j] ? backDent(alongInner[k], v) : 0);
    return [I[0] + d * e[0], v, I[1] + d * e[1]];
  });
};
/**
 * A rounded pad closing the band at ring k, bulging away from ring `toward`: rings shrinking to a pole. It bulges
 * between square to its last ring and straight on along the band; its outer side slides along the outline instead, so
 * that it stays over the base, as the plan draws it.
 */
const pad = (k: number, toward: number): { rings: Vec[][]; pole: Vec } => {
  const [I, O] = [inner[k], outer[k]];
  const w = dist(I, O);
  const unit = (a: P2, b: P2): P2 => [(b[0] - a[0]) / dist(a, b), (b[1] - a[1]) / dist(a, b)];
  const on = unit(centre(toward), centre(k));
  const slide = unit(outer[toward], outer[k]);
  let square: P2 = [-(O[1] - I[1]) / w, (O[0] - I[0]) / w];
  if (square[0] * on[0] + square[1] * on[1] < 0) square = [-square[0], -square[1]];
  const l = Math.hypot(square[0] + on[0], square[1] + on[1]);
  const dir: P2 = [(square[0] + on[0]) / l, (square[1] + on[1]) / l];
  /** Between two directions, as a direction. */
  const nlerp = (a: P2, b: P2, t: number): P2 => {
    const m: P2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    const ml = Math.hypot(m[0], m[1]);
    return [m[0] / ml, m[1] / ml];
  };
  const base = ringAt(k);
  const c2 = centre(k);
  const c: Vec = [c2[0], PAD.middle, c2[1]];
  const rings: Vec[][] = [];
  for (let i = 1; i < PAD.steps; i++) {
    const th = (i / PAD.steps) * (Math.PI / 2);
    const a = PAD.length * Math.sin(th) ** (2 / PAD.p);
    const sc = Math.cos(th) ** (2 / PAD.p);
    rings.push(
      base.map((p, j) => {
        // the outer side slides along the outline; towards the pole, every point heads for it
        const d = nlerp(nlerp(dir, slide, smoothstep(0.55, 1, section[j][0])), dir, 1 - sc);
        return [c[0] + sc * (p[0] - c[0]) + a * d[0], c[1] + sc * (p[1] - c[1]), c[2] + sc * (p[2] - c[2]) + a * d[1]];
      }),
    );
  }
  return { rings, pole: [c[0] + PAD.length * dir[0], c[1], c[2] + PAD.length * dir[1]] };
};
const leftPad = pad(picks[0], picks[3]);
const rightPad = pad(picks[picks.length - 1], picks[picks.length - 4]);
const backRings = [...leftPad.rings.slice().reverse(), ...picks.map(ringAt), ...rightPad.rings];
const back = closedTube(backRings, leftPad.pole, rightPad.pole);

// ---- the base: a pebble, its top the seat, buttoned in rows that follow the back ----
const BASE = { y0: LEG.h, y1: 37, bottom: [16, 18] as [number, number], top: [13, 12] as [number, number], dome: 2 };
const SEAT_BUTTON = { depth: 1.6, sigma: 3.4, rows: [14, 34, 54], every: 21 };
const foot = inner.slice(k0, k1 + 1);
const seatButtons: P2[] = (() => {
  const L = [0];
  for (let i = 1; i < foot.length; i++) L.push(L[i - 1] + dist(foot[i], foot[i - 1]));
  const clear = offsetOutline(footprint, -24);
  const out: P2[] = [];
  SEAT_BUTTON.rows.forEach((off, row) => {
    for (let s = 6 + (row % 2) * (SEAT_BUTTON.every / 2); s < L[L.length - 1] - 6; s += SEAT_BUTTON.every) {
      const i = Math.max(1, Math.min(foot.length - 2, L.findIndex((l) => l >= s)));
      const t: P2 = [foot[i + 1][0] - foot[i - 1][0], foot[i + 1][1] - foot[i - 1][1]];
      const l = Math.hypot(t[0], t[1]);
      const p: P2 = [foot[i][0] - (t[1] / l) * off, foot[i][1] + (t[0] / l) * off];
      if (!inside(p, clear) || distToLine(p, foot) < off - 2 || out.some((q) => dist(p, q) < 15)) continue;
      out.push(p);
    }
  });
  return out;
})();
const seatDent = (x: number, z: number) => seatButtons.reduce((d, [bx, bz]) => d + SEAT_BUTTON.depth * gauss(Math.hypot(x - bx, z - bz), SEAT_BUTTON.sigma), 0);
const base = slab(footprint, { ...BASE, dent: seatDent }, 22);

// ---- the legs, under the base's flat bottom ----
const LEGS: P2[] = [
  [-88, 2],
  [-82, -44],
  [-36, 48],
  [8, -36],
  [92, 2],
  [78, -45],
];
const flat = offsetOutline(footprint, -(BASE.bottom[0] + LEG.r));
for (const p of LEGS) if (!inside(p, flat)) throw new Error(`the leg at ${p.join(", ")} is not under the base's flat bottom`);
const legs = LEGS.map(([x, z]) => new CylinderGeometry(LEG.r, LEG.r, LEG.h + 0.3, 20).translate(x, (LEG.h + 0.3) / 2, z));

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
assertNoFolds("base", base);
assertNoFolds("back", back);
const merge = (gs: BufferGeometry[]) => {
  const indexed = gs.map((g) => {
    if (g.getAttribute("uv")) g.deleteAttribute("uv");
    return g.index ? g : mergeVertices(g, 1e-4);
  });
  const out = mergeGeometries(indexed);
  if (!out) throw new Error("could not merge");
  return out;
};
const upholstery = merge([base, back]);
const legGeometry = merge(legs);
const all: [string, BufferGeometry, MeshStandardMaterial][] = [
  ["upholstery", upholstery, new MeshStandardMaterial({ name: "Upholstery", color: "#66663f", roughness: 0.95 })],
  ["legs", legGeometry, new MeshStandardMaterial({ name: "Legs", color: "#1e1e1e", roughness: 0.5, metalness: 0.6 })],
];
const box = { min: [Infinity, Infinity, Infinity] as Vec, max: [-Infinity, -Infinity, -Infinity] as Vec };
for (const [, g] of all) {
  const p = g.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    for (let k = 0; k < 3; k++) {
      box.min[k] = Math.min(box.min[k], p.getComponent(i, k));
      box.max[k] = Math.max(box.max[k], p.getComponent(i, k));
    }
  }
}
const size: Vec = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]];
const off: Vec = [(box.min[0] + box.max[0]) / 2, box.min[1], (box.min[2] + box.max[2]) / 2];
if (Math.abs(size[0] - W) > 0.5 || Math.abs(size[2] - D) > 0.5 || Math.abs(size[1] - H) > 0.5 || Math.hypot(...off) > 0.5) {
  throw new Error(`box ${size.map((v) => v.toFixed(1)).join(" × ")} off by ${off.map((v) => v.toFixed(1)).join(", ")}, expected ${W} × ${H} × ${D} centred`);
}
const sofa = new Group();
sofa.name = ID;
for (const [name, g, material] of all) {
  g.translate(-off[0], -off[1], -off[2]);
  g.scale(0.01, 0.01, 0.01);
  const m = new Mesh(g, material);
  m.name = name;
  sofa.add(m);
}
const dir = resolve(import.meta.dirname, "..", "..", "catalogue", ID);
mkdirSync(dir, { recursive: true });
const glb = (await new GLTFExporter().parseAsync(sofa, { binary: true })) as ArrayBuffer;
writeFileSync(resolve(dir, "model.glb"), Buffer.from(glb));

// ---- the seat: the largest rectangles on its free top, 8 cm inside the outline and clear of the back ----
const backPlan: P2[] = [...outer, ...inner.slice().reverse()];
const seatArea = offsetOutline(footprint, -8);
const free = (p: P2) => inside(p, seatArea) && !inside(p, backPlan) && distToLine(p, inner) >= 2;
/** Per 1 cm column, the free stretch of the seat (front to back) that takes in z = `z`. */
const column = (x: number, z: number): [number, number] | undefined => {
  if (!free([x, z])) return undefined;
  let [lo, hi] = [z, z];
  while (free([x, lo - 0.5])) lo -= 0.5;
  while (free([x, hi + 0.5])) hi += 0.5;
  return [lo, hi];
};
const seatRect = (name: string, x0: number, x1: number, z: number) => {
  const cols = new Map<number, [number, number]>();
  for (let x = x0; x <= x1; x++) {
    const c = column(x, z);
    if (c) cols.set(x, c);
  }
  let best = { area: 0, a: 0, b: 0, lo: 0, hi: 0 };
  for (let a = x0; a <= x1; a++) {
    let [lo, hi] = [-Infinity, Infinity];
    for (let b = a; b <= x1; b++) {
      const c = cols.get(b);
      if (!c) break;
      [lo, hi] = [Math.max(lo, c[0]), Math.min(hi, c[1])];
      const area = (b - a) * (hi - lo);
      if (hi - lo >= 30 && area > best.area) best = { area, a, b, lo, hi };
    }
  }
  if (!best.area) throw new Error(`no free seat for ${name}`);
  const { a, b, lo, hi } = best;
  return { name, height: SEAT_H, width: r(b - a), depth: r(hi - lo), center: [r((a + b) / 2), r((lo + hi) / 2)] };
};
// the middle seat first: a drop in 3D goes on an item's first surface of the height it points at (as on the Bubble Curve)
const surfaces = [seatRect("seat, middle", -24, 26, 0), seatRect("seat, deep end", -100, -24, 10), seatRect("seat, right end", 26, 110, 0)];
/** The seat's actual height over a surface (rays straight down onto the base): lowest, median, highest. */
const seatHeights = (s: (typeof surfaces)[number]) => {
  const mesh = new Mesh(base);
  const ray = new Raycaster();
  const hs: number[] = [];
  for (let i = 0; i <= 8; i++) {
    for (let j = 0; j <= 8; j++) {
      const [x, z] = [s.center[0] + s.width * (i / 8 - 0.5), s.center[1] + s.depth * (j / 8 - 0.5)];
      ray.set(new Vector3(x, 200, z), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(mesh)[0];
      if (hit) hs.push(hit.point.y);
    }
  }
  hs.sort((a, b) => a - b);
  return [hs[0], hs[hs.length >> 1], hs[hs.length - 1]];
};

// ---- collision: the base in upright strips, the back in pieces along it (each the convex outline of its plan) ----
const fewer = (hull: P2[], most = 24) => {
  const step = Math.ceil(hull.length / most);
  return hull.filter((_, i) => i % step === 0).map(([x, z]) => [r(x), r(z)] as P2);
};
/** The part of a closed outline between x = lo and x = hi. */
const clipX = (poly: P2[], lo: number, hi: number): P2[] => {
  const cut = (pts: P2[], keep: (p: P2) => boolean, x: number) =>
    pts.flatMap((p, i) => {
      const q = pts[(i + 1) % pts.length];
      const out: P2[] = keep(p) ? [p] : [];
      if (keep(p) !== keep(q)) out.push([x, p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0])]);
      return out;
    });
  return cut(
    cut(poly, (p) => p[0] >= lo, lo),
    (p) => p[0] <= hi,
    hi,
  );
};
const baseTop = box3(base).max.y;
const STRIPS = 8;
const collisionParts: Part[] = Array.from({ length: STRIPS }, (_, i) => {
  const [lo, hi] = [-W / 2 + (W * i) / STRIPS, -W / 2 + (W * (i + 1)) / STRIPS];
  return {
    name: `base, ${i + 1} of ${STRIPS}`,
    shape: "extrusion",
    points: fewer(convexHull(clipX(footprint, lo, hi))),
    height: r(baseTop),
    position: { x: 0, y: 0, z: 0 },
    material: "upholstery",
  } as Part;
});
{
  // pieces of about 30 cm along the back's outer edge; the pads go with the end pieces
  const pieces: Vec[][][] = [[...leftPad.rings, ringAt(picks[0])]];
  let run = 0;
  for (let i = 1; i < picks.length; i++) {
    run += dist(outer[picks[i]], outer[picks[i - 1]]);
    const ring = ringAt(picks[i]);
    pieces[pieces.length - 1].push(ring);
    if (run >= 30 && i < picks.length - 4) {
      pieces.push([ring]);
      run = 0;
    }
  }
  pieces[pieces.length - 1].push(...rightPad.rings);
  pieces.forEach((rings, i) => {
    const pts = rings.flat();
    const ys = pts.map((p) => p[1]);
    const lowY = Math.min(...ys);
    collisionParts.push({
      name: `back, ${i + 1} of ${pieces.length}`,
      shape: "extrusion",
      points: fewer(convexHull(pts.map((p) => [p[0], p[2]] as P2))),
      height: r(Math.max(...ys) - lowY),
      position: { x: 0, y: r(lowY), z: 0 },
      material: "upholstery",
    } as Part);
  });
}
function box3(g: BufferGeometry) {
  g.computeBoundingBox();
  return g.boundingBox!;
}

const path = writeItem(
  {
    $schema: "../../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: ID,
    name: "Sofa, Roche Bobois Sense 240, deep end left",
    category: "seating",
    tags: ["living room", "roche bobois", "sense", "curved sofa", "3-seater", "organic", "puffy", "olive", "buttoned"],
    dimensions: { width: W, depth: D, height: H },
    placement: { type: "floor" },
    geometry: { type: "model", src: "model.glb", materialMap: { Upholstery: "upholstery", Legs: "legs" } },
    materialSlots: {
      upholstery: { label: "Upholstery", default: "fabric.wool-olive", allowed: ["fabric.*", "leather.*"] },
      legs: { label: "Legs", default: "metal.black-matte", allowed: ["metal.black-matte"] },
    },
    surfaces,
    collision: "parts",
    collisionParts,
    productUrl: "https://www.roche-bobois.com/en/sense-large-3-seat-sofa-curved---left-edge/5030.html",
    notes: `Roche Bobois Sense (Studio Roche Bobois), the large curved 3-seat sofa, 240 cm, with its deep end on the LEFT as you face it (x < 0; on the right of someone sitting on it). Sizes from Roche Bobois's technical sheet (technicals.roche-bobois.com/M125338841/TDSv_SENSE_2024.pdf, page 3, the 3-seater "3SX" in the plan "ÉLÉMENT MESURE B", the wall along its back): ${W} wide and ${D} deep overall, 107 deep at its shallow right-hand end (the product page's 107 cm), ${H} high, seat height ${SEAT_H}, black metal legs ${LEG.h} cm high. Plan for the full ${W} × ${D} cm footprint; the sheet's plan "MESURE A" is the same sofa turned. Roche Bobois's photos on the product page show the other hand, with the deep end on the right as you face it; the sheet has both, and the app can't mirror an item, so this item is the deep-end-left one only. model.glb is generated by \`npx tsx tools/models/${ID}.ts\` from its own geometry after the sheet's plan, traced (it draws the deep end 141.8 deep; the trace stretches the deep end alone to ${D}), the sheet's elevation and the photos: one buttoned, pebble-shaped base on six black legs, and a thick buttoned roll wrapping round it as the back, leaning back, with rounded pads as its ends. The seat is three surfaces (the middle, the deep end and the right end), so cushions and throws can go on it. The fabrics are planning colours, not Roche Bobois's (the default olive is close to its photos); fabric.espresso, fabric.dark-chocolate, fabric.dark-walnut and fabric.dark-umber are dark browns to try, alongside the chocolates, also planning colours rather than Roche Bobois swatches. No clearance zone: the legroom in front of the shallow seats lies inside the item's box, beside the deep end.`,
  },
  `${ID}/item.json`,
);

// ---- report ----
const cm = (v: number) => v.toFixed(1);
console.log(`wrote ${resolve(dir, "model.glb")} (${(glb.byteLength / 1024).toFixed(0)} KB) and ${path}`);
console.log(`box ${cm(size[0])} W × ${cm(size[2])} D × ${cm(size[1])} H cm; ${upholstery.getAttribute("position").count} vertices`);
console.log(`back: ${picks.length} rings + pads, ${backButtons.length} buttons; seat: ${seatButtons.length} buttons; base top ${cm(baseTop)}`);
for (const s of surfaces) console.log(`  surface ${s.name.padEnd(12)} ${s.width} × ${s.depth} at [${s.center.join(", ")}], seat ${seatHeights(s).map(cm).join(" / ")} cm (lowest / median / highest)`);
console.log(`  collision parts: ${collisionParts.length}`);
