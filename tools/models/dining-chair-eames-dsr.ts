/**
 * npx tsx tools/models/dining-chair-eames-dsr.ts — writes catalogue/dining-chair-eames-dsr/model.glb, built from its
 * own geometry (no third-party assets): the Vitra Eames Plastic Side Chair DSR, a moulded one-piece shell on an
 * Eiffel wire base.
 *
 * The shape follows Vitra's dimension drawing (front and side view; traced at about 2 mm per pixel and scaled to the
 * official size, see DRAWING_* below) and dealer photos from all sides:
 * - From the side, the seat's front edge rolls down in a short lip. Behind it the seat falls gently towards the back,
 *   runs flat for a few cm and bends up, in a radius of about 11 cm, into a back that stands almost upright (7–10°
 *   from vertical). Only the top edge curls back; that curl, not a long seat, makes the 55 cm depth.
 * - From the front, the shell is widest at the seat and narrows steadily up the back, without a waist, to a broad
 *   domed top.
 * - The seat dishes deeper towards the back, the back wraps around the sitter and the edges roll up slightly.
 *
 * The shell is a parametric surface over (x, t): x across the width, t along the side profile of the centre line from
 * the front edge, through the bend, to the top. Every column x has its own side profile (the bend starts earlier at
 * the sides, so the rim sweeps from the seat into the back in a wide curve) and is lifted towards the sitter by the
 * dish, the wrap and the rolled edges. The surface is offset to both sides (4.5 mm wall) and closed by a rolled rim of
 * 1 cm, so the shell is one smooth solid. The fit places the profile as in the drawing (front edge, the seat's
 * underside, the outside of the back, the height) and fits the outline's width and the wrap up the back to the
 * drawing's front and side view. The script prints the result next to the drawing, and collision parts for item.json.
 *
 * The base: four splayed legs that meet two runners under the seat, a belt 16 cm above the floor, crossed struts on
 * all four sides, shock mounts and glides; the feet and mounts sit where the drawing has them.
 *
 * Built in cm in the catalogue frame (x right, y up, the front faces +z) and exported in metres. Its bounding box is
 * exactly the item's dimensions, W 46.5 × H 83 × D 55 cm (seat height 43 cm), so the app scales it evenly. The
 * materials are called "Shell" and "Base"; item.json maps them to its material slots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
  LatheGeometry,
  Mesh,
  MeshStandardMaterial,
  Raycaster,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

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
const unit = (a: Vec): Vec => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

const DEG = Math.PI / 180;
/** 0 → 1 with zero slope and curvature at both ends (keeps the surface curvature continuous). */
const smoother = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * u * (u * (u * 6 - 15) + 10));
const step = (v: number, a: number, b: number) => smoother((v - a) / (b - a));

/**
 * 0 → 1 over [a, b] with a slope that rises over the first share k, stays constant and falls over the last share k.
 * As a turning angle: a bend of almost constant radius whose curvature still changes smoothly.
 */
function ramp(v: number, a: number, b: number, k: number): number {
  if (v <= a) return 0;
  if (v >= b) return 1;
  const u = (v - a) / (b - a);
  const rise = (w: number) => w ** 4 * (w * w - 3 * w + 2.5); // the integral of smoother from 0 to w
  const area = u <= k ? k * rise(u / k) : u <= 1 - k ? k / 2 + u - k : 1 - k - k * rise((1 - u) / k);
  return area / (1 - k);
}

/** Natural cubic spline through [t, value] points (continuous curvature), continued straight beyond the ends. */
function spline(points: readonly (readonly [number, number])[]): (t: number) => number {
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

// 8-point Gauss-Legendre quadrature on [-1, 1]
const GX = [-0.9602898564975363, -0.7966664774136267, -0.525532409916329, -0.1834346424956498, 0.1834346424956498, 0.525532409916329, 0.7966664774136267, 0.9602898564975363];
const GW = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.362683783378362, 0.362683783378362, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];

/** Overall size (Vitra): W 46.5 × D 55 × H 83 cm, seat height 43 cm. */
const SIZE = { width: 46.5, depth: 55, height: 83 };
/** The seat's front edge is the front of the bounding box; "depth" below is measured back from it. */
const FRONT = SIZE.depth / 2;

/**
 * Vitra's dimension drawing of the DSR (www.vitra.com, as shown by dealers), traced and scaled to the official size.
 * Its side view is drawn about 4 % shallower than the 55 cm Vitra lists, and is stretched to it. Up the back, by
 * height: the half-width seen from the front, and seen from the side the depth of the rims (the frontmost point) and
 * of the outside of the back (the rearmost).
 */
