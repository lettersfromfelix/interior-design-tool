/**
 * npx tsx tools/models/designwerk-passion.ts — writes catalogue/armchair-designwerk-passion-100/ and
 * catalogue/sofa-designwerk-passion-160/ (model.glb and item.json each), built from their own geometry (no third-party
 * assets): two modules of Designwerk's Passion modular sofa, the armchair (the single-seat module, 100 wide) and the
 * 2-sofa (the two-seat module, 160 wide). One builder makes both from the width and the number of sections.
 *
 * Sizes: Designwerk's Passion leaflet (designwerk.li/wp-content/uploads/2026/06/produktflyer-passion-05-2026-en.pdf),
 * page 4, the type plan: the armchair incl. 1 MBA (item D140100B) is 100 × 118 × 83 cm, the 2-sofa incl. 1 MBA
 * (D140200B) 160 × 118 × 83, both with a seat height of 43 and a seat depth of 76 or 59: the manual back adjustment
 * (MBA) moves the back. Page 3: plastic feet 25 mm high, almost invisible.
 *
 * Shape, after the type plan and Designwerk's photos; the modules have no arms:
 * - the seat: one plump body on the feet, widest at the stitched edge of its seat cushion, narrowing towards the floor
 *   (the fabric gathered there); its cushion split by stitched seams into sections that dome between them (two on the
 *   armchair, three on the 2-sofa), the seams running over the top and down the front and the back;
 * - the back: a tall cushion leaning back, its sections matching the seat's, each a pillow over a lumbar roll, its top
 *   edge dipping at the seams. It is shown pushed back, the seat 76 deep, as on the type plan.
 *
 * Built in cm in the catalogue frame (x right as seen from the front, y up, the front faces +z) and exported in metres.
 * The materials are "Upholstery" and "Feet"; each item.json maps them to its material slots.
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
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const gauss = (d: number, sigma: number) => Math.exp(-(d * d) / (2 * sigma * sigma));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const dist = (a: P2, b: P2) => Math.hypot(b[0] - a[0], b[1] - a[1]);

// ---- sizes (cm), the same for both modules ----
const D = 118;
const H = 83;
const SEAT_H = 43;
const SEAT_DEPTH = 76; // the back pushed back; 59 with it pulled forward
const FOOT = { r: 2.2, h: 2.5 };

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

/** A body's side wall, from its lower face up to its upper face: how far in from the widest outline at each height. */
interface WallPoint {
  d: number; // inset
  y: number; // height
  phi: number; // the surface normal's angle up from the horizontal (outwards), −90° at the lower face, 90° at the upper
}
/**
 * The wall through the control points [inset, height], smoothed and resampled about every `step` cm (`fine` where
 * `dense(y)`), with the normal's angle at each point.
 */
function wall(ctrl: P2[], step: number, fine = step, dense: (y: number) => boolean = () => false): WallPoint[] {
  const line = openSpline(ctrl, 12);
  const cum = [0];
  for (let i = 1; i < line.length; i++) {
    const w = dense(line[i - 1][1]) || dense(line[i][1]) ? step / fine : 1;
    cum.push(cum[i - 1] + dist(line[i - 1], line[i]) * w);
  }
  const n = Math.max(2, Math.round(cum[cum.length - 1] / step));
  const pts: P2[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * cum[cum.length - 1];
    while (j < line.length - 2 && cum[j + 1] < t) j++;
    const f = (t - cum[j]) / (cum[j + 1] - cum[j] || 1);
    pts.push([lerp(line[j][0], line[j + 1][0], f), lerp(line[j][1], line[j + 1][1], f)]);
  }
  return pts.map(([d, y], k) => {
    if (k === 0) return { d, y, phi: -Math.PI / 2 };
    if (k === pts.length - 1) return { d, y, phi: Math.PI / 2 };
    const [a, b] = [pts[k - 1], pts[k + 1]];
    return { d, y, phi: Math.atan2(b[0] - a[0], b[1] - a[1]) };
  });
}

