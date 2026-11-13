/**
 * npx tsx tools/models/sofa-koinor-stones-corner-left.ts — writes catalogue/sofa-koinor-stones-corner-left/model.glb
 * and item.json, built from its own geometry (no third-party assets): the KOINOR Stones corner sofa with the chaise on
 * the left as you face it (on the right of someone sitting on it).
 *
 * Sizes: Koinor's Stones flyer (koinor.com/media/koinor_stones.pdf, page 6) gives a height of 82 cm, a depth of 95, a
 * seat depth of 66 and a seat height of 41. This corner sofa is two of its elements, 275 × 170 cm together: the
 * recliner ("Liege", 117 wide and 170 deep, armrest left) and the add-on element with armrest right (158 wide).
 *
 * Shape, after the flyer's element drawings and photos and the shop's photo: soft and rounded like river stones.
 * - The bases: two pebbles on small round glides; their top is the seat. The Liege is egg-shaped in plan, its tip to the
 *   front; where it meets the add-on element the two are cut straight (a tight crease), and in front the Liege's
 *   rounded side opens a V towards the add-on element's rounded corner.
 * - Loose oval back cushions, upholstered all round: a long one over the add-on element, rising towards the corner; a
 *   broad one along the back of the Liege; one along the Liege's outer side, slanted, leaning outwards.
 * - Armrest pads: flat ovals on the bases' outer ends, overhanging them, at 60 cm (adjustable 54–65).
 *
 * Built in cm in the catalogue frame (x right as seen from the front, y up, the front faces +z) and exported in metres.
 * The materials are "Upholstery" and "Glides"; item.json maps them to its material slots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial } from "three";
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
const DEG = Math.PI / 180;
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- sizes (cm) ----
const ID = "sofa-koinor-stones-corner-left";
const W = 275;
const D = 170;
const H = 82;
const JOINT_X = -W / 2 + 117; // between the Liege (117 wide) and the add-on element (158 wide)
const BACK = -D / 2; // the back line: the backs of the cushions
const GLIDE = { r: 2.5, h: 4 };
const SEAT_H = 41;
const ARM_TOP = 60; // adjustable 54–65

// ---- the pebble: a closed outline in plan (x, z) made into a soft slab ----
interface Profile {
  y0: number;
  y1: number;
  bottom: [number, number]; // the lower edge's radii: inwards, upwards
  top: [number, number]; // the upper edge's radii: inwards, downwards
  dome?: number; // the top face rises by this much in the middle
  sag?: number; // the bottom face drops by this much in the middle
  edge?: (p: P2) => number; // scales the inward radii along the outline (1 = full rounding)
  radial?: boolean; // inset towards the middle instead of along the normals: can't fold, but rounds unevenly on long shapes
}
const EDGE_STEPS = 7;
const FACE_STEPS = 7;

/**
 * A soft slab: the outline at its widest, rounded over at the bottom and the top with elliptical edges (the inward
 * radius scaled per point by `edge`), the faces filled towards the middle and domed. The outline must be star-shaped
 * around its middle and curve no tighter than the inward radii.
 */