const DRAWING_BACK: readonly (readonly [height: number, halfWidth: number, rims: number, back: number])[] = [
  [47, 23.03, 28.5, 46.9],
  [49, 22.29, 36.5, 47.7],
  [51, 21.8, 39.4, 48.2],
  [53, 21.32, 40.8, 48.4],
  [55, 20.79, 41.9, 48.5],
  [58, 20.04, 43.2, 48.9],
  [61, 19.29, 44.2, 49.3],
  [64, 18.44, 45.1, 49.8],
  [67, 17.68, 45.9, 50.0],
  [70, 16.75, 46.6, 50.7],
  [73, 15.79, 47.5, 51.2],
  [76, 14.73, 48.3, 51.6],
  [78, 13.95, 49.1, 52.1],
  [80, 12.84, 50.2, 52.5],
  [81, 11.87, 50.9, 53.1],
  [82, 10.56, 51.9, 54.2],
];
/** Along the seat, by depth: the height of the rims (the top of the side view) ... */
const DRAWING_RIMS = [[2, 45.0], [5, 45.7], [10, 45.9], [20, 46.15], [25, 46.6], [30, 47.2], [33, 47.9], [36, 48.75], [38, 49.8], [40, 52.1], [42, 55.5], [44, 60.7]] as const;
/** ... and of the underside (its bottom, where the base doesn't hide it). */
const DRAWING_UNDERSIDE = [[0.5, 42.9], [2, 43.35], [4, 44.0], [6, 44.4], [10, 44.0], [12, 43.55], [14, 43.1], [20, 42.25], [24, 41.6], [28, 41.2], [30, 40.95], [37.5, 40.95], [41, 41.8], [43, 42.9], [45, 44.6]] as const;

// ---- the shell (cm) ----
const WALL = 0.45;
/** Thickness of the rolled rim; the wall thickens towards it over RIM_BAND, mostly on the outside. */
const RIM = 1.0;
const RIM_BAND = 1.8;
const RIM_INSIDE = 0.3;
const RIM_SEGMENTS = 6;
/** Half-width at which the transverse curvature (dish, wrap) reaches its nominal depth. */
const XREF = 23;

// Side profile of the centre line, as its tangent angle in degrees going back from the front edge and up the back.
const PHI_TIP = 22; // the front edge rolls down (a short waterfall lip) ...
const WATERFALL = 10; // ... and turns over a crown into the seat within this length,
const PHI_FALL = -13; // behind which the seat falls towards the back,
const EASED = 16; // ... easing by here
const PHI_SEAT = -9; // ... to this slope,
const SETTLE = 6; // and levels out over this length
const FLAT = 4.5; // ... into a flat floor in front of the bend
const BEND = 18.5; // length of the bend into the back on the centre line (a radius of about 11 cm), ...
const BEND_EASE = 0.15; // ... its curvature easing in and out over the first and last 15 %
const BEND_EARLY = 8; // at the sides the bend starts earlier ...
const BEND_LATE = 4; // ... and ends later, so the rim sweeps from the seat into the back
const PHI_BACK = 83; // the back rises almost upright (7° from vertical) ...
const PHI_UPPER = 79.5; // ... leaning back a little more towards the top,
const CURL = 4; // and near the top the edge curls back within this length (the fit sets how far: the 55 cm depth)
const TIP = 1; // ... and runs straight for the last cm
const FRONT_BOW = 1.5; // the front edge bows forward in the middle
const TOP_DIP = 2.5; // the top edge's corners are set back down the profile a little
const FRONT_CORNER = 9.5; // radius of the seat's front corners (seen from above)
const TOP_CORNER = 8; // radius of the back's top corners
const ROLL_START = 0.62; // the edges roll up over the outer 38 % of the half-width

type Knots = readonly (readonly [number, number])[];
/** Half-width of the outline along the seat by depth, from Vitra's photo of the underside (scaled by the fit). */
const SEAT_WIDTH: Knots = [[0, 21.4], [9, 22.5], [18, 23.25], [27, 23.0], [33, 22.45]];
/** Heights up the back at which the fit matches the outline's half-width to the drawing's front view ... */
const WIDTH_AT = [49, 55, 61, 67, 73, 78];
/** ... and the wrap to the rims in its side view. */
const WRAP_AT = [55, 61, 67, 73];
/** Half-width of the outline at the top of the back, before its corners are rounded. */
const TOP_WIDTH = 12.8;
/** Depth of the transverse curvature at x = XREF: the seat dishes deeper towards the back (by depth), ... */
const SEAT_DISH: Knots = [[0, 0.4], [7, 0.3], [14, 1.2], [21, 2.5], [30, 4.9]];
const BEND_DISH = 5.3; // ... in the middle of the bend ...
const TOP_WRAP = 3.8; // ... and at the top of the back (the wrap in between is fitted).
/** Height of the rolled-up edges along the seat by depth, in the bend, up the back and at the top. */
const SEAT_EDGE: Knots = [[0, 0.8], [10, 1.0], [25, 1.1]];
const BEND_EDGE = 1.0;
const BACK_EDGE = 0.8;
const TOP_EDGE = 0.6;
/** The seat's underside at its lowest, in front of the bend (the drawing). */
const SEAT_LOW = 40.95;

interface Fit {
  /** Position of the centre line's front edge (cm). */
  z0: number;
  y0: number;
  /** t where the centre line's bend starts: sets how far back the back stands. */
  seat: number;
  /** Length of the centre line from the front edge to the top of the back: sets the height. */
  length: number;
  /** Scales SEAT_WIDTH: sets the overall width. */
  seatScale: number;
  /** The angle (degrees) the top edge curls back to: sets the depth. */
  curl: number;
  /** Half-width of the outline at the WIDTH_AT heights, and depth of the wrap at the WRAP_AT heights. */
  width: number[];
  wrap: number[];
}

