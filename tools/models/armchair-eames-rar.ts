/**
 * npx tsx tools/models/armchair-eames-rar.ts — writes catalogue/armchair-eames-rar/model.glb, built from its own
 * geometry (no third-party assets): the Vitra Eames Plastic Armchair RAR, the moulded one-piece armchair shell with a
 * seat pad, on the wire rocker base with two maple runners.
 *
 * The shell's shape started from the to-scale drawing of the Eames moulded plastic rocker on dimensions.com (side,
 * front, back and plan view; Herman Miller's version, 63.5 × 69.2 × 67.3 cm, scaled to Vitra's 62.5 × 69 × 67 cm, see
 * DRAWING_* below) and is matched to Vitra's photos from the side and the front three-quarters (cameras fitted on the
 * runners), the front view of Vitra's dimension drawing and the reference picture from Vitra's configurator. On
 * Vitra's RAR the shell is shorter and sits further forward on the base than in the dimensions.com drawing: about
 * 56 cm deep, well inside the 69 cm runners. So the drawn shell is set into Vitra's pose (POSE below: the seat
 * shortened, the back 6 cm further forward, turned forward by 2.8°). What the photos show:
 * - At rest the chair tilts back a little: the broad, shallow seat rises gently towards the front (about 6°) into a
 *   low, soft front edge that rolls down.
 * - One continuous shell: the seat flows on all sides into walls that rise to the rim. At the sides they are the arms,
 *   upright on the outside, their tops level at about 56 cm; behind they are the back, which leans back, flares back
 *   towards the top and rises above the arms: its top line climbs gradually from the arms into a broad dome. Where
 *   the arms end, the rim runs down to the front edge in one convex curve.
 * - The rim is one thick, soft roll: the wall thickens towards it, mostly on the outside, and the lip curls outwards.
 *   At the arms it stands out over the wall below (the "ears" in the front view), at the front it rolls under.
 *
 * The shell's mid-surface is built around a vertical axis through the seat. From the axis a dished floor (a height
 * field) runs out to a rounded rectangle. From there, in the vertical half-plane at each angle around the axis, a
 * quintic Hermite curve (tangent to the floor, ending in the wall's direction, without curvature at either end) rises
 * to the start of the lip, and the lip curls outwards, at right angles to the rim. The fit moves the start of the lip
 * until the outermost and highest points of the rounded edge lie on EDGE, the rim. The surface is offset to both sides
 * (a 5 mm wall, thickening over the last part of the wall and the lip to a 1.5 cm roll, mostly on the outside) and
 * closed by a rounded edge, so the shell is one smooth solid.
 *
 * The seat pad covers most of the seat, as in the configurator picture: 1.5 cm of upholstery with rounded edges, from
 * the bend into the back to just behind the front edge and a little way up the sides, following the seat's dish.
 *
 * The base: two wires under the shell carry the four shock mounts in pairs (the front one dips between its mounts)
 * and run down as the four legs to the runners; X-braces join every foot to the tops of the legs on its side and at
 * its end; at each foot the wires meet and a short pin goes into the runner, fixed with a screw. Mounts, feet and the
 * runners' curve are where the drawing has them.
 *
 * Built in cm in the catalogue frame (x right, y up, the front faces +z) and exported in metres. Its bounding box is
 * exactly the item's dimensions, W 62.5 × H 67 × D 69 cm, so the app scales it evenly. The materials are called
 * "Shell", "Seat pad", "Base" and "Runners"; item.json maps them to its material slots. The script prints the drawn
 * shell next to the drawing, the main heights after Vitra's pose, and collision parts for item.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  Shape,
  SphereGeometry,
  Vector3,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

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
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec): Vec => mul(a, 1 / length(a));
const mirror = (a: Vec): Vec => [-a[0], a[1], a[2]];

const DEG = Math.PI / 180;
/** 0 → 1 with zero slope and curvature at both ends. */
const smoother = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10));
/** 0 → 1 with zero slope at both ends. */
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

type Knots = readonly (readonly [number, number])[];

/** Natural cubic spline through [t, value] points (continuous curvature), continued straight beyond the ends. */
function spline(points: Knots): (t: number) => number {
  const n = points.length;
  const t = points.map((p) => p[0]);
  const v = points.map((p) => p[1]);
  const m = new Array<number>(n).fill(0);
  const c = new Array<number>(n).fill(0);
  const d = new Array<number>(n).fill(0);
  for (let i = 1; i < n - 1; i++) {
    const h0 = t[i] - t[i - 1];
    const h1 = t[i + 1] - t[i];
    const diag = 2 * (h0 + h1) - h0 * c[i - 1];
    c[i] = h1 / diag;
    d[i] = (6 * ((v[i + 1] - v[i]) / h1 - (v[i] - v[i - 1]) / h0) - h0 * d[i - 1]) / diag;
  }
  for (let i = n - 2; i > 0; i--) m[i] = d[i] - c[i] * m[i + 1];
  const h0 = t[1] - t[0];
  const hn = t[n - 1] - t[n - 2];
  const slope0 = (v[1] - v[0]) / h0 - (h0 * (2 * m[0] + m[1])) / 6;
  const slopeN = (v[n - 1] - v[n - 2]) / hn + (hn * (m[n - 2] + 2 * m[n - 1])) / 6;
  return (x) => {
    if (x <= t[0]) return v[0] + slope0 * (x - t[0]);
    if (x >= t[n - 1]) return v[n - 1] + slopeN * (x - t[n - 1]);
    let i = 0;
    while (x > t[i + 1]) i++;
    const h = t[i + 1] - t[i];
    const a = (t[i + 1] - x) / h;
    const b = 1 - a;
    return a * v[i] + b * v[i + 1] + (((a * a * a - a) * m[i] + (b * b * b - b) * m[i + 1]) * h * h) / 6;
  };
}

/** A spline over the angle around the axis (degrees, 0 = front, 180 = back), symmetric about 0 and 180. */
function byAngle(knots: Knots): (deg: number) => number {
  const before = knots.filter(([a]) => a > 0).map(([a, v]) => [-a, v] as const);
  const after = knots.filter(([a]) => a < 180).map(([a, v]) => [360 - a, v] as const);
  return spline([...before.reverse(), ...knots, ...after.reverse()]);
}

/** Overall size (Vitra): W 62.5 × D 69 × H 67 cm, seat height 33 cm. */
const SIZE = { width: 62.5, depth: 69, height: 67 };

/**
 * The drawing of the Eames moulded plastic rocker on dimensions.com (side, front, back and plan view), traced from its
 * vector paths: 2.995 units per cm in all three directions (its 25 × 27.25 × 26.5 inches), scaled to Vitra's size.
 * z is measured from the middle of the runners, +z to the front. Side view: the top of the shell by z ...
 */
