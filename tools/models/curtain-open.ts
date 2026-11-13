/**
 * npx tsx tools/models/curtain-open.ts — writes catalogue/curtain-sheer-white-open.json and
 * catalogue/curtain-light-blue-open.json.
 *
 * One panel of a ceiling-hung curtain, pulled open to the side of a window: the stack of tight wave folds that is left
 * when the curtain is drawn back along its track. The cloth is a thin pleated band (an upright extrusion of the folds'
 * outline seen from above, a few millimetres thick), so it is solid from the front and the back and the sheer shows
 * the window through it. Each fold is a rounded crest joined to the next one, at the back, by a straight flank; the
 * crests vary a little (fixed seed), as hand-hung folds do. A thicker band at the bottom and the top makes the hem and
 * the heading; a slim track is fixed to the ceiling over the folds.
 *
 * The item stands on the floor (so it snaps flush and square to a wall, also to the angled glazing walls) and reaches
 * the ceiling with its track: 255 cm, the apartment's ceiling height. The folds keep 3 cm off the wall.
 */
import type { Part } from "../../src/core/schema/common";
import { box, r, tail, vec, writeItem, type P2 } from "./parametric";

const CEILING = 255;
const TRACK = { height: 1.8, depth: 3 }; // white ceiling track
const GLIDERS = 0.4; // between the track and the top of the cloth
const FLOOR_GAP = 1.5; // the hem ends just above the floor
const WALL_GAP = 3; // between the wall and the back of the folds
const HEM = { height: 4, extra: 0.12 }; // double hem: the band 0.12 cm thicker on each side
const HEADING = { height: 8, extra: 0.12 }; // heading tape

interface Spec {
  id: string;
  name: string;
  tags: string[];
  /** x distance between one crest and the next (front, back, front, …), cm */
  pitch: number;
  crests: number;
  /** crest radius, cm */
  radius: number;
  /** how far the crests reach in front of and behind the middle line, cm */
  reach: number;
  /** cloth thickness, cm */
  cloth: number;
  seed: number;
  fabric: string;
  notes: (d: { width: number; depth: number; height: number }) => string;
}

// a small deterministic random generator (mulberry32), so the folds come out the same every time
const random = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** The folds' middle line seen from above, [x, z] with +z towards the room: crest arcs joined by straight flanks. */
function foldLine(s: Spec): P2[] {
  const rnd = random(s.seed);
  const vary = (v: number, k: number) => v * (1 + k * (2 * rnd() - 1));
  const crests: { c: P2; r: number; front: boolean }[] = [];
  let x = 0;
  for (let i = 0; i < s.crests; i++) {
    const front = i % 2 === 0;
    const rad = vary(s.radius, 0.15);
    const reach = vary(s.reach, 0.12);
    crests.push({ c: [x, (front ? 1 : -1) * (reach - rad)], r: rad, front });
    x += vary(s.pitch, 0.1);
  }
  // the inner tangent from one crest to the next: n · (c2 − c1) = r1 + r2, n pointing to the right
  const tangents = crests.slice(1).map((b, i) => {
    const a = crests[i];
    const [dx, dz] = [b.c[0] - a.c[0], b.c[1] - a.c[1]];
    const d = Math.hypot(dx, dz);
    const alpha = Math.acos((a.r + b.r) / d);
    const turn = (s: number): P2 => [(dx * Math.cos(s) - dz * Math.sin(s)) / d, (dx * Math.sin(s) + dz * Math.cos(s)) / d];
    const n = [turn(alpha), turn(-alpha)].find(([nx]) => nx > 0)!;
    return { from: Math.atan2(n[1], n[0]), to: Math.atan2(-n[1], -n[0]) }; // angle on the first crest, on the second
  });
  const pts: P2[] = [];
  crests.forEach((k, i) => {
    // front crests run clockwise over the top (180° → 0°), back crests anticlockwise under the bottom (180° → 360°)
    let a0 = i === 0 ? Math.PI : tangents[i - 1].to;
    let a1 = i === crests.length - 1 ? (k.front ? 0 : 2 * Math.PI) : tangents[i].from;
    if (k.front) {
      while (a1 > a0) a1 -= 2 * Math.PI;
    } else {
      while (a0 < 0) a0 += 2 * Math.PI;
      while (a1 < a0) a1 += 2 * Math.PI;
    }
    const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 9)));
    for (let j = 0; j <= n; j++) {
      const a = a0 + ((a1 - a0) * j) / n;
      pts.push([k.c[0] + k.r * Math.cos(a), k.c[1] + k.r * Math.sin(a)]);
    }
  });
  return pts;
}

/** The cloth as a closed outline: the middle line moved by ±half its thickness, along the line's normals. */
function band(line: P2[], half: number): P2[] {
  const normal = (i: number): P2 => {
    const [a, b] = [line[Math.max(0, i - 1)], line[Math.min(line.length - 1, i + 1)]];
    const [dx, dz] = [b[0] - a[0], b[1] - a[1]];
    const l = Math.hypot(dx, dz) || 1;
    return [-dz / l, dx / l];
  };
  const side = (k: number) => line.map((p, i) => [r(p[0] + k * half * normal(i)[0]), r(p[1] + k * half * normal(i)[1])] as P2);
  return [...side(1), ...side(-1).reverse()];
}