function shellModel(fit: Fit) {
  const S = fit.length;
  const b0 = fit.seat;
  const b1 = b0 + BEND;
  const phiAt = (s: number, a: number, b: number) =>
    (PHI_TIP +
      (PHI_FALL - PHI_TIP) * step(s, 0, WATERFALL) +
      (PHI_SEAT - PHI_FALL) * step(s, WATERFALL, EASED) -
      PHI_SEAT * step(s, b0 - FLAT - SETTLE, b0 - FLAT) +
      PHI_BACK * ramp(s, a, b, BEND_EASE) +
      (PHI_UPPER - PHI_BACK) * step(s, b, S - TIP - CURL) +
      (fit.curl - PHI_UPPER) * step(s, S - TIP - CURL, S - TIP)) *
    DEG;

  /** The side profile of column q = (x / XREF)² at arc length s: position (from the front edge) and tangent angle. */
  const profile = (s: number, q: number) => {
    const a = b0 - BEND_EARLY * q;
    const b = b1 + BEND_LATE * q;
    const e = BEND_EASE * (b - a);
    const lo = Math.min(0, s);
    const hi = Math.max(0, s);
    const breaks = [WATERFALL, EASED, b0 - FLAT - SETTLE, b0 - FLAT, a, a + e, b - e, b, S - TIP - CURL, S - TIP, S];
    const cuts = [0, ...breaks.filter((c) => c > lo && c < hi).sort((u, v) => u - v), s];
    let z = 0;
    let y = 0;
    for (let k = 0; k + 1 < cuts.length; k++) {
      const h = (cuts[k + 1] - cuts[k]) / 2;
      const m = (cuts[k + 1] + cuts[k]) / 2;
      for (let i = 0; i < 8; i++) {
        const p = phiAt(m + h * GX[i], a, b);
        z -= Math.cos(p) * GW[i] * h;
        y += Math.sin(p) * GW[i] * h;
      }
    }
    return { z, y, phi: phiAt(s, a, b) };
  };

  // the centre line, to place the knots of the outline and the lift by depth (along the seat) and height (up the back)
  const DT = 0.1;
  const line: [t: number, depth: number, height: number][] = [];
  for (let t = 0; t <= S + DT / 2; t += DT) {
    const p = profile(t, 0);
    line.push([t, FRONT - fit.z0 - p.z, fit.y0 + p.y]);
  }
  /** The first t after `from` where the centre line's depth (k = 1) or height (k = 2) reaches v. */
  const find = (k: 1 | 2, v: number, from: number) => {
    for (let i = 1; i < line.length; i++) {
      if (line[i][0] <= from || line[i][k] < v) continue;
      const u = Math.min(1, Math.max(0, (v - line[i - 1][k]) / (line[i][k] - line[i - 1][k])));
      return line[i - 1][0] + u * DT;
    }
    return S;
  };
  const bySeat = (knots: Knots, scale = 1) => knots.map(([d, v]): [number, number] => [find(1, d, -1), v * scale]);
  const byBack = (heights: number[], values: number[]) => heights.map((h, k): [number, number] => [find(2, h, b0), values[k]]);
  const middle = b0 + BEND / 2;
  /** Half-width of the outline before the corners are rounded: no waist, it narrows steadily up the back. */
  const W = spline([...bySeat(SEAT_WIDTH, fit.seatScale), ...byBack(WIDTH_AT, fit.width), [S, TOP_WIDTH]]);
  /** Depth of the transverse curvature at x = XREF: the seat's dish, the wrap of the back. */
  const D = spline([...bySeat(SEAT_DISH), [middle, BEND_DISH], ...byBack(WRAP_AT, fit.wrap), [S, TOP_WRAP]]);
  /** Height of the rolled-up edges. */
  const E = spline([...bySeat(SEAT_EDGE), [middle, BEND_EDGE], [find(2, 65, b0), BACK_EDGE], [S, TOP_EDGE]]);

  /** Mid-surface of the wall. The lift goes along the profile's normal (sin φ, cos φ), towards the sitter. */
  const mid = (x: number, t: number): Vec => {
    const q = (x / XREF) ** 2;
    const s = t + FRONT_BOW * q * (1 - step(t, 0, 10)) - TOP_DIP * q * step(t, S - 22, S);
    const p = profile(s, q);
    const r = Math.abs(x) / W(t);
    const h = D(t) * q + E(t) * (r <= ROLL_START ? 0 : ((r - ROLL_START) / (1 - ROLL_START)) ** 3);
    return [x, fit.y0 + p.y + h * Math.cos(p.phi), fit.z0 + p.z + h * Math.sin(p.phi)];
  };

  /** Half-width of the outline at t, with the rounded corners. */
  const X = (t: number) => {
    let w = W(t);
    if (t < FRONT_CORNER) {
      const c = FRONT_CORNER - Math.max(t, 0);
      w += Math.sqrt(Math.max(0, FRONT_CORNER ** 2 - c * c)) - FRONT_CORNER;
    }
    if (t > S - TOP_CORNER) {
      const c = Math.min(t, S) - (S - TOP_CORNER);
      w += Math.sqrt(Math.max(0, TOP_CORNER ** 2 - c * c)) - TOP_CORNER;
    }
    return w;
  };
  /** Direction (dx, dt) of the right side of the outline, going up. */
  const sideTangent = (t: number): [number, number] => {
    const dW = (W(t + 1e-4) - W(t - 1e-4)) / 2e-4;
    let v: [number, number] = [dW, 1];
    if (t < FRONT_CORNER) {
      const c = FRONT_CORNER - t;
      const r = Math.sqrt(Math.max(0, FRONT_CORNER ** 2 - c * c));
      v = [dW * r + c, r];
    } else if (t > S - TOP_CORNER) {
      const c = t - (S - TOP_CORNER);
      const r = Math.sqrt(Math.max(0, TOP_CORNER ** 2 - c * c));
      v = [dW * r - c, r];
    }
    const l = Math.hypot(v[0], v[1]);
    return [v[0] / l, v[1] / l];
  };

  // right half of the outline, for the distance to the rim
  const half: [number, number][] = [[0, 0]];
  for (let t = 0; t < S; t += t < FRONT_CORNER + 1 || t > S - TOP_CORNER - 1 ? 0.1 : 0.4) half.push([X(t), t]);
  half.push([X(S), S], [0, S]);
  const rimDistance = (x: number, t: number) => {
    const ax = Math.abs(x);
    const far = RIM_BAND + 0.5;
    if (X(Math.min(Math.max(t, 0), S)) - ax > far && t > far && S - t > far) return Infinity;
    let best = Infinity;
    for (let i = 0; i + 1 < half.length; i++) {
      const [x0, t0] = half[i];
      const [x1, t1] = half[i + 1];
      const dx = x1 - x0;
      const dt = t1 - t0;
      const u = Math.min(1, Math.max(0, ((ax - x0) * dx + (t - t0) * dt) / (dx * dx + dt * dt)));
      best = Math.min(best, Math.hypot(ax - x0 - u * dx, t - t0 - u * dt));
    }
    return best;
  };

  const E1 = 1e-3;
  const normal = (x: number, t: number): Vec =>
    unit(cross(sub(mid(x + E1, t), mid(x - E1, t)), sub(mid(x, t + E1), mid(x, t - E1))));
  const wall = (x: number, t: number, side: 1 | -1) => {
    const d = rimDistance(x, t);
    const k = d >= RIM_BAND ? 0 : smoother(1 - d / RIM_BAND);
    return WALL / 2 + (side > 0 ? RIM_INSIDE : 1 - RIM_INSIDE) * (RIM - WALL) * k;
  };
  /** Sitter's side (+1) or outside (-1) of the shell. */
  const surface = (x: number, t: number, side: 1 | -1): Vec => add(mid(x, t), mul(normal(x, t), side * wall(x, t, side)));
  const surfaceNormal = (x: number, t: number, side: 1 | -1): Vec => {
    const n = normal(x, t);
    if (rimDistance(x, t) > RIM_BAND + 0.01) return mul(n, side);
    const e = 2e-3;
    const g = unit(cross(sub(surface(x + e, t, side), surface(x - e, t, side)), sub(surface(x, t + e, side), surface(x, t - e, side))));
    return dot(g, n) * side > 0 ? g : mul(g, -1);
  };
  return { S, b0, b1, find, mid, normal, surface, surfaceNormal, X, sideTangent };
}