const DRAWING_TOP: Knots = [[-33, 67.0], [-32, 66.9], [-30, 65.4], [-28, 63.2], [-26, 60.8], [-24, 58.6], [-22, 57.0], [-20, 56.0], [-18, 55.5], [-16, 55.5], [-14, 55.8], [-12, 56.1], [-8, 56.8], [-4, 57.5], [0, 58.2], [4, 58.8], [8, 59.3], [12, 59.1], [14, 58.1], [16, 55.8], [18, 52.7], [20, 49.8], [22, 47.1], [24, 44.8], [26, 42.9], [28, 41.7], [30, 41.1]];
/** ... and its bottom: the outside of the back and the seat's underside. */
const DRAWING_BOTTOM: Knots = [[-21, 49.5], [-19, 44.5], [-17, 39.8], [-15, 36.4], [-13, 34.4], [-11, 33.5], [-9, 33.1], [-7, 33.0], [-5, 33.0], [-3, 32.9], [3, 34.2], [7, 35.4], [11, 36.7], [17, 38.5], [21, 40.1], [25, 41.3]];
/** Front view: the shell's half-width by height. */
const DRAWING_FRONT: Knots = [[34, 22.7], [35, 24.5], [36, 25.7], [37, 26.7], [38, 27.5], [40, 28.6], [42, 29.3], [44, 29.6], [46, 29.8], [48, 29.9], [50, 30.0], [52, 30.0], [54, 30.0], [55, 30.0], [56, 30.5], [57, 31.3], [58, 31.2], [60, 18.4], [62, 16.1], [64, 13.7], [66, 10.1]];
/** Plan: the shell's half-width by z. */
const DRAWING_PLAN: Knots = [[-32, 12.7], [-30, 14.9], [-28, 16.3], [-26, 17.4], [-24, 18.6], [-22, 20.1], [-20, 22.9], [-18, 26.9], [-16, 29.8], [-14, 30.85], [-12, 31.2], [-6, 31.26], [0, 31.26], [6, 31.27], [10, 31.27], [12, 31.1], [14, 30.2], [16, 27.4], [18, 26.0], [20, 25.5], [22, 25.3], [24, 25.1], [26, 24.65], [28, 23.4], [30, 20.1], [31, 16.4]];

/**
 * The rim, half of it from the front edge round the right arm to the top of the back: [x, top, z] where the rounded
 * edge is highest and outermost, in the drawn frame (before POSE). The points are where Vitra's photos and the
 * configurator picture have the rim after the pose, taken back through it: the front edge about 36.5 cm high, rising
 * to the sides; the arm's front climbing to the arm in one convex curve; the arms level at about 56 cm; and from the
 * shoulders a top line that climbs gradually into a broad dome, after the front view of Vitra's dimension drawing
 * (half-width 25.7 cm at 55.2 cm high, 19.1 at 58.1, 12.5 at 63.5, 5.9 at 66.2). The plan's widths are the
 * dimensions.com drawing's, scaled.
 */
const EDGE: readonly Vec[] = [
  [0, 39.28, 31.66],
  [10, 39.27, 31.37],
  [15.5, 39.42, 30.46],
  [20.0, 39.89, 28.63],
  [23.0, 40.69, 26.59],
  [25.0, 41.93, 24.43],
  [26.4, 43.83, 22.33],
  [27.4, 45.84, 20.38],
  [28.2, 48.16, 18.49],
  [28.9, 50.59, 16.58],
  [29.6, 53.0, 14.41],
  [30.3, 55.11, 11.84],
  [30.9, 56.61, 8.72],
  [31.2, 57.39, 4.93],
  [31.25, 57.54, 0.45],
  [31.3, 57.44, -3.73],
  [31.3, 57.35, -7.49],
  [31.3, 57.25, -10.83],
  [31.25, 57.15, -13.85],
  [30.8, 57.15, -16.06],
  [29.6, 57.26, -17.86],
  [27.6, 57.48, -19.48],
  [25.0, 57.81, -20.89],
  [22.4, 58.53, -22.53],
  [20.0, 59.44, -24.38],
  [17.6, 60.74, -26.44],
  [15.2, 62.45, -28.43],
  [12.5, 64.16, -30.32],
  [9.8, 65.24, -31.67],
  [7.2, 66.05, -32.61],
  [4.5, 66.72, -33.24],
  [2.2, 66.95, -33.56],
  [0.0, 67.0, -33.66],
];

// ---- the shell (cm) ----
const WALL = 0.5;
/** The wall thickens to a roll at the edge. */
const BEAD = 1.5;
/** Segments of the rounded edge. */
const CAP = 6;
/** The axis of the shell's parametrisation: x = 0, z = AXIS_Z. */
const AXIS_Z = 4;

/**
 * The floor (mid-surface): lowest at z = -6, rising gently towards the front (7.5° as drawn, about 6° after the pose)
 * and a little more in front of z = 12, towards the low front edge; slightly dished across.
 */
const FLOOR = { y0: 34.0, z0: -6, ease: 6, slope: Math.tan(7.5 * DEG), dish: 0.0018, front: 12, rise: 0.0012 };
const floorY = (x: number, z: number) =>
  FLOOR.y0 + FLOOR.slope * (Math.hypot(z - FLOOR.z0, FLOOR.ease) - FLOOR.ease) + FLOOR.dish * x * x + FLOOR.rise * Math.max(0, z - FLOOR.front) ** 2;
const floorGrad = (x: number, z: number): [number, number] => [
  2 * FLOOR.dish * x,
  (FLOOR.slope * (z - FLOOR.z0)) / Math.hypot(z - FLOOR.z0, FLOOR.ease) + 2 * FLOOR.rise * Math.max(0, z - FLOOR.front),
];
/**
 * The floor ends at a rounded rectangle (superellipses), where the walls, the back and the front edge begin: broad and
 * squarish in front of its widest point, so the seat turns up tightly into upright sides (the drawing's front view),
 * and rounder behind it, where the floor turns up into the corners of the back.
 */
const RING = { x: 20, z: 5.5, dz: 16.5, front: 3.2, back: 2.0 };

/** Around the axis (degrees): the direction in which the wall arrives at the lip, from the horizontal outwards, ... */
const WALL_ANGLE = byAngle([[0, 6], [20, 8], [31.5, 14], [38, 26], [42.6, 42], [47, 62], [51, 74], [55, 80], [62, 86], [72, 90], [105, 88], [112, 80], [120, 68], [128, 62], [136, 60.5], [146, 58], [158, 54], [180, 50.5]]);
/**
 * ... how far the curve keeps to the floor's direction and to the wall's (shares of its chord): at the sides it keeps
 * long to both, a tight bend between a flat seat and upright walls; at the back it turns up soon and then runs long in
 * the wall's direction, so the lower back stands steep (about 25° from upright) and the upper back leans back (about
 * 40°), as in the drawing's side view, ...
 */
const FLOOR_PULL = byAngle([[0, 0.5], [45, 0.5], [70, 0.75], [85, 0.8], [100, 0.65], [120, 0.48], [150, 0.42], [180, 0.37]]);
const WALL_PULL = byAngle([[0, 0.35], [40, 0.45], [60, 0.95], [70, 1.3], [90, 1.55], [120, 1.75], [150, 1.6], [180, 1.95]]);
/** ... and the lip: its tightest radius and how far it turns outwards (degrees); least on the steep arm fronts and round the top of the back. */
const LIP_RADIUS = byAngle([[0, 1.8], [30, 1.8], [45, 1.6], [60, 1.4], [75, 1.8], [120, 2.2], [140, 1.8], [160, 1.6], [180, 1.5]]);
const LIP_TURN = byAngle([[0, 70], [30, 58], [45, 45], [60, 35], [75, 55], [100, 65], [118, 80], [130, 66], [150, 42], [165, 30], [180, 26]]);

const FLOOR_ROWS = [0, 0.16, 0.32, 0.47, 0.6, 0.71, 0.8, 0.87, 0.93, 0.97];
const BAND_ROWS = 28;
const LIP_ROWS = 8;
/** Columns round the axis on the right half (0° … 180°); denser where the rim turns quickly. */
const HALF_COLUMNS = 80;

