/**
 * npx tsx tools/models/office-chair-aeron.ts — writes catalogue/office-chair-aeron/model.glb and item.json, built from
 * its own geometry (no third-party assets): the Herman Miller Aeron Chair (Remastered), size B, graphite, with fully
 * adjustable arms.
 *
 * Sizes: Herman Miller publishes two sets for size B. Its EU store gives the seat (51.4 cm wide, 46.2 deep), the back
 * (53 cm high), the base (Ø 69.9) and an overall height of the seat height + 50 cm; its US specs give an overall width
 * of 71.9 cm (fully adjustable arms 71.9–77.2), a depth of 69.8–71.9 and arms 19–29.2 cm above the seat. The model uses
 * the EU set for the seat, the back and the base, sets the seat at 46 cm and the arms 20 cm above it (so they slide
 * under a 72 cm desk top), and comes out within both sets' overall sizes (printed at the end).
 *
 * Shape, after Herman Miller's photos (front, back, three-quarter) and its line drawing of size B:
 * - The back: a loop frame with the mesh stretched inside, wide and round at the top, narrowest at the waist (about
 *   the height of the arm pads), wider again at the bottom where it meets the seat; reclined 13°, bulging forward at the
 *   lumbar and curling back at the top, and curved across (the sides come forward).
 * - Behind it the Y-shaped support: a stem up from the bottom of the back that forks into two arms to the frame's
 *   sides, with the PostureFit pad below the fork.
 * - The seat: a loop frame, widest at the front, with the mesh dished inside and the front member lower (the mesh
 *   rolls over it like a waterfall).
 * - The arms: a bracket from the back's lower corners to a post outside the seat, a pad on top.
 * - Under the seat the tilt mechanism with its tension knob and a lever on each side; the column; a five-star base on
 *   twin-wheel castors, one leg pointing forwards.
 *
 * Built in cm in the catalogue frame (x right as seen from the front, y up, the front faces +z) and exported in metres.
 * The materials are "Frame", "Mesh", "Base" and "Castors"; item.json maps the first three to its material slots (the
 * castors stay black).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Quaternion, SphereGeometry, Vector3 } from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import type { Part } from "../../src/core/schema/common";
import { closedSpline, r, writeItem, type P2 } from "./parametric";

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
const lerp = (a: Vec, b: Vec, t: number): Vec => add(a, mul(sub(b, a), t));
const DEG = Math.PI / 180;
const smoothstep = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- sizes (cm) ----
const SEAT_H = 46; // the mesh's crest near the front
const SEAT = { width: 51.4, depth: 46.2, cz: 3 }; // centre 3 cm in front of the column
const ARM_TOP = SEAT_H + 20;
const BACK = { tilt: 12, y0: SEAT_H - 5, lumbar: 2.6, stretch: 1.03 };
const BASE = { castor: 30.5, wheel: 3.175 }; // castor stems; wheel radius (2½" castors)

// ---- builders ----
interface Section {
  w: number; // across, perpendicular to the normal
  h: number; // along the normal
  r: number; // corner radius
}

/**
 * A tube with a rounded-rectangle section along a path. `normal(i)` gives the direction of the section's height at
 * point i. Closed paths join up; open ones get flat caps.
 */