function pebble(outline: P2[], pr: Profile): BufferGeometry {
  const n = outline.length;
  const inward = signedArea(outline) > 0 ? 1 : -1;
  const centre = outline.reduce<P2>((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
  const normals = outline.map((p, i) => {
    if (pr.radial) {
      const l = Math.hypot(centre[0] - p[0], centre[1] - p[1]) || 1;
      return [(centre[0] - p[0]) / l, (centre[1] - p[1]) / l] as P2;
    }
    const a = outline[(i - 1 + n) % n];
    const b = outline[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [(-(b[1] - a[1]) / l) * inward, ((b[0] - a[0]) / l) * inward] as P2;
  });
  const scale = outline.map((p) => pr.edge?.(p) ?? 1);
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
  const sideSteps = side > 0.5 ? Math.ceil(side / 5) : 0;
  for (let k = 1; k < sideSteps; k++) edge.push(ringAt(0, pr.y0 + by + (side * k) / sideSteps));
  for (let k = sideSteps > 0 ? 0 : 1; k <= EDGE_STEPS; k++) {
    const th = (k / EDGE_STEPS) * (Math.PI / 2);
    edge.push(ringAt(tx * (1 - Math.cos(th)), pr.y1 - ty + ty * Math.sin(th)));
  }
  // the faces: rings shrinking towards the middle, rising (or dropping) smoothly to the pole; radial insets share the
  // outline's middle, so every point moves along one ray
  const face = (ring: Vec[], y: number, rise: number) => {
    const c: Vec = pr.radial ? [centre[0], 0, centre[1]] : ring.reduce<Vec>((s, p) => [s[0] + p[0] / n, 0, s[2] + p[2] / n], [0, 0, 0]);
    const rings: Vec[][] = [];
    for (let j = FACE_STEPS - 1; j >= 1; j--) {
      const s = j / FACE_STEPS;
      const h = y + rise * smoothstep(0, 1, 1 - s);
      rings.push(ring.map((p) => [c[0] + s * (p[0] - c[0]), h, c[2] + s * (p[2] - c[2])]));
    }
    return { rings, pole: [c[0], y + rise, c[2]] as Vec };
  };
  const bottom = face(edge[0], pr.y0, -(pr.sag ?? 0));
  const top = face(edge[edge.length - 1], pr.y1, pr.dome ?? 0);
  const rings = [...bottom.rings.slice().reverse(), ...edge, ...top.rings];
  const pos: number[] = [...bottom.pole];
  for (const ring of rings) for (const p of ring) pos.push(...p);
  pos.push(...top.pole);
  const R = rings.length;
  const v = (k: number, i: number) => 1 + k * n + ((i + n) % n);
  const last = 1 + R * n;
  const groups: number[][] = [[], [], []]; // bottom fan, sides, top fan
  for (let i = 0; i < n; i++) groups[0].push(0, v(0, i + 1), v(0, i));
  for (let k = 0; k < R - 1; k++) {
    for (let i = 0; i < n; i++) groups[1].push(v(k, i), v(k, i + 1), v(k + 1, i + 1), v(k, i), v(k + 1, i + 1), v(k + 1, i));
  }
  for (let i = 0; i < n; i++) groups[2].push(last, v(R - 1, i), v(R - 1, i + 1));
  // turn each group outwards: test one triangle against the direction it should face
  const P = (j: number): Vec => [pos[3 * j], pos[3 * j + 1], pos[3 * j + 2]];
  const normalOf = (t: number[]) => {
    const [a, b, c] = t.map(P);
    const u: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const w: Vec = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]] as Vec;
  };
  const mid = Math.floor(R / 2);
  const cMid = rings[mid].reduce<Vec>((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n, s[2] + p[2] / n], [0, 0, 0]);
  const sideTri = [v(mid, 0), v(mid, 1), v(mid + 1, 1)];
  const sideN = normalOf(sideTri);
  const out = P(v(mid, 0));
  const expect = [
    normalOf(groups[0].slice(0, 3))[1] < 0,
    sideN[0] * (out[0] - cMid[0]) + sideN[2] * (out[2] - cMid[2]) > 0,
    normalOf(groups[2].slice(0, 3))[1] > 0,
  ];
  const index: number[] = [];
  groups.forEach((g, k) => {
    for (let j = 0; j < g.length; j += 3) index.push(...(expect[k] ? [g[j], g[j + 1], g[j + 2]] : [g[j], g[j + 2], g[j + 1]]));
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(pos, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

/** A closed polygon resampled every `step` cm along its perimeter (keeps a convex polygon convex). */
function resample(poly: P2[], step = 2): P2[] {
  const out: P2[] = [];
  let carry = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = carry;
    while (t < len) {
      out.push([a[0] + ((b[0] - a[0]) * t) / len, a[1] + ((b[1] - a[1]) * t) / len]);
      t += step;
    }
    carry = t - len;
  }
  return out;
}

/**
 * A loose cushion standing on its lower edge, from its front-view outline (x, height): leaned back, then turned. The
 * outline is made convex (its convex hull, evenly resampled) and rounded towards its middle, so that nothing folds.
 */
function cushion(outline: P2[], thick: number, lean: number, turn = 0): BufferGeometry {
  const convex = resample(convexHull(outline), 2);
  const g = pebble(convex, { y0: -thick / 2, y1: thick / 2, bottom: [7, thick / 2], top: [7, thick / 2], dome: 1.5, sag: 1.5, radial: true });
  // standing up: the outline's second coordinate becomes the height, the thickness runs front to back
  g.rotateX(-Math.PI / 2);
  g.rotateX(-lean * DEG);
  if (turn) g.rotateY(turn * DEG);
  return g;
}

/** An oval in plan, between an ellipse and a rounded rectangle: `w` across (x), `l` long (z). */
function pill(w: number, l: number, e = 2.3, n = 72): P2[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    return [(w / 2) * Math.sign(c) * Math.abs(c) ** (2 / e), (l / 2) * Math.sign(s) * Math.abs(s) ** (2 / e)] as P2;
  });
}

/** Move a geometry so that its box meets the given limits (each axis: a min, a max or a centre). */
function place(g: BufferGeometry, at: { minX?: number; maxX?: number; cx?: number; minY?: number; maxY?: number; minZ?: number; cz?: number }): BufferGeometry {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  const pick = (min: number, max: number, lo?: number, hi?: number, c?: number) =>
    lo !== undefined ? lo - min : hi !== undefined ? hi - max : c !== undefined ? c - (min + max) / 2 : 0;
  return g.translate(pick(b.min.x, b.max.x, at.minX, at.maxX, at.cx), pick(b.min.y, b.max.y, at.minY, at.maxY), pick(b.min.z, b.max.z, at.minZ, undefined, at.cz));
}

const box3 = (g: BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

// ---- the bases ----
/**
 * Full rounding away from the joint, a tight crease at it: the joint runs from the back to z = `zEnd`. The rounding
 * grows over 50 cm, slowly enough that the faces' rings (towards their middle) don't fold.
 */
const joint = (zEnd: number) => (p: P2) => 0.2 + 0.8 * smoothstep(2, 50, Math.hypot(p[0] - JOINT_X, Math.max(0, p[1] - zEnd)));
const BASE: Profile = { y0: GLIDE.h, y1: SEAT_H - 1, bottom: [14, 15], top: [16, 21], dome: 2.5 };
const backOfBase = BACK + 1.5;

// ---- outlines: straight runs and corners exactly, organic curves as splines ----
const line = (a: P2, b: P2, step = 3): P2[] => {
  const n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
  return Array.from({ length: n }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n] as P2);
};
/** A circular corner around c from angle a0 to a1 (degrees, from +x towards +z), without its end point. */
const arc = (c: P2, radius: number, a0: number, a1: number, stepDeg = 6): P2[] => {
  const n = Math.max(1, Math.round(Math.abs(a1 - a0) / stepDeg));
  return Array.from({ length: n }, (_, i) => {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    return [c[0] + radius * Math.cos(a), c[1] + radius * Math.sin(a)] as P2;
  });
};
/** An open centripetal Catmull–Rom spline from pts[1] to pts[n − 2] (the first and last points only set the tangents), without its end point. */
function openSpline(pts: P2[], per = 6): P2[] {
  const out: P2[] = [];
  const knot = (a: P2, b: P2) => Math.sqrt(Math.hypot(b[0] - a[0], b[1] - a[1])) || 1e-6;
  const mix = (a: P2, b: P2, ta: number, tb: number, t: number): P2 => [((tb - t) * a[0] + (t - ta) * b[0]) / (tb - ta), ((tb - t) * a[1] + (t - ta) * b[1]) / (tb - ta)];
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]];
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
  return out;
}