/** A rounded rectangle in a plane: points, their outward normals, the length along it, and its medial segment. */
interface Outline {
  pts: P2[];
  nrm: P2[];
  arc: number[];
  a: number; // the medial segment runs from (−a, c) to (a, c)
  c: number;
}
/**
 * A rounded rectangle centred on (0, cv), half-sizes hu and hv, corner radius R. Its two straight sides along u are
 * sampled at the same positions `us` (from −(hu − R) to hu − R), so that faces shrunk onto the medial segment close up
 * (see `body`); its ends at `vs` (from −(hv − R) to hv − R, from the centre).
 */
function roundedRect(hu: number, hv: number, cv: number, R: number, us: number[], vs: number[], step: number): Outline {
  const pts: P2[] = [];
  const nrm: P2[] = [];
  const a = hu - R;
  const push = (p: P2, n: P2) => {
    pts.push(p);
    nrm.push(n);
  };
  const corner = (cu: number, cvv: number, a0: number, a1: number) => {
    const n = Math.max(2, Math.ceil((Math.abs(a1 - a0) * R) / step));
    for (let i = 1; i < n; i++) {
      const t = a0 + ((a1 - a0) * i) / n;
      push([cu + R * Math.cos(t), cvv + R * Math.sin(t)], [Math.cos(t), Math.sin(t)]);
    }
  };
  for (const u of us) push([u, cv + hv], [0, 1]);
  corner(a, cv + hv - R, Math.PI / 2, 0);
  for (const v of [...vs].reverse()) push([hu, cv + v], [1, 0]);
  corner(a, cv - hv + R, 0, -Math.PI / 2);
  for (const u of [...us].reverse()) push([u, cv - hv], [0, -1]);
  corner(-a, cv - hv + R, -Math.PI / 2, -Math.PI);
  for (const v of vs) push([-hu, cv + v], [-1, 0]);
  corner(-a, cv + hv - R, Math.PI, Math.PI / 2);
  const arc = [0];
  for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, nrm, arc, a, c: cv };
}

/** Positions from −a to a, about `step` apart, `fine` within `near` of any of `at`. */
function positions(a: number, step: number, at: number[], fine: number, near: number): number[] {
  const us = [-a];
  while (us[us.length - 1] < a - 1e-9) {
    const u = us[us.length - 1];
    us.push(Math.min(a, u + (at.some((s) => Math.abs(u - s) < near) ? fine : step)));
  }
  if (us.length > 2 && a - us[us.length - 2] < 0.4 * step) us.splice(us.length - 2, 1);
  return us;
}

/** Weld coincident points, drop collapsed triangles, turn the closed surface outwards (its volume positive), add normals. */
function finish(g: BufferGeometry): BufferGeometry {
  if (g.getAttribute("normal")) g.deleteAttribute("normal");
  const merged = mergeVertices(g, 1e-4);
  const p = merged.getAttribute("position");
  const idx = merged.index!.array;
  const kept: number[] = [];
  let volume = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const [a, b, c] = [idx[t], idx[t + 1], idx[t + 2]];
    if (a === b || b === c || a === c) continue; // collapsed onto a medial segment
    kept.push(a, b, c);
    volume +=
      p.getX(a) * (p.getY(b) * p.getZ(c) - p.getZ(b) * p.getY(c)) +
      p.getY(a) * (p.getZ(b) * p.getX(c) - p.getX(b) * p.getZ(c)) +
      p.getZ(a) * (p.getX(b) * p.getY(c) - p.getY(b) * p.getX(c));
  }
  if (volume < 0) for (let t = 0; t < kept.length; t += 3) [kept[t + 1], kept[t + 2]] = [kept[t + 2], kept[t + 1]];
  merged.setIndex(kept);
  merged.computeVertexNormals();
  return merged;
}