type Shell = ReturnType<typeof shellModel>;

/** Rows along the profile: denser in the waterfall, the bend and the top corners. */
function rowsOf(sh: Shell): number[] {
  const density = (t: number) =>
    0.5 + 1.5 * (1 - step(t, 7, 11)) + 0.5 * step(t, sh.b0 - 14, sh.b0 - 8) * (1 - step(t, sh.b1 + 10, sh.b1 + 18)) + 1.2 * step(t, sh.S - 10, sh.S - 6);
  const n = 2000;
  const cum = [0];
  for (let i = 1; i <= n; i++) cum.push(cum[i - 1] + (density(((i - 0.5) / n) * sh.S) * sh.S) / n);
  const count = Math.round(cum[n]);
  const rows: number[] = [];
  let k = 0;
  for (let j = 0; j <= count; j++) {
    const target = (j / count) * cum[n];
    while (k < n - 1 && cum[k + 1] < target) k++;
    rows.push(((k + (target - cum[k]) / (cum[k + 1] - cum[k])) / n) * sh.S);
  }
  rows[0] = 0;
  rows[count] = sh.S;
  return rows;
}

/** Columns across, as a share of the half-width: denser towards the rolled edges. */
const COLUMNS = 34;
const columns = Array.from({ length: COLUMNS + 1 }, (_, i) => {
  const u = -1 + (2 * i) / COLUMNS;
  return 0.6 * u + 0.4 * Math.sin((u * Math.PI) / 2);
});

interface Built {
  positions: ArrayLike<number>;
  normals: number[];
  indices: ArrayLike<number>;
}