// the rim as a function of the angle around the axis
const edgeSamples = (() => {
  const P = [mirror(EDGE[1]), ...EDGE, mirror(EDGE[EDGE.length - 2])];
  const out: { deg: number; rho: number; y: number }[] = [];
  const lerp = (a: Vec, b: Vec, ta: number, tb: number, t: number) => add(mul(a, (tb - t) / (tb - ta)), mul(b, (t - ta) / (tb - ta)));
  for (let i = 1; i + 2 < P.length; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    // centripetal Catmull-Rom (Barry-Goldman)
    const t0 = 0;
    const t1 = t0 + Math.sqrt(length(sub(p1, p0)));
    const t2 = t1 + Math.sqrt(length(sub(p2, p1)));
    const t3 = t2 + Math.sqrt(length(sub(p3, p2)));
    for (let k = 0; k < 60; k++) {
      const t = t1 + ((t2 - t1) * k) / 60;
      const a1 = lerp(p0, p1, t0, t1, t);
      const a2 = lerp(p1, p2, t1, t2, t);
      const a3 = lerp(p2, p3, t2, t3, t);
      const p = lerp(lerp(a1, a2, t0, t2, t), lerp(a2, a3, t1, t3, t), t1, t2, t);
      out.push({ deg: Math.atan2(p[0], p[2] - AXIS_Z) / DEG, rho: Math.hypot(p[0], p[2] - AXIS_Z), y: p[1] });
    }
  }
  const last = EDGE[EDGE.length - 1];
  out.push({ deg: 180, rho: Math.hypot(last[0], last[2] - AXIS_Z), y: last[1] });
  return out;
})();
for (let i = 1; i < edgeSamples.length; i++) {
  if (edgeSamples[i].deg <= edgeSamples[i - 1].deg) throw new Error(`the rim is not star-shaped round the axis near ${edgeSamples[i].deg.toFixed(1)}°`);
}
function edgeAt(deg: number): { rho: number; y: number } {
  let lo = 0;
  let hi = edgeSamples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (edgeSamples[mid].deg <= deg) lo = mid;
    else hi = mid;
  }
  const a = edgeSamples[lo];
  const b = edgeSamples[hi];
  const u = (deg - a.deg) / (b.deg - a.deg);
  return { rho: a.rho + (b.rho - a.rho) * u, y: a.y + (b.y - a.y) * u };
}

/** Distance from the axis to the floor's edge in the direction deg. */
function ringRadius(deg: number): number {
  const s = Math.sin(deg * DEG);
  const c = Math.cos(deg * DEG);
  // rounder behind the widest point (the back's corners) than in front of it
  const power = deg < Math.atan2(RING.x, RING.z - AXIS_Z) / DEG ? RING.front : RING.back;
  const f = (rho: number) => Math.abs((rho * s) / RING.x) ** power + Math.abs((AXIS_Z + rho * c - RING.z) / RING.dz) ** power - 1;
  let lo = 0;
  let hi = 40;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) < 0) lo = mid;
    else hi = mid;
  }
  return lo;
}

// the columns' angles: denser at the front corners and the shoulders
const columnDegrees = (() => {
  const density = (deg: number) => 1 + 1.4 * Math.exp(-(((deg - 52) / 16) ** 2)) + 1.0 * Math.exp(-(((deg - 128) / 18) ** 2)) + 0.4 * Math.exp(-((deg / 12) ** 2));
  const n = 4000;
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + density(((i - 0.5) / n) * 180));
  const out: number[] = [];
  let k = 0;
  for (let j = 0; j <= HALF_COLUMNS; j++) {
    const target = (j / HALF_COLUMNS) * cum[n];
    while (k < n - 1 && cum[k + 1] < target) k++;
    out.push(((k + (target - cum[k]) / (cum[k + 1] - cum[k])) / n) * 180);
  }
  out[0] = 0;
  out[HALF_COLUMNS] = 180;
  return out;
})();

interface Column {
  deg: number;
  dir: Vec;
  floor: Vec[];
  band: Vec[];
  lip: Vec[];
  /** How far the lip has turned at each of its rows (radians). */
  lipAngles: number[];
  /** The lip's frame: along the surface, away from the rim (m), and outwards (n). */
  m: Vec;
  n: Vec;
}

/** Hermite basis of degree 5 with no curvature at either end. */
function quintic(P0: Vec, T0: Vec, T1: Vec, P1: Vec, t: number): Vec {
  const t2 = t * t;
  const t3 = t2 * t;
  const t4 = t3 * t;
  const t5 = t4 * t;
  const h0 = 1 - 10 * t3 + 15 * t4 - 6 * t5;
  const h1 = t - 6 * t3 + 8 * t4 - 3 * t5;
  const h4 = -4 * t3 + 7 * t4 - 3 * t5;
  const h5 = 10 * t3 - 15 * t4 + 6 * t5;
  return add(add(mul(P0, h0), mul(T0, h1)), add(mul(T1, h4), mul(P1, h5)));
}

/** The right half's columns, with the start of each lip moved in by (rho, y) from the rim. */
function buildColumns(offsets: { rho: number; y: number }[]): Column[] {
  const partial = columnDegrees.map((deg, j) => {
    const dir: Vec = [Math.sin(deg * DEG), 0, Math.cos(deg * DEG)];
    const at = (rho: number, y: number): Vec => [rho * dir[0], y, AXIS_Z + rho * dir[2]];
    const rhoF = ringRadius(deg);
    const floor = FLOOR_ROWS.map((u) => {
      const p = at(rhoF * u, 0);
      return [p[0], floorY(p[0], p[2]), p[2]] as Vec;
    });
    const F = at(rhoF, 0);
    F[1] = floorY(F[0], F[2]);
    const [gx, gz] = floorGrad(F[0], F[2]);
    const tF = unit([dir[0], gx * dir[0] + gz * dir[2], dir[2]]);
    const e = edgeAt(deg);
    const L = at(e.rho - offsets[j].rho, e.y - offsets[j].y);
    const a = WALL_ANGLE(deg) * DEG;
    const tL: Vec = [Math.cos(a) * dir[0], Math.sin(a), Math.cos(a) * dir[2]];
    const chord = length(sub(L, F));
    const T0 = mul(tF, FLOOR_PULL(deg) * chord);
    const T1 = mul(tL, WALL_PULL(deg) * chord);
    const band: Vec[] = [];
    for (let k = 0; k <= BAND_ROWS; k++) band.push(quintic(F, T0, T1, L, k / BAND_ROWS));
    return { deg, dir, floor, band, L, tL };
  });
  // the rim's direction, round the axis, from the neighbouring columns (mirrored past 0° and 180°)
  const Ls = partial.map((c) => c.L);
  const rimTangent = (j: number): Vec => {
    const prev = j === 0 ? mirror(Ls[1]) : Ls[j - 1];
    const next = j === Ls.length - 1 ? mirror(Ls[j - 1]) : Ls[j + 1];
    return unit(sub(next, prev));
  };
  return partial.map((c, j) => {
    const r = rimTangent(j);
    const n = unit(cross(r, c.tL));
    const m = unit(cross(n, r));
    const radius = LIP_RADIUS(c.deg);
    const turn = LIP_TURN(c.deg) * DEG;
    const lipLength = 1.5 * radius * turn;
    // the lip turns by `turn` with its curvature rising from 0 and falling back (smooth), integrated in small steps
    const lip: Vec[] = [];
    const lipAngles: number[] = [];
    let p = c.L;
    const steps = LIP_ROWS * 8;
    for (let k = 1; k <= steps; k++) {
      const s = ((k - 0.5) / steps) * lipLength;
      const angle = turn * smooth(s / lipLength);
      p = add(p, mul(add(mul(m, Math.cos(angle)), mul(n, Math.sin(angle))), lipLength / steps));
      if (k % 8 === 0) {
        lip.push(p);
        lipAngles.push(turn * smooth(k / steps));
      }
    }
    return { deg: c.deg, dir: c.dir, floor: c.floor, band: c.band, lip, lipAngles, m, n };
  });
}

