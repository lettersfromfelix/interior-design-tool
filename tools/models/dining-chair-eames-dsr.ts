/**
 * npx tsx tools/models/dining-chair-eames-dsr.ts — writes catalogue/dining-chair-eames-dsr/model.glb, built from its
 * own geometry (no third-party assets): the Vitra Eames Plastic Side Chair DSR, a moulded one-piece shell on an
 * Eiffel wire base.
 *
 * The shell is a parametric surface over (x, t): x across the width, t along the side profile from the front edge of
 * the seat, through the bend into the back, up to the top of the back. Every column x has its own side profile (the
 * bend is tighter in the middle than at the sides, so the rim sweeps from the seat into the back in a wide curve)
 * and is lifted towards the sitter: the seat is dished, the back wraps around the sitter and the edges roll up. The
 * surface is offset to both sides (4.5 mm wall) and closed by a rolled rim of 1 cm, so the shell is one smooth solid.
 *
 * The base follows the earlier parametric version of the item: four splayed legs that meet two runners under the
 * seat, a belt 16 cm above the floor, crossed struts on all four sides, shock mounts and glides.
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
const SEAT_HEIGHT = 43;

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
const PHI_FRONT = 28; // the front edge rolls down (waterfall) ...
const WATERFALL = 7; // ... over this length
const PHI_SEAT = -5; // the seat falls slightly towards the back
const PHI_SEAT_END = -1; // and flattens out before the bend
const BEND = 15; // length of the bend into the back on the centre line
const BEND_EARLY = 9; // at the sides the bend starts earlier ...
const BEND_LATE = 14; // ... and ends later, so the rim sweeps from the seat into the back
const PHI_BACK = 78; // the back after the bend (12° from vertical) ...
const PHI_TOP = 73; // ... and at the top (17°): on average it leans back about 14°
const FRONT_BOW = 1.5; // the front edge bows forward in the middle
const TOP_DIP = 2.5; // the top edge's corners are set back down the profile a little
const FRONT_CORNER = 9.5; // radius of the seat's front corners (seen from above)
const TOP_CORNER = 7; // radius of the back's top corners
const ROLL_START = 0.62; // the edges roll up over the outer 38 % of the half-width

interface Fit {
  /** Position of the centre line's front edge (cm). */
  z0: number;
  y0: number;
  /** t where the bend into the back starts on the centre line: sets the seat depth. */
  seat: number;
  /** Length of the centre line from the front edge to the top of the back: sets the height. */
  length: number;
  /** Scales the half-width: sets the overall width. */
  width: number;
}