// the Liege, egg-shaped, its tip to the front and a little towards its outer side; its inner side is the joint
const liegeOutline: P2[] = (() => {
  const x0 = JOINT_X - 0.5;
  const outer = x0 - 107;
  const [rIn, rOut] = [6, 21]; // the back corners: tight at the joint, round outside
  const front = openSpline([
    [x0, -8],
    [x0, 0],
    [x0 - 1.5, 12],
    [x0 - 4.5, 30],
    [x0 - 10, 46],
    [x0 - 20, 61],
    [x0 - 35, 74],
    [x0 - 55, 83],
    [x0 - 70, 82.5],
    [x0 - 81, 75],
    [x0 - 89, 64],
    [x0 - 97, 45],
    [x0 - 103, 22],
    [outer + 0.5, -8],
    [outer, -40],
    [outer, backOfBase + rOut],
    [outer, backOfBase + rOut - 8],
  ]);
  // its tip reaches the front of the box
  const zMax = Math.max(...front.map((p) => p[1]));
  return [
    ...front.map(([x, z]) => [x, z > 0 ? (z * (D / 2)) / zMax : z] as P2),
    ...arc([outer + rOut, backOfBase + rOut], rOut, 180, 270),
    ...line([outer + rOut, backOfBase], [x0 - rIn, backOfBase]),
    ...arc([x0 - rIn, backOfBase + rIn], rIn, 270, 360),
    ...line([x0, backOfBase + rIn], [x0, 0]),
  ];
})();
const liegeBase = pebble(liegeOutline, { ...BASE, edge: joint(0) });