/**
 * Thickness by row: the wall, thickening towards the edge over the band's last GROW rows and the lip, to a soft roll.
 * Most of the extra thickness goes to the outside (BEAD_IN on the sitter's side), so the inside runs smoothly into the
 * rounded edge and the rim reads as one thick roll, not as a tube.
 */
const GROW = 6;
const BEAD_IN = 0.3;
const thickness = (row: number, rows: number) => {
  const start = rows - 1 - LIP_ROWS - GROW;
  return row <= start ? WALL : WALL + (BEAD - WALL) * smoother((row - start) / (LIP_ROWS + GROW));
};
/** How far the sitter's side and the outside lie from the mid-surface. */
const sides = (row: number, rows: number) => {
  const t = thickness(row, rows);
  const inner = WALL / 2 + (t - WALL) * BEAD_IN;
  return { inner, outer: t - inner };
};

// ---- fit: move the start of each lip until the lip's top and outermost point lie on the rim ----
let offsets = columnDegrees.map(() => ({ rho: 1.5, y: 1.3 }));
let columns: Column[] = [];
let worst = 0;
let worstDeg = 0;
for (let round = 0; round < 16; round++) {
  columns = buildColumns(offsets);
  worst = 0;
  offsets = columns.map((c, j) => {
    const e = edgeAt(c.deg);
    const rows = [...c.floor, ...c.band, ...c.lip];
    const R = rows.length;
    const lipFrom = R - c.lip.length;
    let top = -Infinity;
    let out = -Infinity;
    const reach = (q: Vec) => {
      top = Math.max(top, q[1]);
      out = Math.max(out, Math.hypot(q[0], q[2] - AXIS_Z));
    };
    // both surfaces near the rim and the tip of the rounded edge; the sitter's side faces -n, turning with the lip
    for (let i = R - 1 - LIP_ROWS - GROW - 2; i < R; i++) {
      const phi = i >= lipFrom ? c.lipAngles[i - lipFrom] : 0;
      const nIn = add(mul(c.n, -Math.cos(phi)), mul(c.m, Math.sin(phi)));
      const { inner, outer } = sides(i, R);
      reach(add(rows[i], mul(nIn, inner)));
      reach(sub(rows[i], mul(nIn, outer)));
      if (i === R - 1) {
        const along = add(mul(c.m, Math.cos(phi)), mul(c.n, Math.sin(phi)));
        reach(add(add(rows[i], mul(nIn, (inner - outer) / 2)), mul(along, (inner + outer) / 2)));
      }
    }
    const miss = Math.max(Math.abs(top - e.y), Math.abs(out - e.rho));
    if (miss > worst) [worst, worstDeg] = [miss, c.deg];
    // damped: on the steep arm fronts the lip leans out of its column, and full steps overshoot
    return { rho: offsets[j].rho + 0.6 * (out - e.rho), y: offsets[j].y + 0.6 * (top - e.y) };
  });
}
columns = buildColumns(offsets);