interface BodySpec {
  outline: Outline; // in the (x, z) plane, at the body's widest
  wall: WallPoint[];
  /** Inward displacement of a wall point along the surface's normal (x, z after the inset, its height and angle). */
  displace: (x: number, z: number, y: number, phi: number, arc: number) => number;
  /** The direction of that displacement, as an angle up from the horizontal; the normal's angle by default. */
  direction?: (w: WallPoint) => number;
  /** The upper and lower faces' heights; s runs from 1 at their edge to 0 on the medial segment. */
  upper: (x: number, z: number, s: number) => number;
  lower: (x: number, z: number, s: number) => number;
  upperSteps: number;
  lowerSteps: number;
}
/**
 * A closed soft body: the wall's rings round the outline, inset and displaced, and the upper and lower faces filled by
 * shrinking the wall's last and first rings onto the outline's medial segment. Points on the straight sides keep
 * their u, so the two halves of each face meet on the segment and are welded there.
 */
function body(b: BodySpec): BufferGeometry {
  const { outline: o } = b;
  const n = o.pts.length;
  const rings: Vec[][] = b.wall.map((w) => {
    const { d, y, phi } = w;
    const dir = b.direction?.(w) ?? phi;
    return o.pts.map((p, i) => {
      const [nx, nz] = o.nrm[i];
      const [x, z] = [p[0] - nx * d, p[1] - nz * d];
      const delta = b.displace(x, z, y, phi, o.arc[i]);
      return [x - nx * Math.cos(dir) * delta, y - Math.sin(dir) * delta, z - nz * Math.cos(dir) * delta] as Vec;
    });
  });
  const shrink = (edge: Vec[], steps: number, height: (x: number, z: number, s: number) => number): Vec[][] => {
    const centre = edge.map((p) => [Math.min(o.a, Math.max(-o.a, p[0])), o.c] as P2);
    const out: Vec[][] = [];
    for (let k = 1; k <= steps; k++) {
      const s = 1 - k / steps;
      out.push(
        edge.map((p, i) => {
          const [x, z] = [centre[i][0] + s * (p[0] - centre[i][0]), centre[i][1] + s * (p[2] - centre[i][1])];
          return [x, height(x, z, s), z] as Vec;
        }),
      );
    }
    return out;
  };
  const all = [...shrink(rings[0], b.lowerSteps, b.lower).reverse(), ...rings, ...shrink(rings[rings.length - 1], b.upperSteps, b.upper)];
  const pos: number[] = [];
  for (const ring of all) for (const p of ring) pos.push(...p);
  const index: number[] = [];
  for (let k = 0; k < all.length - 1; k++) {
    for (let i = 0; i < n; i++) {
      const [a0, a1, b0, b1] = [k * n + i, k * n + ((i + 1) % n), (k + 1) * n + i, (k + 1) * n + ((i + 1) % n)];
      index.push(a0, a1, b1, a0, b1, b0);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  return finish(g);
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
const box3 = (g: BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

// ---- the seat: the base and the seat cushion as one body ----
const SEAT = {
  R: 18, // the corners in plan, at the widest
  top: 42.9, // the cushion's upper edge, where its top face begins
  dome: 0.45,
  seamY: 29.4, // the stitched edge of the seat cushion
};
/** Its wall: [inset from the widest outline, height], from the floor (on the feet) up to the top face. */
const SEAT_WALL = wall(
  [
    [13.6, FOOT.h],
    [12.6, 2.9],
    [11.9, 3.8],
    [11.4, 5.2],
    [10.2, 8.5],
    [8.4, 13],
    [6.3, 18],
    [4.2, 23],
    [2.4, 27],
    [1.6, 28.4],
    [2.3, SEAT.seamY],
    [1.5, 30.4],
    [0.6, 31.8],
    [0.12, 33.4],
    [0, 35],
    [0.25, 36.8],
    [0.9, 38.5],
    [2.1, 40],
    [3.8, 41.3],
    [5.9, 42.3],
    [8, 42.6],
    [9.6, SEAT.top],
  ],
  1.7,
  0.5,
  (y) => y > 27.4 && y < 31.4,
);
/** The seams' crease, inward, at height y: narrow where stitched, wide where the cushion's sections dome. */
const seatCrease = (seams: number[], x: number, y: number) => {
  const pillow = smoothstep(26, 32, y);
  const [g1, g2, s2] = [lerp(0.9, 1.2, pillow), lerp(0.5, 2.7, pillow), lerp(4, 6.8, pillow)];
  return seams.reduce((c, s) => c + g1 * gauss(x - s, 1.1) + g2 * gauss(x - s, s2), 0) * smoothstep(3, 7, y);
};
/** The base's gathered fabric: soft vertical folds below the cushion's stitched edge, round the whole base. */
const gathers = (arc: number, y: number) =>
  0.7 * (0.5 + 0.5 * Math.sin((2 * Math.PI * arc) / 8.5)) * (0.7 + 0.3 * Math.sin((2 * Math.PI * arc) / 31 + 1.1)) * smoothstep(5, 12, y) * (1 - smoothstep(25, 28.4, y));

// ---- the back: a cushion built flat (x across, z up it, y through it, the front +), then leaned into place ----
const BACK = {
  R: 12, // its corners, seen from the front
  h0: 36, // its lower edge, sunk into the seat
  h1: 83.6, // its upper edge, before the seams pull it down
  dome: 2.4, // the front's pillows
  sag: 1.2, // the back's rear face
  lumbar: 53.5, // the stitched line between the pillows and the lumbar roll
  roll: 2.4, // how far the lumbar roll stands out in front of the pillows
};
/** Its rim, through it from the rear face (−) to the front (+): [inset from its outline, depth]. */
const BACK_RIM = wall(
  [
    [9.5, -17.5],
    [7.8, -17.1],
    [5.9, -16.3],
    [4.2, -14.9],
    [2.7, -13],
    [1.5, -10.8],
    [0.65, -8],
    [0.15, -4.8],
    [0, -1.2],
    [0.15, 1.8],
    [0.7, 4.6],
    [1.6, 7],
    [2.9, 9],
    [4.5, 10.6],
    [6.4, 11.8],
    [8.5, 12.5],
    [10, 12.7],
  ],
  1.8,
);
/**
 * The front's creases, inward: the seams, the line over the lumbar roll and a soft crease across each pillow; the roll
 * stands out. The lumbar line and the soft crease fade out towards the ends, where the cushion rounds off (`end`: the
 * front face's medial segment ends there, and a crease along it would be pinched).
 */
const backCrease = (seams: number[], x: number, h: number, end: number) =>
  seams.reduce((c, s) => c + 1.3 * gauss(x - s, 1.2) + 2.4 * gauss(x - s, 6), 0) +
  (1 - smoothstep(end - 6, end, Math.abs(x))) *
    (1.2 * gauss(h - BACK.lumbar, 1.1) + 1.8 * gauss(h - BACK.lumbar, 3.2) + 0.45 * gauss(h - 74, 1.8) - BACK.roll * (1 - smoothstep(BACK.lumbar - 2, BACK.lumbar + 2, h)));
/** The upper edge dips at the seams; the dip fades out downwards. */
const backDip = (seams: number[], x: number, h: number) => seams.reduce((c, s) => c + 3 * gauss(x - s, 7), 0) * smoothstep(52, BACK.h1, h);
/** Its middle surface seen from the side: [height, z], before it is moved to the seat depth. */
const SPINE: P2[] = [
  [30, -34],
  [38, -34.6],
  [46, -35.9],
  [54, -37.9],
  [62, -40.3],
  [70, -42.9],
  [78, -45.5],
  [86, -48],
];
const spineZ = (h: number) => {
  const i = Math.min(SPINE.length - 1, Math.max(1, SPINE.findIndex((p) => p[0] >= h)));
  const [p0, p1, p2, p3] = [SPINE[Math.max(0, i - 2)], SPINE[i - 1], SPINE[i], SPINE[Math.min(SPINE.length - 1, i + 1)]];
  const t = (h - p1[0]) / (p2[0] - p1[0]);
  const m1 = ((p2[1] - p0[1]) / (p2[0] - p0[0] || 1)) * (p2[0] - p1[0]);
  const m2 = ((p3[1] - p1[1]) / (p3[0] - p1[0] || 1)) * (p2[0] - p1[0]);
  const [t2, t3] = [t * t, t * t * t];
  return (2 * t3 - 3 * t2 + 1) * p1[1] + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2;
};
/** A point of the flat back (across x, up h, through t, the front +) leaned into place. */
const backPoint = (x: number, h: number, t: number): Vec => {
  const slope = (spineZ(h + 0.25) - spineZ(h - 0.25)) / 0.5;
  const l = Math.hypot(1, slope);
  return [x, h - (t * slope) / l, spineZ(h) + t / l];
};

// ---- one module ----
interface Module {
  id: string;
  width: number;
  sections: number;
  name: string;
  tags: string[];
  notes: (m: Built) => string;
}
interface Built {
  upholstery: BufferGeometry;
  feet: BufferGeometry;
  surface: { name: string; height: number; width: number; depth: number; center: [number, number] };
  collisionParts: Part[];
  report: string[];
}

function build(m: Module): Built {
  const W = m.width;
  const seams = Array.from({ length: m.sections - 1 }, (_, k) => -W / 2 + ((k + 1) * W) / m.sections);
  const report: string[] = [];

  // the seat
  const seatOutline = roundedRect(W / 2, D / 2, 0, SEAT.R, positions(W / 2 - SEAT.R, 2, seams, 0.6, 4), positions(D / 2 - SEAT.R, 2, [], 2, 0), 2);
  const seatTop = (x: number, _z: number, s: number) => SEAT.top + SEAT.dome * smoothstep(0, 1, 1 - s) - seatCrease(seams, x, SEAT.top);
  const seat = body({
    outline: seatOutline,
    wall: SEAT_WALL,
    displace: (x, _z, y, _phi, arc) => seatCrease(seams, x, y) + gathers(arc, y),
    // the seams press in sideways through the stitched edge's groove (along the normal, which turns over quickly
    // there, they would cross over each other) and along the normal everywhere above it
    direction: (w) => w.phi * smoothstep(31.5, 34, w.y),
    upper: seatTop,
    lower: () => FOOT.h,
    upperSteps: 12,
    lowerSteps: 3,
  });

  // the back, flat
  const half = W / 2 - 0.5;
  const [hv, cv] = [(BACK.h1 - BACK.h0) / 2, (BACK.h0 + BACK.h1) / 2];
  // its ends sampled finely across the lumbar line, which runs round them
  const backOutline = roundedRect(half, hv, cv, BACK.R, positions(half - BACK.R, 2.4, seams, 0.7, 4), positions(hv - BACK.R, 2.4, [BACK.lumbar - cv], 0.5, 5), 2.4);
  const [t0, t1] = [BACK_RIM[0].y, BACK_RIM[BACK_RIM.length - 1].y];
  const end = half - BACK.R;
  // the front's pillows rise and the rear sags over 9 cm in from the faces' edges (the faces' medial segment ends
  // close to their ends, so a rise towards it would be steep there)
  const plateau = (x: number, h: number, inset: number) =>
    smoothstep(0, 9, Math.min(h - BACK.h0 - inset, BACK.h1 - inset - h)) * smoothstep(0, 9, half - inset - Math.abs(x));
  const back = body({
    outline: backOutline,
    wall: BACK_RIM,
    displace: (x, h, _t, phi) => backCrease(seams, x, h, end) * Math.max(0, Math.sin(phi)) ** 2,
    upper: (x, h) => t1 + BACK.dome * plateau(x, h, BACK_RIM[BACK_RIM.length - 1].d) - backCrease(seams, x, h, end),
    lower: (x, h) => t0 - BACK.sag * plateau(x, h, BACK_RIM[0].d),
    upperSteps: 20,
    lowerSteps: 4,
  });
  // leaned into place: the seams pull its upper edge down, then it stands on the seat
  {
    const p = back.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const [x, t, h] = [p.getX(i), p.getY(i), p.getZ(i)];
      p.setXYZ(i, ...backPoint(x, h - backDip(seams, x, h), t));
    }
    // its front at the seat (the lumbar roll) SEAT_DEPTH behind the seat's front; its top at H
    let [front, top] = [-Infinity, -Infinity];
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) < SEAT_H + 8 && Math.abs(p.getX(i)) < W / 2 - 15) front = Math.max(front, p.getZ(i));
      top = Math.max(top, p.getY(i));
    }
    back.translate(0, H - top, D / 2 - SEAT_DEPTH - front);
  }
  const backGeometry = finish(back); // leaning it turned it inside out

  // the feet, under the seat's flat bottom
  const bottom = SEAT_WALL[0].d;
  const fx = W / 2 - bottom - 8;
  const feetAt: P2[] = [-fx, ...(W > 120 ? [0] : []), fx].flatMap((x) => [[x, -(D / 2 - bottom - 8)] as P2, [x, D / 2 - bottom - 8] as P2]);
  const feet = feetAt.map(([x, z]) => new CylinderGeometry(FOOT.r, FOOT.r, FOOT.h + 0.3, 16).translate(x, (FOOT.h + 0.3) / 2, z));

  for (const [name, g] of [
    ["seat", seat],
    ["back", backGeometry],
  ] as const)
    assertNoFolds(`${m.id}: ${name}`, g);
  const merge = (gs: BufferGeometry[]) => {
    const out = mergeGeometries(
      gs.map((g) => {
        if (g.getAttribute("uv")) g.deleteAttribute("uv");
        return g.index ? g : mergeVertices(g, 1e-4);
      }),
    );
    if (!out) throw new Error("could not merge");
    return out;
  };
  const upholstery = merge([seat, backGeometry]);
  const feetGeometry = merge(feet);

  // the seat as a surface: the largest rectangle on the cushion's top face (2 cm in from where it rounds over), clear
  // of the back; at the median height under it
  const backB = box3(backGeometry);
  let backFront = -Infinity;
  {
    const p = backGeometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) if (p.getY(i) > SEAT_H - 2 && p.getY(i) < SEAT_H + 30 && Math.abs(p.getX(i)) < W / 2 - 15) backFront = Math.max(backFront, p.getZ(i));
  }
  const inset = SEAT_WALL[SEAT_WALL.length - 1].d + 2;
  const z0 = Math.ceil(backFront + 2);
  const z1 = Math.floor(D / 2 - inset);
  // the widest it can be at its front corners, inside the top face's rounded corners
  const [ri, cz] = [SEAT.R - inset, D / 2 - SEAT.R];
  const hw = Math.floor(W / 2 - SEAT.R + Math.sqrt(Math.max(0, ri * ri - Math.max(0, z1 - cz) ** 2)));
  const heights: number[] = [];
  {
    const mesh = new Mesh(seat);
    const ray = new Raycaster();
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 8; j++) {
        ray.set(new Vector3(-hw + (2 * hw * i) / 12, 200, z0 + ((z1 - z0) * j) / 8), new Vector3(0, -1, 0));
        const hit = ray.intersectObject(mesh)[0];
        if (hit) heights.push(hit.point.y);
      }
    }
    heights.sort((a, b) => a - b);
  }
  const median = heights[heights.length >> 1];
  const surface = { name: "seat", height: Math.round(median * 2) / 2, width: 2 * hw, depth: z1 - z0, center: [0, r((z0 + z1) / 2)] as [number, number] };

  // the sections, counted on the model: dips in the seat's top across it, and in the back's front at pillow height
  const dips = (xs: number[], vs: number[], deeper: number) => {
    let count = 0;
    for (let i = 1; i < vs.length - 1; i++) {
      const win = xs.map((x, j) => (Math.abs(x - xs[i]) <= 6 ? vs[j] : Infinity));
      const around = xs.map((x, j) => (Math.abs(x - xs[i]) <= 12 ? vs[j] : -Infinity));
      if (vs[i] === Math.min(...win) && Math.max(...around) - vs[i] > deeper) count++;
    }
    return count;
  };
  const along = Array.from({ length: Math.floor((W - 30) / 0.5) + 1 }, (_, i) => -(W / 2 - 15) + i * 0.5);
  const ray = new Raycaster();
  const seatMesh = new Mesh(seat);
  const backMesh = new Mesh(backGeometry);
  const seatTops = along.map((x) => {
    ray.set(new Vector3(x, 200, 15), new Vector3(0, -1, 0));
    return ray.intersectObject(seatMesh)[0]?.point.y ?? NaN;
  });
  const backFronts = along.map((x) => {
    ray.set(new Vector3(x, 70, 100), new Vector3(0, 0, -1));
    return ray.intersectObject(backMesh)[0]?.point.z ?? NaN;
  });
  const seatSections = dips(along, seatTops, 1) + 1;
  const backSections = dips(along, backFronts, 1) + 1;
  if (seatSections !== m.sections || backSections !== m.sections) throw new Error(`${m.id}: ${seatSections} seat and ${backSections} back sections, expected ${m.sections}`);

  // collision: the seat's widest outline up to its top, and the back (each the convex outline of its plan)
  const fewer = (hull: P2[], most = 24) => {
    const step = Math.ceil(hull.length / most);
    return hull.filter((_, i) => i % step === 0).map(([x, z]) => [r(x), r(z)] as P2);
  };
  const seatB = box3(seat);
  const backPlan: P2[] = [];
  {
    const p = backGeometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) backPlan.push([p.getX(i), p.getZ(i)]);
  }
  const collisionParts: Part[] = [
    { name: "seat", shape: "extrusion", points: fewer(convexHull(seatOutline.pts)), height: r(seatB.max.y), position: { x: 0, y: 0, z: 0 }, material: "upholstery" } as Part,
    { name: "back", shape: "extrusion", points: fewer(convexHull(backPlan)), height: r(backB.max.y - backB.min.y), position: { x: 0, y: r(backB.min.y), z: 0 }, material: "upholstery" } as Part,
  ];

  const cm = (v: number) => v.toFixed(1);
  report.push(
    `  seat  x ${cm(seatB.min.x)}…${cm(seatB.max.x)}  y ${cm(seatB.min.y)}…${cm(seatB.max.y)}  z ${cm(seatB.min.z)}…${cm(seatB.max.z)}`,
    `  back  x ${cm(backB.min.x)}…${cm(backB.max.x)}  y ${cm(backB.min.y)}…${cm(backB.max.y)}  z ${cm(backB.min.z)}…${cm(backB.max.z)}; its front at the seat ${cm(backFront)} (seat depth ${cm(D / 2 - backFront)})`,
    `  sections: ${seatSections} on the seat, ${backSections} on the back; seams at ${seams.map(cm).join(", ") || "-"}`,
    `  surface ${surface.width} × ${surface.depth} at [${surface.center.join(", ")}], height ${surface.height}; seat ${heights[0].toFixed(1)} / ${median.toFixed(1)} / ${heights[heights.length - 1].toFixed(1)} cm (lowest / median / highest)`,
    `  feet at ${feetAt.map((p) => `[${p.map(r).join(", ")}]`).join(" ")}`,
  );
  return { upholstery, feet: feetGeometry, surface, collisionParts, report };
}