/** The closed shell: sitter's side, outside and the rolled rim, as one smooth indexed mesh. */
function buildShell(sh: Shell, withNormals: boolean): Built & { positions: number[]; indices: number[] } {
  const rows = rowsOf(sh);
  const I = COLUMNS;
  const J = rows.length - 1;
  const positions: number[] = [];
  const normals: number[] = [];
  const push = (p: Vec, n: Vec) => {
    positions.push(...p);
    normals.push(...n);
  };
  const design = (i: number, j: number): [number, number] => [columns[i] * sh.X(rows[j]), rows[j]];
  for (const side of [1, -1] as const) {
    for (let j = 0; j <= J; j++) {
      for (let i = 0; i <= I; i++) {
        const [x, t] = design(i, j);
        push(sh.surface(x, t, side), withNormals ? sh.surfaceNormal(x, t, side) : [0, 1, 0]);
      }
    }
  }
  const top = (i: number, j: number) => j * (I + 1) + i;
  const bottom = (i: number, j: number) => (J + 1) * (I + 1) + j * (I + 1) + i;

  // the rim: around the outline counter-clockwise in (x, t), front edge first
  const loop: { i: number; j: number; tangent: [number, number] }[] = [];
  for (let i = 0; i < I; i++) loop.push({ i, j: 0, tangent: [1, 0] });
  for (let j = 0; j < J; j++) loop.push({ i: I, j, tangent: sh.sideTangent(rows[j]) });
  for (let i = I; i > 0; i--) loop.push({ i, j: J, tangent: [-1, 0] });
  for (let j = J; j > 0; j--) {
    const [dx, dt] = sh.sideTangent(rows[j]);
    loop.push({ i: 0, j, tangent: [dx, -dt] });
  }
  const rimStart = positions.length / 3;
  const inner = RIM_SEGMENTS - 1;
  const tTop = WALL / 2 + RIM_INSIDE * (RIM - WALL);
  const tBot = WALL / 2 + (1 - RIM_INSIDE) * (RIM - WALL);
  for (const { i, j, tangent } of loop) {
    const [x, t] = design(i, j);
    const B = sh.mid(x, t);
    const n = sh.normal(x, t);
    const e = 1e-3;
    const mx = sub(sh.mid(x + e, t), sh.mid(x - e, t));
    const mt = sub(sh.mid(x, t + e), sh.mid(x, t - e));
    // outward in the design plane: the tangent turned clockwise
    const o = add(mul(mx, tangent[1]), mul(mt, -tangent[0]));
    const b = unit(sub(o, mul(n, dot(o, n))));
    const center = add(B, mul(n, (tTop - tBot) / 2));
    const a = (tTop + tBot) / 2;
    for (let k = 1; k <= inner; k++) {
      const th = (Math.PI * k) / RIM_SEGMENTS;
      push(add(center, add(mul(n, a * Math.cos(th)), mul(b, a * Math.sin(th)))), unit(add(mul(n, Math.cos(th)), mul(b, Math.sin(th)))));
    }
  }

  const indices: number[] = [];
  const at = (k: number): Vec => [positions[3 * k], positions[3 * k + 1], positions[3 * k + 2]];
  const nAt = (k: number): Vec => [normals[3 * k], normals[3 * k + 1], normals[3 * k + 2]];
  // wind every triangle so that it faces along its vertex normals
  const tri = (a: number, b: number, c: number) => {
    const f = cross(sub(at(b), at(a)), sub(at(c), at(a)));
    if (withNormals && dot(f, add(nAt(a), add(nAt(b), nAt(c)))) < 0) indices.push(a, c, b);
    else indices.push(a, b, c);
  };
  for (let j = 0; j < J; j++) {
    for (let i = 0; i < I; i++) {
      tri(top(i, j), top(i + 1, j), top(i + 1, j + 1));
      tri(top(i, j), top(i + 1, j + 1), top(i, j + 1));
      tri(bottom(i, j), bottom(i + 1, j + 1), bottom(i + 1, j));
      tri(bottom(i, j), bottom(i, j + 1), bottom(i + 1, j + 1));
    }
  }
  const ring = (k: number, m: number) => {
    const { i, j } = loop[k % loop.length];
    if (m === 0) return top(i, j);
    if (m === RIM_SEGMENTS) return bottom(i, j);
    return rimStart + (k % loop.length) * inner + (m - 1);
  };
  for (let k = 0; k < loop.length; k++) {
    for (let m = 0; m < RIM_SEGMENTS; m++) {
      tri(ring(k, m), ring(k, m + 1), ring(k + 1, m + 1));
      tri(ring(k, m), ring(k + 1, m + 1), ring(k + 1, m));
    }
  }
  return { positions, normals, indices };
}

function bounds(positions: ArrayLike<number>) {
  const min: Vec = [Infinity, Infinity, Infinity];
  const max: Vec = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i + k]);
      max[k] = Math.max(max[k], positions[i + k]);
    }
  }
  return { min, max };
}

/** Every point where a triangle edge of the mesh crosses the plane where coordinate `axis` is v. */
function crossings(m: Built, axis: 1 | 2, v: number, visit: (p: Vec) => void) {
  const P = m.positions;
  const I = m.indices;
  for (let i = 0; i < I.length; i += 3) {
    for (let e = 0; e < 3; e++) {
      const a = 3 * I[i + e];
      const b = 3 * I[i + ((e + 1) % 3)];
      const da = P[a + axis] - v;
      const db = P[b + axis] - v;
      if (da * db > 0 || da === db) continue;
      const u = da / (da - db);
      visit([P[a] + u * (P[b] - P[a]), P[a + 1] + u * (P[b + 1] - P[a + 1]), P[a + 2] + u * (P[b + 2] - P[a + 2])]);
    }
  }
}
/** The shell at height y: its half-width seen from the front, and seen from the side the depth of its frontmost and rearmost points. */
function across(m: Built, y: number) {
  let halfWidth = 0;
  let zMin = Infinity;
  let zMax = -Infinity;
  crossings(m, 1, y, (p) => {
    halfWidth = Math.max(halfWidth, Math.abs(p[0]));
    zMin = Math.min(zMin, p[2]);
    zMax = Math.max(zMax, p[2]);
  });
  return { halfWidth, front: FRONT - zMax, back: FRONT - zMin };
}
/** The shell at a depth behind the front edge: its top and bottom, as in the side view. */
function along(m: Built, depth: number) {
  let top = -Infinity;
  let bottom = Infinity;
  crossings(m, 2, FRONT - depth, (p) => {
    top = Math.max(top, p[1]);
    bottom = Math.min(bottom, p[1]);
  });
  return { top, bottom };
}