function curtain(s: Spec) {
  const line = foldLine(s);
  // centre the folds in x; their back WALL_GAP in front of the item's back
  const xs = line.map((p) => p[0]);
  const zs = line.map((p) => p[1]);
  const outer = s.cloth / 2 + Math.max(HEM.extra, HEADING.extra);
  const width = Math.ceil((Math.max(...xs) - Math.min(...xs) + 2 * outer) * 10) / 10;
  const depth = Math.ceil((WALL_GAP + Math.max(...zs) - Math.min(...zs) + 2 * outer) * 10) / 10;
  const [cx, back] = [(Math.max(...xs) + Math.min(...xs)) / 2, Math.min(...zs) - outer];
  const moved = line.map(([x, z]) => [x - cx, z - back - depth / 2 + WALL_GAP] as P2);
  const middleZ = -back - depth / 2 + WALL_GAP; // where the folds' middle line (z = 0) ends up

  const top = CEILING - TRACK.height - GLIDERS;
  const extrusion = (name: string, half: number, y0: number, y1: number): Part =>
    ({ name, shape: "extrusion", points: band(moved, half), height: r(y1 - y0), ...tail(vec(0, y0), "curtain") }) as Part;
  const parts: Part[] = [
    extrusion("curtain", s.cloth / 2, FLOOR_GAP, top),
    extrusion("hem", s.cloth / 2 + HEM.extra, FLOOR_GAP, FLOOR_GAP + HEM.height),
    extrusion("heading", s.cloth / 2 + HEADING.extra, top - HEADING.height, top),
    box("ceiling track", [-width / 2 + 0.5, width / 2 - 0.5], [CEILING - TRACK.height, CEILING], [middleZ - TRACK.depth / 2, middleZ + TRACK.depth / 2], "track", { cornerRadius: 0.3 }),
  ];
  const dimensions = { width, depth, height: CEILING };
  const path = writeItem({
    $schema: "../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: s.id,
    name: s.name,
    category: "decor",
    tags: s.tags,
    dimensions,
    placement: { type: "floor" },
    geometry: { type: "parametric", parts },
    materialSlots: {
      curtain: { label: "Curtain", default: s.fabric, allowed: ["curtain.*", "fabric.*"] },
      track: { label: "Ceiling track", default: "lacquer.white", allowed: ["lacquer.white", "paint.white", "metal.brushed-steel", "metal.black-matte", "metal.brass"] },
    },
    notes: s.notes(dimensions),
  });
  console.log(`wrote ${path}: ${width} × ${depth} × ${CEILING}, ${s.crests} crests, ${band(moved, s.cloth / 2).length} outline points`);
}

const tags = ["curtain", "curtains", "drapes", "window dressing", "window", "living room", "bedroom"];
const placing = (d: { width: number; depth: number }) =>
  `Place it beside a window: like other floor items it snaps flush and square to the wall, also to the angled glazing walls, and its folds keep ${WALL_GAP} cm off it. It stands on the floor so it can snap to the wall and reaches the ceiling with its track (${CEILING} cm, the apartment's ceiling height); the cloth ends ${FLOOR_GAP} cm above the floor. It is one panel, ${d.width} cm wide and ${d.depth} cm deep including the gap at the back: duplicate it for the other side of the window. Only the folds collide, not the gap behind them.`;

curtain({
  id: "curtain-sheer-white-open",
  name: "Curtain, sheer white (open)",
  tags: [...tags, "sheer", "voile", "white"],
  pitch: 2.05,
  crests: 18,
  radius: 0.8,
  reach: 5.5,
  cloth: 0.2,
  seed: 7,
  fabric: "curtain.voile-white",
  notes: (d) =>
    `Generic sheer curtain, not a specific product: one panel of a white voile curtain on a ceiling track, pulled open to the side of a window, where it gathers into a stack of tight wave folds with a double hem and a heading tape. ${placing(d)} The voile is half transparent (curtain.voile-white, opacity 0.5): the window frame, the railing and whatever stands behind show through it, less where the folds overlap and at the hem and heading, where the cloth is double. curtain.voile-light-blue is the same voile in light blue; any curtain or fabric preset can be picked.`,
});

curtain({
  id: "curtain-light-blue-open",
  name: "Curtain, light blue (open)",
  tags: [...tags, "linen", "light blue", "blue"],
  pitch: 2.55,
  crests: 14,
  radius: 1,
  reach: 5.5,
  cloth: 0.35,
  seed: 11,
  fabric: "curtain.linen-light-blue",
  notes: (d) =>
    `Generic curtain, not a specific product: one panel of a light blue linen curtain on a ceiling track, pulled open to the side of a window, where it gathers into a stack of wave folds with a hem and a heading tape. ${placing(d)} Unlined light blue linen (curtain.linen-light-blue), the light blue of the armchairs: like real unlined linen it lets some daylight through (opacity 0.8), which shows its folds against the window; for a fully opaque curtain pick one of the fabric presets. Any curtain or fabric preset can be picked.`,
});