// ---- the two modules ----
const SOURCE = `Sizes from Designwerk's Passion leaflet (designwerk.li, produktflyer-passion-05-2026-en.pdf, page 4, the type plan)`;
const COMMON = (seats: string) =>
  `Armless, so modules stand side by side; this is the module on its own. Shown with the back pushed back (seat depth ${SEAT_DEPTH}), as on the type plan: the manual back adjustment (MBA) pulls it forward to a seat depth of 59, and the planner shows this one position. Designwerk's feet are plastic, 25 mm high and almost invisible (page 3). model.glb is generated by \`npx tsx tools/models/designwerk-passion.ts\` from its own geometry after the type plan and Designwerk's photos: a plump base narrowing to the floor with its fabric gathered, a seat cushion stitched round its edge and split by seams into ${seats}, and a tall back leaning back, its sections matching the seat's, each a pillow over a lumbar roll. The default grey linen is close to the leaflet's cover fabric (Shine W015 Argento); Designwerk makes Passion in fabric and leather (one colour), and the colours here are planning colours, not Designwerk's. The seat is a surface, so cushions and throws can go on it.`;
const MODULES: Module[] = [
  {
    id: "armchair-designwerk-passion-100",
    width: 100,
    sections: 2,
    name: "Armchair, Designwerk Passion 100",
    tags: ["living room", "designwerk", "passion", "armless", "modular", "lounge chair", "puffy", "quilted", "grey"],
    notes: () =>
      `Designwerk Passion armchair, the single-seat module: "Armchair incl. 1 MBA", item D140100B (not the rotatable D140105B). ${SOURCE}: 100 wide, ${D} deep, ${H} high, seat height ${SEAT_H}, seat depth 76/59. ${COMMON("two sections")}`,
  },
  {
    id: "sofa-designwerk-passion-160",
    width: 160,
    sections: 3,
    name: "Sofa, Designwerk Passion 160, 2-seater",
    tags: ["living room", "designwerk", "passion", "armless", "modular", "2-seater", "puffy", "quilted", "grey"],
    notes: () =>
      `Designwerk Passion 2-sofa, the straight two-seat module: "2-sofa incl. 1 MBA", item D140200B (not the REC, the 160 wide chaise, 172 deep). ${SOURCE}: 160 wide, ${D} deep, ${H} high, seat height ${SEAT_H}, seat depth 76/59. ${COMMON("three sections")}`,
  },
];