// ---- fit the shell to the drawing: front edge, the seat's underside, the outside of the back, height and width ----
const drawn = (h: number) => {
  const row = DRAWING_BACK.find(([y]) => y === h);
  if (!row) throw new Error(`no drawing row at ${h} cm`);
  return { halfWidth: row[1], rims: row[2], back: row[3] };
};
const BACK_ROWS = DRAWING_BACK.filter(([h]) => h >= 53 && h <= 78);
let fit: Fit = { z0: 27, y0: 42.5, seat: 37, length: 87, seatScale: 1, curl: 45, width: WIDTH_AT.map((h) => drawn(h).halfWidth), wrap: WRAP_AT.map(() => 5.5) };
let iterations = 0;
let residual = Infinity;
for (; iterations < 80; iterations++) {
  const m = buildShell(shellModel(fit), false);
  const { min, max } = bounds(m.positions);
  const err = {
    front: FRONT - max[2],
    low: SEAT_LOW - min[1],
    top: SIZE.height - max[1],
    depth: SIZE.depth - (max[2] - min[2]),
    back: BACK_ROWS.reduce((sum, [h, , , back]) => sum + back - across(m, h).back, 0) / BACK_ROWS.length,
    width: SIZE.width / 2 - Math.max(max[0], -min[0]),
  };
  const width = WIDTH_AT.map((h) => drawn(h).halfWidth - across(m, h).halfWidth);
  const wrap = WRAP_AT.map((h) => across(m, h).front - drawn(h).rims);
  residual = Math.max(...Object.values(err).map(Math.abs), ...width.map(Math.abs), ...wrap.map(Math.abs));
  if (residual < 2e-3) break;
  fit = {
    z0: fit.z0 + err.front,
    y0: fit.y0 + err.low,
    seat: fit.seat + err.back,
    length: fit.length + err.top / 0.8,
    seatScale: fit.seatScale * (1 + err.width / (SIZE.width / 2)),
    curl: Math.min(79, Math.max(15, fit.curl - 15 * err.depth)),
    width: fit.width.map((w, k) => w + 0.8 * width[k]),
    wrap: fit.wrap.map((d, k) => Math.max(0, d + (0.8 * wrap[k]) / (fit.width[k] / XREF) ** 2)),
  };
}
const shell = shellModel(fit);
const shellData = buildShell(shell, true);
const shellGeometry = new BufferGeometry();
shellGeometry.setAttribute("position", new Float32BufferAttribute(shellData.positions, 3));
shellGeometry.setAttribute("normal", new Float32BufferAttribute(shellData.normals, 3));
shellGeometry.setIndex(shellData.indices);

// ---- the Eiffel base (cm) ----
const shellMesh = new Mesh(shellGeometry, new MeshStandardMaterial());
/** Height of the shell's underside above (x, z). */
const underside = (x: number, z: number) => {
  const hit = new Raycaster(new Vector3(x, 0, z), new Vector3(0, 1, 0)).intersectObject(shellMesh)[0];
  if (!hit) throw new Error(`no shell above (${x}, ${z})`);
  return hit.point.y;
};

const LEG = 0.42; // legs and runners
const WIRE = 0.3; // belt and struts
const MOUNT = { radius: 1.5, height: 1.4 }; // shock mounts: from the runner's axis up to the shell
const RUNNER_X = 7.5; // the runners lie close together under the seat (the drawing's front view)
const MOUNT_Z = [FRONT - 16.5, FRONT - 33.8]; // front and back shock mounts, where the legs meet the runners
const FOOT = { x: 18.85, z: [FRONT - 5.85, FRONT - 47.3], height: 0.9 }; // glides, where the drawing has them
const BELT = 16;

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

const pieces: BufferGeometry[] = [];
const runnerHeight = MOUNT_Z.map((z) => Math.min(underside(RUNNER_X, z), underside(-RUNNER_X, z)) - MOUNT.height);
for (const sx of [1, -1]) {
  const foot = FOOT.z.map((z): Vec => [sx * FOOT.x, FOOT.height, z]);
  const head = MOUNT_Z.map((z, k): Vec => [sx * RUNNER_X, runnerHeight[k], z]);
  const belt = foot.map((f, k) => add(f, mul(sub(head[k], f), (BELT - f[1]) / (head[k][1] - f[1]))));
  // front leg, runner and back leg are one bent rod
  pieces.push(wire(bent([foot[0], head[0], head[1], foot[1]], 1.2), LEG, 12));
  pieces.push(wire([belt[0], belt[1]], WIRE, 8)); // side belt
  pieces.push(wire([belt[0], head[1]], WIRE, 8), wire([belt[1], head[0]], WIRE, 8)); // crossed side struts
  for (const k of [0, 1]) {
    pieces.push(wire([belt[k], [-head[k][0], head[k][1], head[k][2]]], WIRE, 8)); // crossed front and back struts
    if (sx > 0) pieces.push(wire([belt[k], [-belt[k][0], belt[k][1], belt[k][2]]], WIRE, 8)); // front and back belt
  }
  for (const b of belt) pieces.push(new SphereGeometry(0.5, 10, 6).translate(b[0], b[1], b[2]));
  for (const [k, h] of head.entries()) {
    // up into the wall's underside, but nowhere through the wall
    let top = Infinity;
    for (let a = 0; a < 12; a++) top = Math.min(top, underside(h[0] + MOUNT.radius * Math.cos((a * Math.PI) / 6), h[2] + MOUNT.radius * Math.sin((a * Math.PI) / 6)));
    top += 0.1;
    pieces.push(new CylinderGeometry(MOUNT.radius, MOUNT.radius, top - h[1], 20).translate(h[0], (top + h[1]) / 2, h[2]));
    const glide = new LatheGeometry(
      [
        [0, 0],
        [1.1, 0],
        [1.2, 0.15],
        [1.2, 0.45],
        [1.0, 0.8],
        [0.6, FOOT.height],
        [0, FOOT.height],
      ].map(([r, y]) => new Vector2(r, y)),
      20,
    );
    pieces.push(glide.translate(foot[k][0], 0, foot[k][2]));
  }
}
for (const g of pieces) g.deleteAttribute("uv");
const baseGeometry = mergeGeometries(pieces);
if (!baseGeometry) throw new Error("could not merge the base");