function sweep(path: Vec[], normal: (i: number) => Vec, section: (i: number) => Section, closed: boolean, seg = 3): BufferGeometry {
  const n = path.length;
  const positions: number[] = [];
  const indices: number[] = [];
  const rings: number[][] = [];
  const ringPts: Vec[][] = [];
  for (let i = 0; i < n; i++) {
    const prev = path[closed ? (i - 1 + n) % n : Math.max(0, i - 1)];
    const next = path[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const t = unit(sub(next, prev));
    const n0 = normal(i);
    const nn = unit(sub(n0, mul(t, dot(n0, t))));
    const b = cross(nn, t);
    const s = section(i);
    const rr = Math.min(s.r, s.w / 2 - 0.01, s.h / 2 - 0.01);
    const pts: Vec[] = [];
    const corners: [number, number][] = [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ];
    corners.forEach(([sx, sy], q) => {
      for (let k = 0; k <= seg; k++) {
        const a = ((q + k / seg) * Math.PI) / 2;
        const u = sx * (s.w / 2 - rr) + rr * Math.cos(a);
        const v = sy * (s.h / 2 - rr) + rr * Math.sin(a);
        pts.push(add(add(path[i], mul(b, u)), mul(nn, v)));
      }
    });
    const ring: number[] = [];
    for (const p of pts) {
      ring.push(positions.length / 3);
      positions.push(...p);
    }
    rings.push(ring);
    ringPts.push(pts);
  }
  const m = rings[0].length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = rings[i];
    const c = rings[(i + 1) % n];
    for (let k = 0; k < m; k++) {
      const k1 = (k + 1) % m;
      indices.push(a[k], a[k1], c[k1], a[k], c[k1], c[k]);
    }
  }
  if (!closed) {
    for (const [i, out] of [
      [0, false],
      [n - 1, true],
    ] as const) {
      const centre = positions.length / 3;
      positions.push(...path[i]);
      const first = positions.length / 3;
      for (const p of ringPts[i]) positions.push(...p);
      for (let k = 0; k < m; k++) {
        const k1 = (k + 1) % m;
        if (out) indices.push(centre, first + k, first + k1);
        else indices.push(centre, first + k1, first + k);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

/**
 * A thin surface from rings of points (ring 0 the outline, the last ring a single point repeated), as two layers
 * `thickness` apart, one facing `up` and one away from it (the open edge hides inside the frame).
 */
function membrane(rings: Vec[][], up: (p: Vec) => Vec, thickness: number): BufferGeometry {
  const m = rings[0].length;
  const layer = (offset: number, flip: boolean) => {
    const positions: number[] = [];
    for (const ring of rings) for (const p of ring) positions.push(...add(p, mul(up(p), offset)));
    const idx: number[] = [];
    for (let i = 0; i + 1 < rings.length; i++) {
      for (let k = 0; k < m; k++) {
        const k1 = (k + 1) % m;
        const [a, b, c, d] = [i * m + k, i * m + k1, (i + 1) * m + k1, (i + 1) * m + k];
        idx.push(a, b, c, a, c, d);
      }
    }
    // face `up` (or away from it): check one triangle in the middle of the outline's first band
    const p = (j: number): Vec => [positions[3 * j], positions[3 * j + 1], positions[3 * j + 2]];
    const nrm = cross(sub(p(idx[1]), p(idx[0])), sub(p(idx[2]), p(idx[0])));
    const facesUp = dot(nrm, up(p(idx[0]))) > 0;
    if (facesUp === flip) for (let t = 0; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(positions, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  };
  return mergeGeometries([layer(thickness / 2, false), layer(-thickness / 2, true)])!;
}

/** Rings from an outline in towards a centre point (`count` rings, the last one the point). */
function ringsTo(outline: Vec[], centre: Vec, count: number, lift: (s: number, p: Vec) => Vec): Vec[][] {
  return Array.from({ length: count + 1 }, (_, k) => {
    const s = 1 - k / count; // 1 at the outline, 0 at the centre
    return outline.map((p) => lift(s, lerp(centre, p, s)));
  });
}

/** A rounded box from its centre, size and rotation (radians about x, then y). */
function roundedBox(centre: Vec, size: Vec, radius: number, rx = 0, ry = 0): BufferGeometry {
  return new RoundedBoxGeometry(size[0], size[1], size[2], 2, radius).rotateX(rx).rotateY(ry).translate(...centre);
}

/** A cylinder from a to b (radius at a, radiusB at b). */
function rod(a: Vec, b: Vec, radius: number, radial = 14, radiusB = radius): BufferGeometry {
  const d = sub(b, a);
  // CylinderGeometry stands along +y with radiusTop at +y: turn +y onto a → b
  const g = new CylinderGeometry(radiusB, radius, Math.hypot(...d), radial);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...unit(d))));
  const m = mul(add(a, b), 0.5);
  return g.translate(m[0], m[1], m[2]);
}

/** Merge pieces into one indexed geometry (positions and normals only; RoundedBoxGeometry comes without an index). */
const merge = (gs: BufferGeometry[]) => {
  const indexed = gs.map((g) => {
    g.deleteAttribute("uv");
    return g.index ? g : mergeVertices(g, 1e-4);
  });
  const out = mergeGeometries(indexed);
  if (!out) throw new Error("could not merge");
  return out;
};

// ---- the seat: outline (plan, centred on the seat), frame height and the mesh ----
const seatOutline: P2[] = (() => {
  const [hw, hd] = [SEAT.width / 2, SEAT.depth / 2];
  const right: P2[] = [
    [12, hd - 0.4],
    [hw - 4.3, hd - 2.6],
    [hw - 0.5, hd - 7.6],
    [hw, hd - 15],
    [hw - 0.8, 0],
    [hw - 2.1, -8],
    [hw - 3.7, -15],
    [hw - 6.4, -hd + 2.6],
    [12.5, -hd + 0.3],
  ];
  const pts: P2[] = [[0, hd], ...right, [0, -hd], ...right.slice().reverse().map(([x, z]) => [-x, z] as P2)];
  // counter-clockwise seen from above (x right, z towards the front): reverse the clockwise list
  return closedSpline(pts.reverse(), 6);
})();
/** Top of the seat frame by z (seat coordinates): highest just behind the front, where the mesh rolls over the lower front member. */
const seatFrameTop = (z: number) => SEAT_H - 1.4 + 1.4 * smoothstep(-SEAT.depth / 2, 10, z) - 2.6 * smoothstep(13, SEAT.depth / 2, z);
const FRAME_SEAT: Section = { w: 2.3, h: 2.8, r: 0.9 };
/** Deeper at the rear corners, where the seat holds the pivots (the extra depth goes downwards). */
const seatSection = (i: number): Section => {
  const [x, z] = seatOutline[i];
  const rear = smoothstep(-6, -20, z) * smoothstep(8, 20, Math.abs(x));
  return { ...FRAME_SEAT, h: FRAME_SEAT.h + 1.6 * rear };
};
const seatFramePath: Vec[] = seatOutline.map(([x, z], i) => [x, seatFrameTop(z) - seatSection(i).h / 2, z + SEAT.cz]);
const seatFrame = sweep(seatFramePath, () => [0, 1, 0], seatSection, true);
const seatMesh = (() => {
  // the mesh's edge 0.6 cm inside the frame's centre line, hidden in the frame
  const inner = seatOutline.map(([x, z]) => {
    const k = 1 - 0.6 / Math.hypot(x, z);
    return [x * k, 0, z * k] as Vec;
  });
  const rings = ringsTo(inner, [0, 0, 0], 12, (s, p) => {
    const edge = seatFrameTop(p[2]) - 0.5;
    // the dish, deepest a little behind the middle; towards the front the mesh rises to roll over the frame
    const dish = 1.6 * (1 - s * s) * (1 - 0.35 * smoothstep(0, 20, p[2]));
    const waterfall = 1.2 * smoothstep(8, 18, p[2]) * (1 - s * s);
    return [p[0], edge - dish + waterfall, p[2] + SEAT.cz];
  });
  return membrane(rings, () => [0, 1, 0], 0.25);
})();

// ---- the back: outline in its own (u across, v up) coordinates, mapped onto a curved, reclined surface ----
const backRight: P2[] = (
  [
    [10, 0.2],
    [15.5, 1.2],
    [19.2, 3.8],
    [20.6, 7.5],
    [20, 12],
    [18.2, 17],
    [17.4, 22],
    [18, 28],
    [19.9, 34.5],
    [22.2, 41],
    [23.6, 46.5],
    [23, 50.8],
    [19.2, 53.5],
    [10.5, 54.6],
  ] as P2[]
).map(([u, v]) => [u, v * BACK.stretch]);
const BACK_TOP = 54.9 * BACK.stretch;
const backPoints: P2[] = [[0, 0], ...backRight, [0, BACK_TOP], ...backRight.slice().reverse().map(([u, v]) => [-u, v] as P2)];
const backOutline: P2[] = closedSpline(backPoints.reverse(), 5);
const backZ0 = SEAT.cz - SEAT.depth / 2 - 0.6;
const tilt = BACK.tilt * DEG;
/** The back's surface: point (u, v) in 3D. */
const backPoint = (u: number, v: number): Vec => {
  const bulge = BACK.lumbar * Math.exp(-(((v - 15) / 10) ** 2)) - 2.2 * smoothstep(36, BACK_TOP, v);
  const wrapR = 42 + 30 * Math.exp(-(((v - 20) / 14) ** 2)); // curved across: tightest at the bottom and the top
  const forward = bulge + (u * u) / (2 * wrapR);
  return [u, BACK.y0 + v * Math.cos(tilt) + forward * Math.sin(tilt), backZ0 - v * Math.sin(tilt) + forward * Math.cos(tilt)];
};
/** The back's forward normal at (u, v). */
const backNormal = (u: number, v: number): Vec => {
  const e = 0.05;
  const du = sub(backPoint(u + e, v), backPoint(u - e, v));
  const dv = sub(backPoint(u, v + e), backPoint(u, v - e));
  return unit(cross(du, dv)); // u right, v up: du × dv points forwards (+z)
};
const FRAME_BACK: Section = { w: 2.5, h: 3.1, r: 1.0 };
const backFrame = sweep(
  backOutline.map(([u, v]) => backPoint(u, v)),
  (i) => backNormal(backOutline[i][0], backOutline[i][1]),
  (i) => {
    const v = backOutline[i][1];
    // the lower loop is the structural part: deeper and wider below the waist
    const low = 1 - smoothstep(6, 20, v);
    return { w: FRAME_BACK.w + 1.4 * low, h: FRAME_BACK.h + 1.0 * low, r: FRAME_BACK.r };
  },
  true,
);
const backMesh = (() => {
  const inner = backOutline.map(([u, v]) => {
    const [cu, cv] = [0, 27];
    const d = Math.hypot(u - cu, v - cv) || 1;
    const k = 1 - 1.1 / d;
    return [cu + (u - cu) * k, cv + (v - cv) * k] as P2;
  });
  const rings = ringsTo(
    inner.map(([u, v]) => [u, v, 0] as Vec),
    [0, 27, 0],
    14,
    (_, p) => backPoint(p[0], p[1]),
  );
  return membrane(rings, () => backNormal(0, 27), 0.25);
})();

// ---- the Y support behind the back, the PostureFit pad ----
const behind = (u: number, v: number, d: number): Vec => sub(backPoint(u, v), mul(backNormal(u, v), d));
const yStem: Vec[] = Array.from({ length: 9 }, (_, i) => behind(0, 1 + (i / 8) * 21, 2.6));
const yArm = (sx: number): Vec[] =>
  Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    const u = sx * (0.5 + 20.3 * t ** 1.15);
    const v = 22 + 18.5 * t;
    return behind(u, v, 2.6 * (1 - t) + 1.8 * t);
  });
const ySupport = merge([
  sweep(yStem, (i) => backNormal(0, 1 + (i / 8) * 21), (i) => ({ w: 6.2 - 2.4 * (i / 8), h: 2.4, r: 0.9 }), false),
  sweep(yArm(1), (i) => backNormal(i / 8 * 20, 22 + 18.5 * (i / 8)), () => ({ w: 3.2, h: 2.2, r: 0.8 }), false),
  sweep(yArm(-1), (i) => backNormal(-(i / 8) * 20, 22 + 18.5 * (i / 8)), () => ({ w: 3.2, h: 2.2, r: 0.8 }), false),
  // the PostureFit pad, a rounded pad behind the mesh above the stem's root (deep enough to stay clear of the lumbar curve)
  (() => {
    const c = behind(0, 13, 2.6);
    return roundedBox(c, [13, 9.5, 2.2], 1.0, tilt);
  })(),
]);

// ---- the arms ----
const POST_X = SEAT.width / 2 + 3.6;
const POST_Z = SEAT.cz - SEAT.depth / 2 + 9;
const PAD = { length: 25.5, width: 9.2, thick: 2.8 };
const arms = merge(
  [1, -1].flatMap((sx) => {
    const corner = behind(sx * 19.8, 6, 0.4);
    const bracket: Vec[] = [corner, [sx * (POST_X - 1.5), SEAT_H - 4.5, POST_Z - 3], [sx * POST_X, SEAT_H - 3.5, POST_Z]];
    const post: Vec[] = [[sx * POST_X, SEAT_H - 6, POST_Z], [sx * POST_X, ARM_TOP - PAD.thick + 0.5, POST_Z + 1.2]];
    return [
      sweep(bracket, () => [0, 1, 0], () => ({ w: 3.4, h: 4.2, r: 1.1 }), false),
      sweep(post, () => [0, 0, 1], () => ({ w: 2.6, h: 4.4, r: 0.9 }), false),
      // the pad: a rounded slab along z, its back end over the post
      roundedBox([sx * (POST_X - 0.6), ARM_TOP - PAD.thick / 2, POST_Z + PAD.length / 2 - 5.5], [PAD.width, PAD.thick, PAD.length], 1.3),
    ];
  }),
);

// ---- under the seat: mechanism, levers, column ----
const MECH = { y0: SEAT_H - 11.5, y1: SEAT_H - 4.2 };
const mechanism = merge([
  roundedBox([0, (MECH.y0 + MECH.y1) / 2, 1.5], [21, MECH.y1 - MECH.y0, 24], 1.6),
  // the tension knob, pointing forwards under the front of the mechanism
  rod([0, MECH.y0 + 1.6, 13], [0, MECH.y0 + 1.6, 18.5], 2.1, 18),
  // a lever on each side, with a round grip
  rod([-21.5, MECH.y0 + 2.4, 8], [21.5, MECH.y0 + 2.4, 8], 0.65, 10),
  rod([-25.5, MECH.y0 + 2.4, 8], [-21, MECH.y0 + 2.4, 8], 1.4, 14),
  rod([21, MECH.y0 + 2.4, 8], [25.5, MECH.y0 + 2.4, 8], 1.4, 14),
  // the side brackets from the mechanism up to the seat frame
  roundedBox([SEAT.width / 2 - 4, SEAT_H - 6, -4], [3, 5, 20], 1.0),
  roundedBox([-(SEAT.width / 2 - 4), SEAT_H - 6, -4], [3, 5, 20], 1.0),
  // and from the mechanism's back to the bottom of the back
  sweep([[0, MECH.y0 + 3, -9], [0, MECH.y0 + 3.5, backZ0 + 2], behind(0, 1.5, 1.6)], () => [0, 1, 0], () => ({ w: 7, h: 3.6, r: 1.2 }), false),
]);

// ---- the base: hub, five legs, column, castors ----
const HUB = { r: 4.6, y0: 10.2, y1: 16.6 };
const COLUMN = { sleeve: 2.75, piston: 1.55, joint: 31 };
const legs: BufferGeometry[] = [];
const castors: BufferGeometry[] = [];
for (let k = 0; k < 5; k++) {
  const a = k * 72 * DEG; // 0 = forwards (+z)
  const dir: Vec = [Math.sin(a), 0, Math.cos(a)];
  const at = (rho: number, y: number): Vec => add(mul(dir, rho), [0, y, 0]);
  // the leg: thick at the hub, arching down to the castor
  const path: Vec[] = Array.from({ length: 10 }, (_, i) => {
    const t = i / 9;
    const rho = HUB.r - 1 + t * (BASE.castor + 1.6 - HUB.r + 1);
    return at(rho, 13.6 - 3.6 * t - 0.9 * Math.sin(Math.PI * t));
  });
  legs.push(sweep(path, () => [0, 1, 0], (i) => {
    const t = i / 9;
    return { w: 4.6 - 1.3 * t, h: 5.2 - 2.6 * t, r: 1.0 };
  }, false));
  // castor: stem, housing and twin wheels rolling outwards
  const stem = at(BASE.castor, 0);
  castors.push(rod([stem[0], 6.9, stem[2]], [stem[0], 9.6, stem[2]], 0.75, 12));
  const wheelC = at(BASE.castor + 1.3, BASE.wheel);
  const side: Vec = [Math.cos(a), 0, -Math.sin(a)]; // the axle, across the leg
  castors.push(new SphereGeometry(3.0, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.05, 1.15, 1.25).rotateY(a).translate(wheelC[0], BASE.wheel + 0.9, wheelC[2]));
  for (const s of [-1, 1]) {
    const c = add(wheelC, mul(side, s * 1.25));
    castors.push(rod(add(c, mul(side, -0.75)), add(c, mul(side, 0.75)), BASE.wheel, 20));
  }
}
const base = merge([
  ...legs,
  new CylinderGeometry(HUB.r - 0.4, HUB.r, HUB.y1 - HUB.y0, 24).translate(0, (HUB.y0 + HUB.y1) / 2, 0),
  new CylinderGeometry(COLUMN.sleeve, COLUMN.sleeve, COLUMN.joint - HUB.y1 + 0.5, 24).translate(0, (COLUMN.joint + HUB.y1 - 0.5) / 2, 0),
  new CylinderGeometry(COLUMN.piston, COLUMN.piston, MECH.y0 - COLUMN.joint + 0.6, 18).translate(0, (MECH.y0 + COLUMN.joint + 0.6) / 2, 0),
]);
const castorGeometry = merge(castors);

// ---- assemble, measure, export in metres ----
const frame = merge([seatFrame, backFrame, ySupport, arms, mechanism]);
const mesh = merge([seatMesh, backMesh]);
const all: [string, BufferGeometry, MeshStandardMaterial][] = [
  ["frame", frame, new MeshStandardMaterial({ name: "Frame", color: "#3b3c3e", roughness: 0.55 })],
  ["mesh", mesh, new MeshStandardMaterial({ name: "Mesh", color: "#45464a", roughness: 0.9 })],
  ["base", base, new MeshStandardMaterial({ name: "Base", color: "#3b3c3e", roughness: 0.5 })],
  ["castors", castorGeometry, new MeshStandardMaterial({ name: "Castors", color: "#141414", roughness: 0.6 })],
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
// centre in x and z, stand on y = 0; the item's box is the model's box
const shift: Vec = [-(box.min[0] + box.max[0]) / 2, -box.min[1], -(box.min[2] + box.max[2]) / 2];
const size: Vec = sub(box.max, box.min);
const chair = new Group();
chair.name = "office-chair-aeron";
for (const [name, g, material] of all) {
  g.translate(shift[0], shift[1], shift[2]);
  g.scale(0.01, 0.01, 0.01);
  const m = new Mesh(g, material);
  m.name = name;
  chair.add(m);
}
const dir = resolve(import.meta.dirname, "..", "..", "catalogue", "office-chair-aeron");
mkdirSync(dir, { recursive: true });
const glb = (await new GLTFExporter().parseAsync(chair, { binary: true })) as ArrayBuffer;
writeFileSync(resolve(dir, "model.glb"), Buffer.from(glb));

// ---- item.json: dimensions from the model, simple collision parts ----
const up = (v: number) => Math.ceil(v * 10 - 1e-6) / 10;
const dims = { width: up(size[0]), depth: up(size[2]), height: up(size[1]) };
const [sx, sy, sz] = shift;
const backC = add(behind(0, 27, 0.5), shift);
const collisionParts: Part[] = [
  // one block along each leg, from the hub out to the castor
  ...Array.from({ length: 5 }, (_, k) => {
    const a = k * 72 * DEG;
    return { name: `base leg ${k + 1}`, shape: "box", size: { x: 6, y: 14, z: 30 }, position: { x: r(sx + 19 * Math.sin(a)), y: r(7 + sy), z: r(sz + 19 * Math.cos(a)) }, ...(k > 0 && { rotation: { y: -k * 72 } }), material: "base" } as Part;
  }),
  { name: "column", shape: "cylinder", radius: 3, height: r(MECH.y0 - 14), position: { x: r(sx), y: r((MECH.y0 + 14) / 2 + sy), z: r(sz) }, material: "base" } as Part,
  { name: "seat", shape: "box", size: { x: r(SEAT.width + 1), y: r(SEAT_H - MECH.y0 + 1), z: r(SEAT.depth + 1) }, position: { x: 0, y: r((SEAT_H + 1 + MECH.y0) / 2 + sy), z: r(SEAT.cz + sz) }, material: "frame" } as Part,
  { name: "back", shape: "box", size: { x: 48, y: 55, z: 9 }, position: { x: 0, y: r(backC[1]), z: r(backC[2]) }, rotation: { x: -BACK.tilt }, material: "frame" } as Part,
  { name: "arms", shape: "box", size: { x: r(PAD.width + 1), y: r(ARM_TOP - SEAT_H + 6), z: r(PAD.length) }, position: { x: r(POST_X - 0.6), y: r((ARM_TOP + SEAT_H - 6) / 2 + sy), z: r(POST_Z + PAD.length / 2 - 5.5 + sz) }, mirror: ["x"], material: "frame" } as Part,
];
const path = writeItem(
  {
    $schema: "../../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: "office-chair-aeron",
    name: "Office chair, Herman Miller Aeron (size B)",
    category: "seating",
    tags: ["office", "desk chair", "task chair", "ergonomic", "mesh", "herman miller", "castors"],
    dimensions: dims,
    placement: { type: "floor" },
    geometry: { type: "model", src: "model.glb", materialMap: { Frame: "frame", Mesh: "mesh", Base: "base" } },
    materialSlots: {
      frame: { label: "Frame and arms", default: "plastic.graphite", allowed: ["plastic.*", "lacquer.*"] },
      mesh: { label: "Mesh", default: "fabric.mesh-graphite", allowed: ["fabric.*"] },
      base: { label: "Base", default: "plastic.graphite", allowed: ["plastic.*", "metal.chrome", "metal.brushed-steel", "metal.stainless"] },
    },
    clearance: { back: 45, note: "Room to push the chair back from the desk" },
    collision: "parts",
    collisionParts,
    productUrl: "https://www.hermanmiller.com/products/seating/office-chairs/aeron-chair/",
    notes: `Herman Miller Aeron Chair (Remastered, design Don Chadwick and Bill Stumpf), size B, graphite, with fully adjustable arms. model.glb is generated by \`npx tsx tools/models/office-chair-aeron.ts\` from its own geometry after Herman Miller's photos and size-B line drawing. Herman Miller's EU sizes: seat 51.4 cm wide and 46.2 deep, back 53 cm high, base Ø 69.9 cm, overall height the seat height + 50 cm; its US specs give 71.9 cm overall width and 69.8–71.9 cm depth. Shown with the seat at ${SEAT_H} cm (adjustable about 45–58 cm with the high cylinder) and the arms ${ARM_TOP - SEAT_H} cm above it (19–29 cm), so they slide under a desk top at 72 cm. The mesh is drawn solid.`,
  },
  "office-chair-aeron/item.json",
);

// ---- report ----
const cm = (v: number) => v.toFixed(1);
console.log(`wrote ${resolve(dir, "model.glb")} (${(glb.byteLength / 1024).toFixed(0)} KB) and ${path}`);
console.log(`box ${cm(size[0])} W × ${cm(size[2])} D × ${cm(size[1])} H cm; dimensions ${dims.width} × ${dims.depth} × ${dims.height}`);
console.log(`seat crest ${SEAT_H}, arm tops ${ARM_TOP}, back top ${cm(Math.max(...backOutline.map(([u, v]) => backPoint(u, v)[1])))}, base Ø ${cm(2 * (BASE.castor + 1.3 + BASE.wheel))}`);
console.log(`back width: top ${cm(2 * 23.6)}, waist ${cm(2 * 17.4)}, bottom ${cm(2 * 20.6)}; seat ${SEAT.width} × ${SEAT.depth}`);