function shellModel(fit: Fit) {
  const S = fit.length;
  const b0 = fit.seat;
  const b1 = fit.seat + BEND;
  /** Half-width of the outline before the corners are rounded; narrowest at the waist. */
  const W = spline(
    (
      [
        [0, 21.4],
        [7, 22.2],
        [14, 22.4],
        [b0 - 6, 21.6],
        [b1, 19.7],
        [b1 + 14, 21.0],
        [S - 12, 22.6],
        [S, 22.8],
      ] as const
    ).map(([t, w]) => [t, w * fit.width] as const),
  );
  /** Depth of the transverse curvature at x = XREF: a shallow dish in the seat, the wrap of the back. */
  const D = spline([
    [0, 0.8],
    [10, 1.1],
    [b0 - 2, 1.9],
    [b1, 3.6],
    [b1 + 12, 5.2],
    [S, 6.0],
  ]);
  /** Height of the rolled-up edges. */
  const E = spline([
    [0, 0.8],
    [10, 1.4],
    [b0, 2.7],
    [b1, 2.3],
    [b1 + 12, 1.5],
    [S, 1.2],
  ]);

  const phiAt = (s: number, a: number, b: number) =>
    (PHI_FRONT +
      (PHI_SEAT - PHI_FRONT) * step(s, 0, WATERFALL) +
      (PHI_SEAT_END - PHI_SEAT) * step(s, WATERFALL, b0) +
      (PHI_BACK - PHI_SEAT_END) * step(s, a, b) +
      (PHI_TOP - PHI_BACK) * step(s, b, S)) *
    DEG;

  /** The side profile of column q = (x / XREF)² at arc length s: position (from the front edge) and tangent angle. */
  const profile = (s: number, q: number) => {
    const a = b0 - BEND_EARLY * q;
    const b = b1 + BEND_LATE * q;
    const lo = Math.min(0, s);
    const hi = Math.max(0, s);
    const cuts = [0, ...[WATERFALL, b0, a, b, S].filter((c) => c > lo && c < hi).sort((u, v) => u - v), s];
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
  return { S, b0, b1, mid, normal, surface, surfaceNormal, X, sideTangent };
}

type Shell = ReturnType<typeof shellModel>;

/** Rows along the profile: denser in the waterfall, the bend and the top corners. */
function rowsOf(sh: Shell): number[] {
  const density = (t: number) =>
    0.5 + 1.5 * (1 - step(t, 5, 9)) + 0.5 * step(t, sh.b0 - 14, sh.b0 - 8) * (1 - step(t, sh.b1 + 10, sh.b1 + 18)) + 1.2 * step(t, sh.S - 9, sh.S - 5);
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
  positions: number[];
  normals: number[];
  indices: number[];
}

/** The closed shell: sitter's side, outside and the rolled rim, as one smooth indexed mesh. */
function buildShell(sh: Shell, withNormals: boolean): Built {
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

/** Highest point of the sitter's side along the centre line of the seat (the seat height). */
const seatHeight = (sh: Shell) => {
  let best = -Infinity;
  for (let t = 0; t < sh.b0; t += 0.05) best = Math.max(best, sh.surface(0, t, 1)[1]);
  return best;
};

// ---- fit the shell to the dimensions: front edge at +depth/2, seat height, depth, height and width ----
let fit: Fit = { z0: 25, y0: 41, seat: 33, length: 84, width: 1 };
for (let it = 0; it < 30; it++) {
  const sh = shellModel(fit);
  const { min, max } = bounds(buildShell(sh, false).positions);
  const halfWidth = Math.max(max[0], -min[0]);
  const err = [SIZE.depth / 2 - max[2], SIZE.depth - (max[2] - min[2]), SEAT_HEIGHT - seatHeight(sh), SIZE.height - max[1]];
  if (err.every((e) => Math.abs(e) < 1e-4) && Math.abs(halfWidth - SIZE.width / 2) < 1e-4) break;
  fit = {
    z0: fit.z0 + err[0],
    seat: fit.seat + err[1],
    y0: fit.y0 + err[2],
    length: fit.length + (err[3] - err[2]) / 0.95,
    width: (fit.width * SIZE.width) / 2 / halfWidth,
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
const RUNNER_X = 11.5;
const MOUNT_Z = [13, -8]; // front and back shock mounts, where the legs meet the runners
const FOOT = { x: 20.3, z: [21.5, -17.5], height: 0.9 }; // glides
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

const cm = (v: number) => v.toFixed(2);
console.log(`fit: bend at ${cm(fit.seat)} cm, centre line ${cm(fit.length)} cm, width ×${fit.width.toFixed(4)}`);
console.log(
  `bounds before the exact fit: x ${cm(box.min[0])}..${cm(box.max[0])}, y ${cm(box.min[1])}..${cm(box.max[1])}, z ${cm(box.min[2])}..${cm(box.max[2])} (×${factor.map((f) => f.toFixed(5)).join(", ")})`,
);
console.log(`seat height ${cm(seatHeight(shell))}; runners at ${runnerHeight.map(cm).join(" (front), ")} (back)`);
{
  // seat depth: front edge to the back's sitter side, 10 cm above the seat (raw cm frame, before the exact fit)
  const backAt = (y: number) => {
    let z = Infinity;
    for (let t = shell.b0; t < shell.S; t += 0.02) {
      const p = shell.surface(0, t, 1);
      if (Math.abs(p[1] - y) < 0.05) z = Math.min(z, p[2]);
    }
    return z;
  };
  console.log(`seat depth (to the back, 10 cm above the seat) ${cm(SIZE.depth / 2 - backAt(SEAT_HEIGHT + 10))}`);
}
console.log(`shell ${shellData.positions.length / 3} vertices, ${shellData.indices.length / 3} triangles; base ${baseGeometry.getAttribute("position").count} vertices`);
console.log(`wrote ${out} (${glb.byteLength} bytes)`);