// the add-on element: a rounded slab, 95 deep, its outer end under the armrest pad
const addonOutline: P2[] = (() => {
  const x0 = JOINT_X + 0.5;
  const front = BACK + 95;
  const end = W / 2 - 10;
  const [rIn, rFront, rOut] = [6, 18, 20]; // tight at the joint, round where the V opens and at the outer end
  return [
    ...line([x0, backOfBase + rIn], [x0, front - rFront]),
    ...arc([x0 + rFront, front - rFront], rFront, 180, 90),
    ...line([x0 + rFront, front], [end - rOut, front]),
    ...arc([end - rOut, front - rOut], rOut, 90, 0),
    ...line([end, front - rOut], [end, backOfBase + rOut]),
    ...arc([end - rOut, backOfBase + rOut], rOut, 0, -90),
    ...line([end - rOut, backOfBase], [x0 + rIn, backOfBase]),
    ...arc([x0 + rIn, backOfBase + rIn], rIn, -90, -180),
  ];
})();
const addonBase = pebble(addonOutline, { ...BASE, edge: joint(-5) });

// ---- the back cushions (front views: x and height) ----
const addonBack = place(
  cushion(
    closedSpline(
      [
        [12, 0],
        [3, 3],
        [0, 12],
        [0.5, 26],
        [4, 35],
        [12, 39.5],
        [35, 40],
        [65, 38],
        [92, 33.5],
        [109, 28],
        [120, 21],
        [126, 12],
        [125, 5],
        [117, 0.6],
        [95, 0],
        [60, -0.5],
      ],
      8,
    ),
    24,
    12,
  ),
  { minX: JOINT_X + 0.7, minY: 34, minZ: BACK },
);
const liegeBack = place(
  cushion(
    closedSpline(
      [
        [10, 0],
        [2, 6],
        [0, 20],
        [2, 32],
        [9, 40],
        [24, 45],
        [46, 46.5],
        [68, 45],
        [83, 40],
        [90, 32],
        [92, 20],
        [91, 8],
        [85, 1],
        [50, 0],
      ],
      8,
    ),
    25,
    10,
  ),
  { maxX: JOINT_X - 0.7, maxY: H, minZ: BACK },
);
const SIDE = { turn: 77.5, cz: -26 };
const liegeSide = place(
  cushion(
    closedSpline(
      [
        [10, 0],
        [2, 6],
        [0, 18],
        [2, 30],
        [10, 37],
        [28, 40],
        [52, 40],
        [70, 37],
        [78, 30],
        [80, 18],
        [78, 6],
        [70, 0],
        [40, 0],
      ],
      8,
    ),
    22,
    9,
    SIDE.turn,
  ),
  { minX: -W / 2, minY: 34, cz: SIDE.cz },
);

// ---- the armrest pads ----
const ARM: Profile = { y0: ARM_TOP - 20.2, y1: ARM_TOP - 1.2, bottom: [8, 9], top: [9, 10], dome: 1.2 };
const ARM_TURN = 8; // the Liege's pad, its front end turned outwards
const addonArm = place(pebble(pill(39, 59), ARM), { maxX: W / 2, cz: -27 });
const liegeArm = place(pebble(pill(39, 56), ARM).rotateY(-ARM_TURN * DEG), { minX: -W / 2 + 2, cz: 40.5 });