// ---- exact fit to the dimensions (corrects the last fraction of a millimetre), then metres ----
const box = bounds([...shellData.positions, ...Array.from(baseGeometry.getAttribute("position").array)]);
const target = { min: [-SIZE.width / 2, 0, -SIZE.depth / 2], max: [SIZE.width / 2, SIZE.height, SIZE.depth / 2] };
const factor = [0, 1, 2].map((k) => (target.max[k] - target.min[k]) / (box.max[k] - box.min[k]));
for (const g of [shellGeometry, baseGeometry]) {
  const pos = g.getAttribute("position");
  const nrm = g.getAttribute("normal");
  for (let i = 0; i < pos.count; i++) {
    for (let k = 0; k < 3; k++) pos.setComponent(i, k, ((pos.getComponent(i, k) - box.min[k]) * factor[k] + target.min[k]) / 100);
    const n = unit([nrm.getX(i) / factor[0], nrm.getY(i) / factor[1], nrm.getZ(i) / factor[2]]);
    nrm.setXYZ(i, n[0], n[1], n[2]);
  }
}

const chair = new Group();
chair.name = "dining-chair-eames-dsr";
const shellOut = new Mesh(shellGeometry, new MeshStandardMaterial({ name: "Shell", color: "#1a1a1a", roughness: 0.42 }));
shellOut.name = "shell";
const baseOut = new Mesh(baseGeometry, new MeshStandardMaterial({ name: "Base", color: "#1e1e1e", roughness: 0.5, metalness: 0.6 }));
baseOut.name = "base";
chair.add(shellOut, baseOut);

const out = resolve(import.meta.dirname, "..", "..", "catalogue", "dining-chair-eames-dsr", "model.glb");
mkdirSync(resolve(out, ".."), { recursive: true });
const glb = (await new GLTFExporter().parseAsync(chair, { binary: true })) as ArrayBuffer;
writeFileSync(out, Buffer.from(glb));

// ---- report: the fit, the shape next to the drawing (final geometry, cm), collision parts for item.json ----
const cm = (v: number) => v.toFixed(1);
const inCm = (g: BufferGeometry): Built => ({
  positions: Array.from(g.getAttribute("position").array, (v) => v * 100),
  normals: [],
  indices: Array.from(g.getIndex()?.array ?? []),
});
const final = inCm(shellGeometry);
const baseCm = inCm(baseGeometry);
console.log(
  `fit after ${iterations} rounds (largest residual ${residual.toExponential(1)} cm): bend from ${cm(fit.seat)} cm along the centre line, which is ${cm(fit.length)} cm long; the top curls back to ${cm(90 - fit.curl)}° from vertical`,
);
console.log(`exact fit: ×${factor.map((f) => f.toFixed(4)).join(", ")} (x, y, z)`);
{
  const t18 = shell.find(1, 18, -1);
  console.log(`seat surface in the middle, 18 cm behind the front edge: ${cm(shell.surface(0, t18, 1)[1] * factor[1] + (target.min[1] - box.min[1] * factor[1]))} cm (Vitra: seat height 43)`);
}
console.log("\nseen from the front and the side, up the back (model / drawing, cm)\n  height  half-width     rims (depth)   outside of the back (depth)");
for (const [h, w, rims, back] of DRAWING_BACK) {
  const c = across(final, h);
  console.log(`  ${String(h).padStart(4)}    ${cm(c.halfWidth).padStart(4)} / ${cm(w).padStart(4)}    ${cm(c.front).padStart(4)} / ${cm(rims).padStart(4)}    ${cm(c.back).padStart(4)} / ${cm(back)}`);
}
console.log("\nseen from the side, along the seat (model / drawing, cm)\n  depth   rims (height)   underside (height)");
const depths = [...new Set([...DRAWING_RIMS.map(([d]) => d), ...DRAWING_UNDERSIDE.map(([d]) => d)])].sort((a, b) => a - b);
for (const d of depths) {
  const c = along(final, d);
  const rim = DRAWING_RIMS.find(([x]) => x === d)?.[1];
  const low = DRAWING_UNDERSIDE.find(([x]) => x === d)?.[1];
  console.log(`  ${String(d).padStart(5)}   ${rim === undefined ? "      -      " : `${cm(c.top)} / ${cm(rim)}`}   ${low === undefined ? "" : `${cm(c.bottom)} / ${cm(low)}`}`);
}