// ---- the shell's mesh: sitter's side, outside and the rounded edge ----
const shellData = (() => {
  const half = columns;
  // all columns round the axis: the right half, then the left half mirrored (without repeating 0° and 180°)
  const all = [...half, ...half.slice(1, -1).reverse().map((c) => ({ ...c, floor: c.floor.map(mirror), band: c.band.map(mirror), lip: c.lip.map(mirror), m: mirror(c.m), n: mirror(c.n) }))];
  const C = all.length;
  const grid = all.map((c) => [...c.floor, ...c.band, ...c.lip]);
  const R = grid[0].length;
  const P = (c: number, r: number) => grid[((c % C) + C) % C][r];
  /** The sitter's side normal of the mid-surface. */
  const normalAt = (c: number, r: number): Vec => {
    if (r === 0) {
      const [gx, gz] = floorGrad(0, AXIS_Z);
      return unit([-gx, 1, -gz]);
    }
    const along = sub(P(c, Math.min(r + 1, R - 1)), P(c, r - 1));
    const round = sub(P(c + 1, r), P(c - 1, r));
    return unit(cross(along, round));
  };
  const positions: number[] = [];
  const normals: number[] = [];
  const push = (p: Vec, n: Vec) => {
    positions.push(...p);
    normals.push(...n);
  };
  // vertex index: the pole once per side, then rows 1 … R-1 for every column
  const index = (side: 0 | 1, c: number, r: number) => side * (1 + (R - 1) * C) + (r === 0 ? 0 : 1 + (r - 1) * C + (((c % C) + C) % C));
  for (const side of [1, -1] as const) {
    const n0 = normalAt(0, 0);
    push(add(P(0, 0), mul(n0, (side * WALL) / 2)), mul(n0, side));
    for (let r = 1; r < R; r++) {
      const { inner, outer } = sides(r, R);
      for (let c = 0; c < C; c++) {
        const n = normalAt(c, r);
        push(add(P(c, r), mul(n, side > 0 ? inner : -outer)), mul(n, side));
      }
    }
  }
  // the rounded edge: half circles from the sitter's side round the end of the lip to the outside
  const capStart = positions.length / 3;
  const end = sides(R - 1, R);
  for (let c = 0; c < C; c++) {
    const n = normalAt(c, R - 1);
    const e = unit(sub(sub(P(c, R - 1), P(c, R - 2)), mul(n, dot(sub(P(c, R - 1), P(c, R - 2)), n))));
    const centre = add(P(c, R - 1), mul(n, (end.inner - end.outer) / 2));
    const a = (end.inner + end.outer) / 2;
    for (let k = 1; k < CAP; k++) {
      const th = (Math.PI * k) / CAP;
      const dirK = add(mul(n, Math.cos(th)), mul(e, Math.sin(th)));
      push(add(centre, mul(dirK, a)), unit(dirK));
    }
  }
  const capIndex = (c: number, k: number) => (k === 0 ? index(0, c, R - 1) : k === CAP ? index(1, c, R - 1) : capStart + (((c % C) + C) % C) * (CAP - 1) + (k - 1));

  const indices: number[] = [];
  const at = (k: number): Vec => [positions[3 * k], positions[3 * k + 1], positions[3 * k + 2]];
  const nAt = (k: number): Vec => [normals[3 * k], normals[3 * k + 1], normals[3 * k + 2]];
  // wind every triangle so that it faces along its vertex normals
  const tri = (a: number, b: number, c: number) => {
    const f = cross(sub(at(b), at(a)), sub(at(c), at(a)));
    if (length(f) < 1e-12) return;
    if (dot(f, add(nAt(a), add(nAt(b), nAt(c)))) < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };
  for (const side of [0, 1] as const) {
    for (let c = 0; c < C; c++) {
      tri(index(side, c, 0), index(side, c, 1), index(side, c + 1, 1));
      for (let r = 1; r < R - 1; r++) {
        tri(index(side, c, r), index(side, c + 1, r), index(side, c + 1, r + 1));
        tri(index(side, c, r), index(side, c + 1, r + 1), index(side, c, r + 1));
      }
    }
  }
  for (let c = 0; c < C; c++) {
    for (let k = 0; k < CAP; k++) {
      tri(capIndex(c, k), capIndex(c, k + 1), capIndex(c + 1, k + 1));
      tri(capIndex(c, k), capIndex(c + 1, k + 1), capIndex(c + 1, k));
    }
  }
  return { positions, normals, indices, grid, rows: R, cols: C, normalAt, P };
})();

const shellGeometry = new BufferGeometry();
shellGeometry.setAttribute("position", new Float32BufferAttribute(shellData.positions, 3));
shellGeometry.setAttribute("normal", new Float32BufferAttribute(shellData.normals, 3));
shellGeometry.setIndex(shellData.indices);
// the surfaces' own normals: the wall's thickness changes towards the rim, so the offset surfaces tilt a little
shellGeometry.computeVertexNormals();
const shellMesh = new Mesh(shellGeometry, new MeshStandardMaterial());
shellMesh.updateMatrixWorld();

/** The first point of the shell straight below `from` (looking down) or above it (looking up). */
function hitShell(x: number, z: number, down: boolean) {
  const ray = new Raycaster(new Vector3(x, down ? 100 : 0, z), new Vector3(0, down ? -1 : 1, 0));
  const hit = ray.intersectObject(shellMesh)[0];
  if (!hit) throw new Error(`no shell ${down ? "below" : "above"} (${x.toFixed(1)}, ${z.toFixed(1)})`);
  return hit.point.y;
}

// ---- the seat pad: most of the seat, its outline traced from the configurator picture onto this shell ----
const PAD = { x: 25.3, z: 5, front: 24.5, back: 19.9, frontPower: 3.0, backPower: 2.3, thick: 1.5, round: 1.1, gap: 0.06 };
const padGeometry = (() => {
  const RINGS = [0, 0.18, 0.36, 0.52, 0.65, 0.75, 0.83, 0.89, 0.93, 0.96, 0.98, 0.992, 1];
  const AROUND = 112;
  const outline = (a: number) => {
    // two half superellipses, widest at z = PAD.z: rounder behind (as the floor turns up into the back) than in front
    const s = Math.sin(a);
    const c = Math.cos(a);
    const [dz, p] = c >= 0 ? [PAD.front, PAD.frontPower] : [PAD.back, PAD.backPower];
    return 1 / (Math.abs(s / PAD.x) ** p + Math.abs(c / dz) ** p) ** (1 / p);
  };
  const positions: number[] = [];
  const indices: number[] = [];
  const vertex = (x: number, y: number, z: number) => {
    positions.push(x, y, z);
    return positions.length / 3 - 1;
  };
  const top: number[][] = [];
  const bottom: number[][] = [];
  for (let k = 0; k < AROUND; k++) {
    const a = (2 * Math.PI * k) / AROUND;
    const rMax = outline(a);
    const t: number[] = [];
    const b: number[] = [];
    for (const [i, f] of RINGS.entries()) {
      if (i === 0 && k > 0) {
        t.push(top[0][0]);
        b.push(bottom[0][0]);
        continue;
      }
      const x = f * rMax * Math.sin(a);
      const z = PAD.z + f * rMax * Math.cos(a);
      const y = hitShell(x, z, true) + PAD.gap;
      const d = (1 - f) * rMax; // distance from the edge
      const h = PAD.thick * Math.sqrt(Math.max(0, 1 - (1 - Math.min(d, PAD.round) / PAD.round) ** 2)) + 0.25 * (1 - f * f);
      t.push(vertex(x, y + h, z));
      b.push(i === RINGS.length - 1 ? t[t.length - 1] : vertex(x, y, z));
    }
    top.push(t);
    bottom.push(b);
  }
  for (let k = 0; k < AROUND; k++) {
    const k2 = (k + 1) % AROUND;
    for (let i = 0; i + 1 < RINGS.length; i++) {
      const [a, b, c, d] = [top[k][i], top[k2][i], top[k2][i + 1], top[k][i + 1]];
      if (i === 0) indices.push(a, d, c);
      else indices.push(a, d, c, a, c, b);
      const [e, f, g, h] = [bottom[k][i], bottom[k2][i], bottom[k2][i + 1], bottom[k][i + 1]];
      if (i === 0) indices.push(e, g, h);
      else indices.push(e, g, h, e, f, g);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
})();

// ---- Vitra's pose: on Vitra's RAR the shell is shorter and sits further forward than in the drawing ----
/**
 * Vitra's photos of the RAR (from the side and from the front three-quarters, cameras fitted on the runners) and the
 * reference render show a shorter shell than the dimensions.com drawing (Vitra's dimension drawing: shell 52 cm
 * deep, runners 69): the back stands about 6 cm further forward over the runners, the front edge 1.6 cm further back,
 * and the shell tips forward by about 3° (front edge about 36.5 cm high, arms about 56 cm, underside about 32.5 cm).
 * So the drawing's shell and the pad on it are warped: what is behind z = `from` moves forward by
 * `back`, what is in front of z = `to` by `front`, smoothly in between (the seat gets shorter); then they turn forward
 * by `tilt` about `pivot` and are lowered until the top of the back is back at the full height.
 */
const POSE = { back: 6.0, front: -1.6, from: -12, to: 22, tilt: 2.8, pivot: [0, 40, 5] as Vec };
const poseT = (z: number) => (z - POSE.from) / (POSE.to - POSE.from);
const poseShift = (z: number) => POSE.back + (POSE.front - POSE.back) * smooth(poseT(z));
/** d(shift)/dz: the warp stretches z by 1 + this (always > 0, the warp never folds). */
const poseSlope = (z: number) => {
  const t = poseT(z);
  return t <= 0 || t >= 1 ? 0 : ((POSE.front - POSE.back) * 6 * t * (1 - t)) / (POSE.to - POSE.from);
};
const [poseCos, poseSin] = [Math.cos(POSE.tilt * DEG), Math.sin(POSE.tilt * DEG)];
/** The tilt about x: + turns the front down and the top forward. */
const poseTurn = (v: Vec, about: Vec): Vec => {
  const y = v[1] - about[1];
  const z = v[2] - about[2];
  return [v[0], about[1] + y * poseCos - z * poseSin, about[2] + y * poseSin + z * poseCos];
};
const posed = (p: Vec): Vec => poseTurn([p[0], p[1], p[2] + poseShift(p[2])], POSE.pivot);
/** The shell as drawn (before the pose), for the comparison with the drawing in the report. */
const drawnShell: Vec[] = (() => {
  const pos = shellGeometry.getAttribute("position");
  return Array.from({ length: pos.count }, (_, i): Vec => [pos.getX(i), pos.getY(i), pos.getZ(i)]);
})();
const POSE_LIFT = Math.max(...drawnShell.map((p) => p[1])) - Math.max(...drawnShell.map((p) => posed(p)[1]));
for (const g of [shellGeometry, padGeometry]) {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  for (let i = 0; i < pos.count; i++) {
    const p: Vec = [pos.getX(i), pos.getY(i), pos.getZ(i)];
    const q = posed(p);
    pos.setXYZ(i, q[0], q[1] + POSE_LIFT, q[2]);
    // normals: through the warp's inverse transpose, then the same turn
    const n = poseTurn(unit([nrm.getX(i), nrm.getY(i), nrm.getZ(i) / (1 + poseSlope(p[2]))]), [0, 0, 0]);
    nrm.setXYZ(i, n[0], n[1], n[2]);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
}

// ---- the runners (dark maple): the drawing's rocker curve, about 3.8 cm high in the middle, rounded ends ----
/**
 * 42.4 cm apart (centres), as in the dimensions.com drawing. Vitra's photos agree: seen from the front (its strong
 * perspective measured on the runners) and from the front three-quarters, runners this far apart are the ones that
 * fit the 62.5 cm wide shell. (Vitra's "410" is not the runners' width.)
 */
const RUNNER = { x: 21.2, width: 2.5, round: 0.5, length: SIZE.depth };
const RUNNER_BOTTOM = spline([[-33, 6.67], [-31, 5.91], [-29, 5.23], [-27, 4.6], [-25, 4.03], [-23, 3.47], [-21, 2.98], [-19, 2.5], [-17, 2.08], [-15, 1.68], [-13, 1.33], [-11, 1.02], [-9, 0.73], [-7, 0.48], [-5, 0.3], [-3, 0.17], [-1, 0.1], [1, 0.07], [3, 0.07], [5, 0.09], [7, 0.15], [9, 0.26], [11, 0.41], [13, 0.6], [15, 0.84], [17, 1.12], [19, 1.43], [21, 1.79], [23, 2.19], [25, 2.62], [27, 3.09], [29, 3.6], [31, 4.15], [33, 4.75]]);
const RUNNER_HEIGHT = spline([[-33, 2.2], [-29, 2.64], [-25, 2.94], [-21, 3.19], [-17, 3.41], [-13, 3.59], [-9, 3.75], [-5, 3.85], [-1, 3.84], [3, 3.75], [7, 3.66], [11, 3.53], [15, 3.37], [19, 3.17], [23, 2.93], [27, 2.63], [31, 2.27], [33, 2.05]]);
/** The lowest point of the drawing's runner; the model stands on it. */
const RUNNER_LOW = (() => {
  let low = Infinity;
  for (let z = -30; z <= 30; z += 0.05) low = Math.min(low, RUNNER_BOTTOM(z));
  return low;
})();
const runnerBottom = (z: number) => RUNNER_BOTTOM(z) - RUNNER_LOW;
const runnerTop = (z: number) => runnerBottom(z) + RUNNER_HEIGHT(z);
const runnerGeometry = (() => {
  const end = RUNNER.length / 2;
  // the ends are half circles over the end's height
  const r0 = RUNNER_HEIGHT(-end) / 2;
  const r1 = RUNNER_HEIGHT(end) / 2;
  const z0 = -end + r0;
  const z1 = end - r1;
  const shape = new Shape();
  const N = 48;
  const ENDS = 10;
  shape.moveTo(z0, runnerBottom(z0));
  for (let i = 1; i <= N; i++) {
    const z = z0 + ((z1 - z0) * i) / N;
    shape.lineTo(z, runnerBottom(z));
  }
  const c1 = (runnerBottom(z1) + runnerTop(z1)) / 2;
  for (let i = 1; i < ENDS; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / ENDS;
    shape.lineTo(z1 + r1 * Math.cos(a), c1 + ((runnerTop(z1) - runnerBottom(z1)) / 2) * Math.sin(a));
  }
  for (let i = 0; i <= N; i++) {
    const z = z1 - ((z1 - z0) * i) / N;
    shape.lineTo(z, runnerTop(z));
  }
  const c0 = (runnerBottom(z0) + runnerTop(z0)) / 2;
  for (let i = 1; i < ENDS; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / ENDS;
    shape.lineTo(z0 + r0 * Math.cos(a), c0 + ((runnerTop(z0) - runnerBottom(z0)) / 2) * Math.sin(a));
  }
  const pieces: BufferGeometry[] = [];
  for (const sx of [1, -1]) {
    const g = new ExtrudeGeometry(shape, {
      depth: RUNNER.width - 2 * RUNNER.round,
      bevelEnabled: true,
      bevelThickness: RUNNER.round,
      bevelSize: RUNNER.round,
      bevelOffset: -RUNNER.round,
      bevelSegments: 3,
      curveSegments: 8,
      steps: 1,
    });
    g.translate(0, 0, -(RUNNER.width - 2 * RUNNER.round) / 2);
    g.rotateY(-Math.PI / 2);
    g.translate(sx * RUNNER.x, 0, 0);
    g.deleteAttribute("uv");
    pieces.push(g);
  }
  const merged = mergeGeometries(pieces);
  if (!merged) throw new Error("could not merge the runners");
  // shared vertices and smooth normals (the extrusion comes unindexed, with a normal per triangle)
  merged.deleteAttribute("normal");
  const indexed = mergeVertices(merged, 1e-4);
  indexed.computeVertexNormals();
  return indexed;
})();

// ---- the wire base (cm) ----
const LEG = 0.34; // legs and the wires under the shell
const WIRE = 0.26; // braces
const PIN = 0.36; // into the runners
const PAD_MOUNT = { radius: 1.25, height: 1.1 }; // shock mounts between the wires and the shell
/** Shock mounts: half the distance between each pair, and how far behind (-) or in front of the runners' middle. */
const MOUNT = { back: { x: 5.6, z: -2.1 }, front: { x: 9.6, z: 14.6 } };
/**
 * Where the wires meet above the runners (the drawing's side view; across, as far inside the runners as in the
 * drawing's front view), and where the pins go in.
 */
const APEX = { back: { x: RUNNER.x - 1.9, y: 8.6, z: -12.9, pinZ: -13.8 }, front: { x: RUNNER.x - 2.6, y: 9.8, z: 23.4, pinZ: 24.9 } };

/** A round wire along a path (smooth frames; open ends, they end inside other parts). */
function wire(path: Vec[], radius: number, radial: number): BufferGeometry {
  const tangents = path.map((_, i) => unit(sub(path[Math.min(i + 1, path.length - 1)], path[Math.max(i - 1, 0)])));
  let normal = unit(cross(tangents[0], Math.abs(tangents[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]));
  const positions: number[] = [];
  const normals: number[] = [];
  path.forEach((p, i) => {
    const tg = tangents[i];
    normal = unit(sub(normal, mul(tg, dot(normal, tg)))); // parallel transport
    const binormal = cross(tg, normal);
    for (let k = 0; k < radial; k++) {
      const a = (2 * Math.PI * k) / radial;
      const n = add(mul(normal, Math.cos(a)), mul(binormal, Math.sin(a)));
      positions.push(...add(p, mul(n, radius)));
      normals.push(...n);
    }
  });
  const indices: number[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    for (let k = 0; k < radial; k++) {
      const a = i * radial + k;
      const b = i * radial + ((k + 1) % radial);
      indices.push(a, b, b + radial, a, b + radial, a + radial);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setAttribute("normal", new Float32BufferAttribute(normals, 3));
  g.setIndex(indices);
  return g;
}

/** A polyline with its corners rounded (radius r). */
function bent(points: Vec[], r: number): Vec[] {
  const out: Vec[] = [points[0]];
  for (let i = 1; i + 1 < points.length; i++) {
    const p = points[i];
    const d1 = unit(sub(p, points[i - 1]));
    const d2 = unit(sub(points[i + 1], p));
    const cut = r / Math.tan(Math.acos(Math.min(1, Math.max(-1, -dot(d1, d2)))) / 2);
    const a = sub(p, mul(d1, cut));
    const c = add(p, mul(d2, cut));
    for (let k = 0; k <= 8; k++) {
      const u = k / 8;
      out.push(add(add(mul(a, (1 - u) ** 2), mul(p, 2 * u * (1 - u))), mul(c, u * u)));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

const baseGeometry = (() => {
  const pieces: BufferGeometry[] = [];
  /** Height of the wire under a pair of mounts: below the shell's underside by the mount. */
  const wireHeight = (m: { x: number; z: number }) => Math.min(hitShell(m.x, m.z, false), hitShell(-m.x, m.z, false)) - PAD_MOUNT.height - LEG;
  const yBack = wireHeight(MOUNT.back);
  const yFront = wireHeight(MOUNT.front);
  const apex = (k: "back" | "front", sx: number): Vec => [sx * APEX[k].x, APEX[k].y, APEX[k].z];
  // the back wire: leg, straight under its two mounts, leg
  const backTop = (sx: number): Vec => [sx * (MOUNT.back.x + 2.4), yBack, MOUNT.back.z];
  pieces.push(wire(bent([apex("back", -1), backTop(-1), backTop(1), apex("back", 1)], 1.0), LEG, 10));
  // the front wire: leg, under its mount, dipping 3.4 cm between the mounts, under the other mount, leg
  const frontTop = (sx: number): Vec => [sx * (MOUNT.front.x + 1.6), yFront, MOUNT.front.z];
  const frontIn = (sx: number): Vec => [sx * (MOUNT.front.x - 1.2), yFront, MOUNT.front.z];
  const frontDip = (sx: number): Vec => [sx * 5.8, yFront - 3.4, MOUNT.front.z];
  pieces.push(wire(bent([apex("front", -1), frontTop(-1), frontIn(-1), frontDip(-1), frontDip(1), frontIn(1), frontTop(1), apex("front", 1)], 0.9), LEG, 10));
  /** A point on a leg, `down` cm below its top. */
  const onLeg = (k: "back" | "front", sx: number, down: number): Vec => {
    const top = k === "back" ? backTop(sx) : frontTop(sx);
    return add(top, mul(unit(sub(apex(k, sx), top)), down));
  };
  const joints: Vec[] = [];
  for (const sx of [1, -1]) {
    // crossed braces on the side: each foot to the top of the other leg
    for (const [from, to, down] of [["back", "front", 4.5], ["front", "back", 3.5]] as const) {
      const p = onLeg(to, sx, down);
      pieces.push(wire([apex(from, sx), p], WIRE, 8));
      joints.push(p);
    }
    // crossed braces at the front and the back: each foot to the top of the opposite leg
    for (const [k, down] of [["front", 4.5], ["back", 3.5]] as const) {
      const p = onLeg(k, -sx, down);
      pieces.push(wire([apex(k, sx), p], WIRE, 8));
      joints.push(p);
    }
    for (const k of ["back", "front"] as const) {
      const a = apex(k, sx);
      joints.push(a);
      // the pin into the runner, a ferrule on the runner and a screw in its side
      const z = APEX[k].pinZ;
      const foot: Vec = [sx * RUNNER.x, runnerTop(z) - 0.6, z];
      pieces.push(wire([a, foot], PIN, 10));
      const slope = Math.atan((runnerTop(z + 0.5) - runnerTop(z - 0.5)) / 1);
      pieces.push(new CylinderGeometry(0.62, 0.72, 0.45, 16).rotateX(slope).translate(foot[0], runnerTop(z) + 0.15, z));
      const screw = new CylinderGeometry(0.42, 0.42, 0.16, 14).rotateZ(Math.PI / 2);
      pieces.push(screw.translate(sx * (RUNNER.x + RUNNER.width / 2 + 0.05), (runnerBottom(z) + runnerTop(z)) / 2, z));
    }
    // the shock mounts, from the wire up into the shell's underside
    for (const k of ["back", "front"] as const) {
      const m = MOUNT[k];
      const y = k === "back" ? yBack : yFront;
      let top = Infinity;
      for (let a = 0; a < 12; a++) top = Math.min(top, hitShell(sx * m.x + PAD_MOUNT.radius * Math.cos((a * Math.PI) / 6), m.z + PAD_MOUNT.radius * Math.sin((a * Math.PI) / 6), false));
      top += 0.15;
      pieces.push(new CylinderGeometry(PAD_MOUNT.radius, PAD_MOUNT.radius * 1.08, top - y, 18).translate(sx * m.x, (top + y) / 2, m.z));
    }
  }
  for (const j of joints) pieces.push(new SphereGeometry(WIRE * 1.7, 10, 8).translate(j[0], j[1], j[2]));
  const flat = pieces.map((g) => {
    g.deleteAttribute("uv");
    return g;
  });
  const merged = mergeGeometries(flat);
  if (!merged) throw new Error("could not merge the base");
  return { geometry: merged, yBack, yFront };
})();

/** The seat height: the lowest point of the sitter's side on the centre line. */
const seatLow = Math.min(...Array.from({ length: 41 }, (_, i) => hitShell(0, -16 + i, true)));

// ---- exact fit to the dimensions (corrects the last fraction of a millimetre), then metres ----
const parts = [shellGeometry, padGeometry, baseGeometry.geometry, runnerGeometry];
const bounds = (gs: BufferGeometry[]) => {
  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  for (const g of gs) {
    const pos = g.getAttribute("position");
    for (let i = 0; i < pos.count; i++) {
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k], pos.getComponent(i, k));
        max[k] = Math.max(max[k], pos.getComponent(i, k));
      }
    }
  }
  return { min, max };
};
const box = bounds(parts);
const target = { min: [-SIZE.width / 2, 0, -SIZE.depth / 2], max: [SIZE.width / 2, SIZE.height, SIZE.depth / 2] };
const factor = [0, 1, 2].map((k) => (target.max[k] - target.min[k]) / (box.max[k] - box.min[k]));
const toCm = (v: Vec): Vec => [0, 1, 2].map((k) => (v[k] - box.min[k]) * factor[k] + target.min[k]) as Vec;
for (const g of parts) {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  for (let i = 0; i < pos.count; i++) {
    const p = toCm([pos.getX(i), pos.getY(i), pos.getZ(i)]);
    pos.setXYZ(i, p[0] / 100, p[1] / 100, p[2] / 100);
    const n = unit([nrm.getX(i) / factor[0], nrm.getY(i) / factor[1], nrm.getZ(i) / factor[2]]);
    nrm.setXYZ(i, n[0], n[1], n[2]);
  }
}

const chair = new Group();
chair.name = "armchair-eames-rar";
const meshes: [string, BufferGeometry, MeshStandardMaterial][] = [
  ["shell", shellGeometry, new MeshStandardMaterial({ name: "Shell", color: "#a9bbbe", roughness: 0.45 })],
  ["seat pad", padGeometry, new MeshStandardMaterial({ name: "Seat pad", color: "#b3bcbd", roughness: 0.95 })],
  ["base", baseGeometry.geometry, new MeshStandardMaterial({ name: "Base", color: "#1e1e1e", roughness: 0.5, metalness: 0.6 })],
  ["runners", runnerGeometry, new MeshStandardMaterial({ name: "Runners", color: "#3a2720", roughness: 0.5 })],
];
for (const [name, geometry, material] of meshes) {
  const mesh = new Mesh(geometry, material);
  mesh.name = name;
  chair.add(mesh);
}

const out = resolve(import.meta.dirname, "..", "..", "catalogue", "armchair-eames-rar", "model.glb");
mkdirSync(resolve(out, ".."), { recursive: true });
const glb = (await new GLTFExporter().parseAsync(chair, { binary: true })) as ArrayBuffer;
writeFileSync(out, Buffer.from(glb));

// ---- report: the fit, the shape next to the drawing (final geometry, cm), collision parts for item.json ----
const cm = (v: number) => v.toFixed(1);
const points = (g: BufferGeometry): Vec[] => {
  const pos = g.getAttribute("position");
  const list: Vec[] = [];
  for (let i = 0; i < pos.count; i++) list.push([pos.getX(i) * 100, pos.getY(i) * 100, pos.getZ(i) * 100]);
  return list;
};
const shellPoints = points(shellGeometry);
console.log(`fit: ${columns.length} columns per half, largest miss ${worst.toFixed(3)} cm (at ${worstDeg.toFixed(1)}°); scaled by ${factor.map((f) => f.toFixed(4)).join(" × ")} to ${SIZE.width} × ${SIZE.height} × ${SIZE.depth} cm`);
console.log(`model.glb: ${(glb.byteLength / 1024).toFixed(0)} KB, shell ${shellData.indices.length / 3} triangles`);

const near = (list: Vec[], k: number, v: number, w: number) => list.filter((p) => Math.abs(p[k] - v) < w);
const row = (label: string, model: number, drawn: number) => `${label.padStart(6)} ${cm(model).padStart(6)} ${cm(drawn).padStart(6)} ${(model - drawn >= 0 ? "+" : "") + cm(model - drawn)}`;
console.log("\nthe shell as drawn (before Vitra's pose), next to the drawing");
console.log("side view: top of the shell by z (model, drawing, difference)");
for (const [z, y] of DRAWING_TOP) {
  const sel = near(drawnShell, 2, z, 0.35);
  if (sel.length) console.log(row(`z ${z}`, Math.max(...sel.map((p) => p[1])), y));
}
console.log("side view: bottom of the shell by z");
for (const [z, y] of DRAWING_BOTTOM) {
  const sel = near(drawnShell, 2, z, 0.35);
  if (sel.length) console.log(row(`z ${z}`, Math.min(...sel.map((p) => p[1])), y));
}
console.log("front view: half-width by height");
for (const [y, x] of DRAWING_FRONT) {
  const sel = near(drawnShell, 1, y, 0.25);
  if (sel.length) console.log(row(`y ${y}`, Math.max(...sel.map((p) => Math.abs(p[0]))), x));
}
console.log("plan: half-width by z");
for (const [z, x] of DRAWING_PLAN) {
  const sel = near(drawnShell, 2, z, 0.35);
  if (sel.length) console.log(row(`z ${z}`, Math.max(...sel.map((p) => Math.abs(p[0]))), x));
}
{
  const centre = shellPoints.filter((p) => Math.abs(p[0]) < 1);
  const top = shellPoints.reduce((a, p) => (p[1] > a[1] ? p : a));
  const lip = centre.reduce((a, p) => (p[2] > a[2] ? p : a));
  const back = shellPoints.reduce((a, p) => (p[2] < a[2] ? p : a));
  const arm = Math.max(...shellPoints.filter((p) => Math.abs(p[0]) > 29).map((p) => p[1]));
  console.log(`\nwith Vitra's pose: top of the back ${cm(top[1])} at z ${cm(top[2])}; back of the shell z ${cm(back[2])}; front edge z ${cm(lip[2])} at ${cm(lip[1])}; arms ${cm(arm)}; underside ${cm(Math.min(...shellPoints.map((p) => p[1])))}; shell ${cm(lip[2] - back[2])} deep`);
}
console.log(`\nseat (sitter's side, lowest on the centre line): ${cm(toCm([0, seatLow, 0])[1])} cm; wires under the mounts at ${cm(toCm([0, baseGeometry.yBack, 0])[1])} (back) and ${cm(toCm([0, baseGeometry.yFront, 0])[1])} cm (front)`);

// collision parts: the runners, the base, and the shell in four layers, each its outline seen from above (convex)
function hull(list: [number, number][]): [number, number][] {
  const pts = [...list].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const crossZ = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
/** Fewer points: drop those that change the outline by less than `tolerance` cm. */
function simplify(poly: [number, number][], tolerance: number): [number, number][] {
  const out = [...poly];
  let changed = true;
  while (changed && out.length > 8) {
    changed = false;
    for (let i = 0; i < out.length && out.length > 8; i++) {
      const a = out[(i + out.length - 1) % out.length];
      const p = out[i];
      const b = out[(i + 1) % out.length];
      const ab = [b[0] - a[0], b[1] - a[1]];
      const d = Math.abs((p[0] - a[0]) * ab[1] - (p[1] - a[1]) * ab[0]) / Math.hypot(ab[0], ab[1]);
      if (d < tolerance) {
        out.splice(i, 1);
        changed = true;
      }
    }
  }
  return out;
}
const r1 = (v: number) => Math.round(v * 10) / 10 + 0;
const collision: string[] = [];
const runnerMax = Math.max(...points(runnerGeometry).map((p) => p[1]));
collision.push(`{ "name": "runners", "shape": "box", "size": { "x": ${r1(RUNNER.width)}, "y": ${r1(runnerMax)}, "z": ${SIZE.depth} }, "position": { "x": ${r1(RUNNER.x)}, "y": ${r1(runnerMax / 2)}, "z": 0 }, "mirror": ["x"], "material": "runners" }`);
const basePts = points(baseGeometry.geometry);
const bb = { x: Math.max(...basePts.map((p) => Math.abs(p[0]))), y0: Math.min(...basePts.filter((p) => Math.abs(Math.abs(p[0]) - RUNNER.x) > 1.4).map((p) => p[1])), y1: Math.max(...basePts.map((p) => p[1])), z0: Math.min(...basePts.map((p) => p[2])), z1: Math.max(...basePts.map((p) => p[2])) };
collision.push(`{ "name": "base", "shape": "box", "size": { "x": ${r1(2 * bb.x)}, "y": ${r1(bb.y1 - bb.y0)}, "z": ${r1(bb.z1 - bb.z0)} }, "position": { "x": 0, "y": ${r1((bb.y0 + bb.y1) / 2)}, "z": ${r1((bb.z0 + bb.z1) / 2)} }, "material": "base" }`);
const layers: [string, number, number][] = [["seat", 0, 42], ["shell, lower", 42, 51], ["shell, upper", 51, 60], ["backrest", 60, SIZE.height]];
for (const [name, y0, y1] of layers) {
  const sel = shellPoints.filter((p) => p[1] >= y0 && p[1] <= y1);
  const lo = Math.min(...sel.map((p) => p[1]));
  const hi = Math.max(...sel.map((p) => p[1]));
  const outline = simplify(hull(sel.map((p) => [r1(p[0]), r1(p[2])] as [number, number])), 0.25);
  collision.push(`{ "name": "${name}", "shape": "extrusion", "points": [${outline.map(([x, z]) => `[${r1(x)}, ${r1(z)}]`).join(", ")}], "height": ${r1(hi - lo)}, "position": { "x": 0, "y": ${r1(lo)}, "z": 0 }, "material": "shell" }`);
}
console.log("\ncollision parts:");
console.log(collision.map((c) => `    ${c}`).join(",\n"));