// ---- the glides, under the flat middle of the bases ----
const glideAt: P2[] = [
  [JOINT_X + 9.5, -66],
  [JOINT_X + 9.5, -8],
  [W / 2 - 34, -66],
  [W / 2 - 34, -8],
  [JOINT_X - 11.5, -66],
  [JOINT_X - 87, -66],
  [JOINT_X - 85.5, 18],
  [JOINT_X - 45.5, 56],
];
const inside = (p: P2, poly: P2[]) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
};
const bottomFlat = (outline: P2[], edge: (p: P2) => number) => {
  const inward = signedArea(outline) > 0 ? 1 : -1;
  const n = outline.length;
  return outline.map((p, i) => {
    const a = outline[(i - 1 + n) % n];
    const b = outline[(i + 1) % n];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const d = (BASE.bottom[0] + GLIDE.r) * edge(p);
    return [p[0] + (-(b[1] - a[1]) / l) * inward * d, p[1] + ((b[0] - a[0]) / l) * inward * d] as P2;
  });
};
const flats = [bottomFlat(addonOutline, joint(-5)), bottomFlat(liegeOutline, joint(0))];
for (const g of glideAt) if (!flats.some((f) => inside(g, f))) throw new Error(`glide at ${g.join(", ")} is not under a base's flat bottom`);
const glides = glideAt.map(([x, z]) => new CylinderGeometry(GLIDE.r, GLIDE.r + 0.3, GLIDE.h, 20).translate(x, GLIDE.h / 2, z));

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
  ["Liege base", liegeBase],
  ["add-on base", addonBase],
  ["back cushion, add-on", addonBack],
  ["back cushion, Liege", liegeBack],
  ["side cushion, Liege", liegeSide],
  ["armrest pad, add-on", addonArm],
  ["armrest pad, Liege", liegeArm],
];
for (const [name, g] of pieces) assertNoFolds(name, g);
const merge = (gs: BufferGeometry[]) => {
  const indexed = gs.map((g) => {
    g.deleteAttribute("uv");
    return g.index ? g : mergeVertices(g, 1e-4);
  });
  const out = mergeGeometries(indexed);
  if (!out) throw new Error("could not merge");
  return out;
};
const upholstery = merge([liegeBase, addonBase, addonBack, liegeBack, liegeSide, addonArm, liegeArm]);
const glideGeometry = merge(glides);
const all: [string, BufferGeometry, MeshStandardMaterial][] = [
  ["upholstery", upholstery, new MeshStandardMaterial({ name: "Upholstery", color: "#e9e5dd", roughness: 0.95 })],
  ["glides", glideGeometry, new MeshStandardMaterial({ name: "Glides", color: "#141414", roughness: 0.6 })],
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

// ---- item.json: collision parts from the pieces' boxes, the seat and the chaise as surfaces ----
const boxPart = (name: string, g: BufferGeometry, material = "upholstery"): Part => {
  const b = box3(g);
  return {
    name,
    shape: "box",
    size: { x: r(b.max.x - b.min.x), y: r(b.max.y - b.min.y), z: r(b.max.z - b.min.z) },
    position: { x: r((b.min.x + b.max.x) / 2), y: r((b.min.y + b.max.y) / 2), z: r((b.min.z + b.max.z) / 2) },
    material,
  } as Part;
};
/** A turned piece: the convex outline of its plan, extruded over its height (a turned box would reach past it). */
const hullPart = (name: string, g: BufferGeometry, points = 24): Part => {
  const b = box3(g);
  const p = g.getAttribute("position");
  const plan: P2[] = [];
  for (let i = 0; i < p.count; i++) plan.push([p.getX(i), p.getZ(i)]);
  const hull = convexHull(plan);
  // fewer points, still convex and inside the piece's plan
  const step = Math.max(1, Math.floor(hull.length / points));
  return {
    name,
    shape: "extrusion",
    points: hull.filter((_, i) => i % step === 0).map(([x, z]) => [r(x), r(z)]),
    height: r(b.max.y - b.min.y),
    position: { x: 0, y: r(b.min.y), z: 0 },
    material: "upholstery",
  } as Part;
};
const liegeFootprint = liegeOutline.filter((_, i) => i % 6 === 0).map(([x, z]) => [r(x), r(z)] as P2);
const collisionParts: Part[] = [
  { name: "Liege, base", shape: "extrusion", points: liegeFootprint, height: SEAT_H + 1.5, position: { x: 0, y: 0, z: 0 }, material: "upholstery" } as Part,
  boxPart("add-on element, base", addonBase),
  boxPart("back cushion, add-on element", addonBack),
  boxPart("back cushion, Liege", liegeBack),
  // the side cushion and the Liege's pad are turned: the convex outlines of their plans
  hullPart("side cushion, Liege", liegeSide),
  boxPart("armrest pad, add-on element", addonArm),
  hullPart("armrest pad, Liege", liegeArm),
];
const seatFront = BACK + 95;
const path = writeItem(
  {
    $schema: "../../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: ID,
    name: "Sofa, KOINOR Stones corner, chaise left",
    category: "seating",
    tags: ["living room", "corner sofa", "koinor", "stones", "chenille", "organic", "puffy", "white"],
    dimensions: { width: W, depth: D, height: H },
    placement: { type: "floor" },
    geometry: { type: "model", src: "model.glb", materialMap: { Upholstery: "upholstery", Glides: "glides" } },
    materialSlots: {
      upholstery: { label: "Upholstery", default: "fabric.chenille-white", allowed: ["fabric.*", "leather.*"] },
      glides: { label: "Glides", default: "plastic.deep-black", allowed: ["plastic.deep-black"] },
    },
    surfaces: [
      { name: "seat", height: SEAT_H, width: 116, depth: 62, center: [r(JOINT_X + 1 + 58), r(seatFront - 4 - 31)] },
      { name: "chaise", height: SEAT_H, width: 62, depth: 100, center: [r(JOINT_X - 10.5 - 31), -7] },
    ],
    collision: "parts",
    collisionParts,
    productUrl: "https://www.koinor.com/en/products/sofas/stones/",
    notes: `KOINOR Stones corner sofa in white chenille, as sold by XXXLutz: ${W} × ${D} cm, the recliner ("Liege", 117 wide and 170 deep, armrest left) and the add-on element with armrest right (158 wide). The chaise is on the left as you face the sofa, so on the right of someone sitting on it; the shop's photo shows the mirror image, and the app can't mirror an item, so this item is this version only. Koinor's flyer: height ${H} cm, depth 95, seat depth 66, seat height ${SEAT_H}; the shop lists 275 × 84 × 170 cm and a seat height of 42. model.glb is generated by \`npx tsx tools/models/${ID}.ts\` from its own geometry after Koinor's element drawings and photos: pebble-shaped bases on small black glides, loose oval back cushions upholstered all round, and armrest pads on the bases' ends, shown at ${ARM_TOP} cm (a ratchet sets them between 54 and 65 cm). The seat and the chaise are surfaces, so cushions can be put on them. No clearance zone: the legroom in front of the seats lies inside the item's box, beside the chaise.`,
  },
  `${ID}/item.json`,
);

// ---- report ----
const cm = (v: number) => v.toFixed(1);
const report = (name: string, g: BufferGeometry) => {
  const b = box3(g);
  console.log(`  ${name.padEnd(26)} x ${cm(b.min.x)}…${cm(b.max.x)}  y ${cm(b.min.y)}…${cm(b.max.y)}  z ${cm(b.min.z)}…${cm(b.max.z)}`);
};
console.log(`wrote ${resolve(dir, "model.glb")} (${(glb.byteLength / 1024).toFixed(0)} KB) and ${path}`);
console.log(`box ${cm(size[0])} W × ${cm(size[2])} D × ${cm(size[1])} H cm; ${upholstery.getAttribute("position").count} vertices`);
for (const [name, g] of pieces) report(name, g);