{
  // collision parts: the seat as an extrusion up to SEAT_TOP, the back as curved slabs (lathes), the base as a box
  const SEAT_TOP = 50;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const points = (m: Built, keep: (p: Vec) => boolean) => {
    const out: Vec[] = [];
    for (let i = 0; i < m.positions.length; i += 3) {
      const p: Vec = [m.positions[i], m.positions[i + 1], m.positions[i + 2]];
      if (keep(p)) out.push(p);
    }
    return out;
  };
  /** Convex hull in (x, z), simplified to at most n corners (dropping those that cut off the least area). */
  const hull = (ps: [number, number][], n: number) => {
    const s = [...ps].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const turn = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower: [number, number][] = [];
    for (const p of s) {
      while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
      lower.push(p);
    }
    const upper: [number, number][] = [];
    for (const p of [...s].reverse()) {
      while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
      upper.push(p);
    }
    const h = [...lower.slice(0, -1), ...upper.slice(0, -1)];
    while (h.length > n) {
      let best = 0;
      let area = Infinity;
      for (let i = 0; i < h.length; i++) {
        const a = Math.abs(turn(h[(i + h.length - 1) % h.length], h[i], h[(i + 1) % h.length]));
        if (a < area) [area, best] = [a, i];
      }
      h.splice(best, 1);
    }
    return h;
  };
  const seat = points(final, (p) => p[1] <= SEAT_TOP);
  const seatLow = Math.min(...seat.map((p) => p[1]));
  const LOWER_BACK = 60;
  const lowerBack = points(final, (p) => p[1] >= SEAT_TOP && p[1] <= LOWER_BACK);
  const parts: object[] = [
    {
      name: "seat",
      shape: "extrusion",
      points: hull(seat.map((p) => [p[0], p[2]]), 22).map(([x, z]) => [r1(x), r1(z)]),
      height: r1(SEAT_TOP - Math.floor(seatLow * 10) / 10),
      position: { x: 0, y: Math.floor(seatLow * 10) / 10, z: 0 },
      material: "shell",
    },
    {
      // the rims still sweep forward here: a convex block, tight on the outside of the back
      name: "backrest, lower",
      shape: "extrusion",
      points: hull(lowerBack.map((p) => [p[0], p[2]]), 16).map(([x, z]) => [r1(x), r1(z)]),
      height: LOWER_BACK - SEAT_TOP,
      position: { x: 0, y: SEAT_TOP, z: 0 },
      material: "shell",
    },
  ];
  const bands = [
    ["backrest, middle", LOWER_BACK, 70],
    ["backrest, upper", 70, SIZE.height],
  ] as const;
  for (const [name, lo, hi] of bands) {
    const ps = points(final, (p) => p[1] >= lo && p[1] <= hi);
    // the axis (on the centre plane) that makes the slab thinnest without reaching out of the item's box
    let best = { c: 0, rin: 0, rout: 0, from: 0, to: 0, cost: Infinity };
    for (let c = -10; c <= 200; c += 0.25) {
      let rin = Infinity;
      let rout = 0;
      let from = Infinity;
      let to = -Infinity;
      for (const p of ps) {
        const r = Math.hypot(p[0], p[2] - c);
        const a = ((Math.atan2(p[2] - c, p[0]) / DEG) % 360 + 360) % 360;
        rin = Math.min(rin, r);
        rout = Math.max(rout, r);
        from = Math.min(from, a);
        to = Math.max(to, a);
      }
      // the slab's outer corners lie at rout at both ends of the arc, its back at rout straight behind the axis;
      // up to 0.4 cm beyond the item's box is fine (the app ignores overlaps of up to 0.5 cm)
      const sides = Math.max(Math.abs(Math.cos(from * DEG)), Math.abs(Math.cos(to * DEG))) * rout - SIZE.width / 2 - 0.4;
      const rear = -FRONT - (c - rout) - 0.4;
      const cost = rout - rin + 10 * (Math.max(0, sides) + Math.max(0, rear));
      if (cost < best.cost) best = { c, rin, rout, from, to, cost };
    }
    const rin = Math.floor(best.rin * 10) / 10;
    const rout = Math.ceil(best.rout * 10) / 10;
    parts.push({
      name,
      shape: "lathe",
      profile: [[rin, 0], [rout, 0], [rout, hi - lo], [rin, hi - lo], [rin, 0]],
      arc: r1(best.to - best.from + 0.2),
      position: { x: 0, y: lo, z: r1(best.c) },
      rotation: { y: r1(best.from - 0.1) },
      material: "shell",
    });
  }
  const b = bounds(baseCm.positions);
  const top = Math.floor(b.max[1] * 10) / 10;
  parts.push({
    name: "base",
    shape: "box",
    size: { x: r1(b.max[0] - b.min[0]), y: top, z: r1(b.max[2] - b.min[2]) },
    position: { x: 0, y: r1(top / 2), z: r1((b.max[2] + b.min[2]) / 2) },
    material: "base",
  });
  console.log(`\ncollision parts for item.json:\n${JSON.stringify(parts)}`);
}
console.log(`\nshell ${shellData.positions.length / 3} vertices, ${shellData.indices.length / 3} triangles; base ${baseGeometry.getAttribute("position").count} vertices`);
console.log(`wrote ${out} (${glb.byteLength} bytes)`);