for (const m of MODULES) {
  const b = build(m);
  const all: [string, BufferGeometry, MeshStandardMaterial][] = [
    ["upholstery", b.upholstery, new MeshStandardMaterial({ name: "Upholstery", color: "#a5a39d", roughness: 0.95 })],
    ["feet", b.feet, new MeshStandardMaterial({ name: "Feet", color: "#1a1a1a", roughness: 0.42 })],
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
        upholstery: { label: "Upholstery", default: "fabric.linen-grey", allowed: ["fabric.*", "leather.*"] },
        feet: { label: "Feet", default: "plastic.deep-black", allowed: ["plastic.deep-black"] },
      },
      surfaces: [b.surface],
      collision: "parts",
      collisionParts: b.collisionParts,
      clearance: { front: 45, note: "Legroom in front of the seat; a coffee table can stand 45 cm away" },
      productUrl: "https://designwerk.li/en/portfolio/passion/",
      notes: m.notes(b),
    },
    `${m.id}/item.json`,
  );
  console.log(`wrote ${resolve(dir, "model.glb")} (${(glb.byteLength / 1024).toFixed(0)} KB) and ${path}`);
  console.log(`${boxText}; ${b.upholstery.getAttribute("position").count} vertices`);
  for (const line of b.report) console.log(line);
}
