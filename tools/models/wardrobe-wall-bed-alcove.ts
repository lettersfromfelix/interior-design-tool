/**
 * npx tsx tools/models/wardrobe-wall-bed-alcove.ts [width] — writes catalogue/wardrobe-wall-bed-alcove.json.
 *
 * A fitted wardrobe wall, wall to wall and floor to ceiling, after the user's inspiration photo (a bed alcove lined in
 * walnut between panelled wardrobes; the photo stays out of the repository) and the user's wish for cupboards on the
 * left, on the right and above the bed. It is a parametric item made of primitives, so the app draws, recolours and
 * collides it like any other item; this script only does the arithmetic.
 *
 * `width` is the clear width of the wall in cm. The default, 292, is the plan value of checklist M04, the short wall of
 * Zimmer 13.0 on the bathroom side, which hasn't been measured yet. The alcove keeps its size; the two side columns
 * take up the difference. After measuring M04, run the script with the measured width, then `npm run validate`.
 *
 * As seen from the front (x = 0 in the middle, z = 0 halfway through the 60 cm depth, the back against the wall):
 * - The alcove: 177 cm wide, for bed-160x200 (170 cm) with 3.5 cm on each side; 205 cm high to the soffit; 57 cm deep
 *   to the 2 cm back panel, so the bed's headboard stands against it. The top corners have a radius of 34 cm inside
 *   (37 cm outside): the photo's outer corner radius is about a fifth of the outer width. The lining is 3 cm thick, and
 *   its front edge shows as a 3 cm walnut band, flush with the doors. The back panel is book-matched (two mirrored
 *   halves with vertical grain); the grain runs up the cheeks, around the corners and across the soffit.
 * - In each cheek: a sconce (an opal shade with a domed top on a brass arm and an oval backplate) about 55–65 cm above
 *   the mattress of bed-160x200 (50 cm), and below it a niche lined in walnut, 8 cm above the mattress.
 * - The side columns: a tall door and an upper door each, and a 3 cm filler against the wall.
 * - Three top cabinets above the alcove. Their doors line up with the upper doors, and the joint below them with the
 *   top of the walnut band, so the wall reads as one piece.
 * - A plinth recessed 5 cm under the columns, and a 3 cm top panel up to the ceiling.
 * Doors are 2 cm thick with 3 mm joints, push to open (no handles), with applied mouldings 7 cm in from the edges: one
 * panel on each upper door, two on each tall door (the lower one about 29 % of the panel height, as in the photo).
 *
 * In the 2D plan the parts above the bed are left out, and the top cabinets show as a dashed outline, so the plan
 * shows the bed in the alcove. The thin fronts above it stay in: parts left out of the plan are left out of the card
 * thumbnail too (its camera sees only what both views show). For the same reason the top cabinets have a back board
 * that the thumbnail sees from above, where the plan leaves out their top.
 *
 * Colours, calibrated against the photo in the app's straight-on view: the fronts in lacquer.white render like the
 * photo's lit doors (#D9D6CE against #D4D5D8). The lining defaults to wood.walnut-natural, a lighter walnut with a
 * broad figure: the app has no light bouncing into the alcove, and wood.walnut renders the back panel #5D3713 there,
 * against the photo's #775038 (wood.walnut-natural: #754D2F).
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CatalogueItem } from "../../src/core/schema/catalogue";
import type { Part } from "../../src/core/schema/common";

const ID = "wardrobe-wall-bed-alcove";
const arg = process.argv[2];
const W = arg === undefined ? 292 : Number(arg);

// overall
const D = 60; // depth
const H = 255; // floor to ceiling (ceilingHeight in data/apartment.json)
// the alcove
const C = 177; // clear width
const A = 205; // clear height, floor to soffit
const R = 34; // inner radius of the top corners
const T = 3; // lining thickness = width of the front band
const BACK = 2; // back panel
// fronts
const DOOR = 2; // door thickness
const GAP = 0.3; // joints between doors
const PLINTH = 8;
const PLINTH_RECESS = 5;
const FILLER = 3; // against each wall
const TOP = 3; // top panel up to the ceiling
const TOP_DOORS = 3;
// mouldings
const M_INSET = 7; // from the door edges to the outside of the moulding
const M_WIDTH = 1.8;
const M_PROUD = 1;
const LOWER_SHARE = 0.29; // tall doors: the lower panel's share of the panel height
// niche, in the cheek (x: into the column, from the cheek's face)
const NICHE_Y: R2 = [58, 88];
const NICHE_Z: R2 = [-13, 7];
const NICHE_DEPTH = 12;
const NICHE_BOARD = 1;
// sconce, on the cheek
const SCONCE_Z = -3; // 25 cm in front of the back panel, like the niche
const PLATE = 0.8; // how far the oval backplate stands out
const ARM = 4.6; // from the backplate to the shade
const SHADE_R = 5;
const SHADE_Y: R2 = [103, 113]; // cylinder; the dome sits on top

type R2 = readonly [number, number];
type Slot = "fronts" | "lining" | "metal" | "shades";

/** Rounded to 0.01 cm, without -0. */
const r = (v: number) => Math.round(v * 100) / 100 + 0;
const mid = ([a, b]: R2) => (a + b) / 2;
const len = ([a, b]: R2) => b - a;

const ZB = -D / 2; // back, against the wall
const ZD = ZB + D - M_PROUD; // front of the doors and of the walnut band (the mouldings stand out to D / 2)
const ZC = ZD - DOOR; // front of the carcass
const ZA = ZB + BACK; // back of the alcove: the back panel's front face
const XA = C / 2; // the cheek's face in the alcove
const XI = XA + T; // inner edge of the side columns = outer edge of the band
const XW = W / 2; // the walls
const XF = XW - FILLER; // fillers against the walls
const YT = H - TOP; // top of the doors and the carcass
const J = A + T; // joint between tall and upper doors = top of the band = bottom of the top cabinets
const g = GAP / 2;

const MIN_WIDTH = 2 * (XI + 35 + FILLER); // doors of at least 35 cm
if (!Number.isFinite(W) || W < MIN_WIDTH) throw new Error(`width: a number of at least ${MIN_WIDTH} cm, got "${arg}"`);

interface Extra {
  cornerRadius?: number;
  rotation?: { x?: number; y?: number; z?: number };
  repeat?: { count: number; step: { x: number; y: number; z: number } };
  mirror?: ("x" | "z")[];
  plan?: "solid" | "dashed" | "hidden";
}
const step = (x = 0, y = 0, z = 0) => ({ x: r(x), y: r(y), z: r(z) });
const MX: Extra = { mirror: ["x"] };

/** The part properties after the shape's own ones, in the order the catalogue files use. */
function tail(position: { x: number; y: number; z: number }, material: Slot, e: Extra) {
  return {
    position: step(position.x, position.y, position.z),
    ...(e.rotation && { rotation: e.rotation }),
    ...(e.repeat && { repeat: e.repeat }),
    ...(e.mirror && { mirror: e.mirror }),
    ...(e.plan && { plan: e.plan }),
    material,
  };
}

/** A box spanning x, y and z (item frame). */
function box(name: string, x: R2, y: R2, z: R2, material: Slot, e: Extra = {}): Part {
  return {
    name,
    shape: "box",
    size: step(len(x), len(y), len(z)),
    ...(e.cornerRadius ? { cornerRadius: e.cornerRadius } : {}),
    ...tail({ x: mid(x), y: mid(y), z: mid(z) }, material, e),
  };
}

/**
 * A box spanning x, y and z whose wood grain runs vertically. Textures are projected onto a part before it is turned,
 * and the grain runs along the local x of vertical faces facing z, and along the local z of faces facing x.
 * `faces: "z"` (a panel facing the front): local x turned up with rotation z 90. `faces: "x"` (a cheek facing the
 * side): local z turned up with rotation x -90.
 */
function grainUp(name: string, faces: "x" | "z", x: R2, y: R2, z: R2, e: Extra = {}): Part {
  const size = faces === "z" ? step(len(y), len(x), len(z)) : step(len(x), len(z), len(y));
  return { name, shape: "box", size, ...tail({ x: mid(x), y: mid(y), z: mid(z) }, "lining", { ...e, rotation: faces === "z" ? { z: 90 } : { x: -90 } }) };
}

/** Mouldings: the four bars of a frame [x0, x1] × [y0, y1] on the door fronts; `copies` repeats the frame along x. */
function mouldings(name: string, fx: R2, fy: R2, e: { mirror?: Extra["mirror"]; copies?: { count: number; step: number }; mirrorVerticals?: boolean } = {}): Part[] {
  const bar = { cornerRadius: M_PROUD / 2 - 0.05, plan: "hidden" as const, mirror: e.mirror };
  const z: R2 = [ZD, ZD + M_PROUD];
  const across = e.copies && { count: e.copies.count, step: step(e.copies.step) };
  const verticals = box(`${name}, verticals`, [fx[0], fx[0] + M_WIDTH], fy, z, "fronts", {
    ...bar,
    // both bars of a frame, or the left bars of the copies, mirrored onto their right bars
    repeat: across ?? { count: 2, step: step(len(fx) - M_WIDTH) },
    ...(e.mirrorVerticals && { mirror: ["x"] }),
  });
  const rows = [fy[0], fy[1] - M_WIDTH].map((y0, i) =>
    box(`${name}, ${i === 0 ? "bottom" : "top"} bars`, fx, [y0, y0 + M_WIDTH], z, "fronts", { ...bar, ...(across && { repeat: across }) }),
  );
  return [verticals, ...rows];
}

// --- the side columns (built on the right, mirrored to the left)
const doorX: R2 = [XI + g, XF - g];
const tallY: R2 = [PLINTH + g, J - g];
const upperY: R2 = [J + g, YT - g];
const frameX: R2 = [doorX[0] + M_INSET, doorX[1] - M_INSET];
const upperFrameY: R2 = [upperY[0] + M_INSET, upperY[1] - M_INSET];
const panels = len(tallY) - 3 * M_INSET;
const lowerFrameY: R2 = [tallY[0] + M_INSET, tallY[0] + M_INSET + panels * LOWER_SHARE];
const tallFrameY: R2 = [lowerFrameY[1] + M_INSET, tallY[1] - M_INSET];
const NX: R2 = [XI, XA + NICHE_DEPTH + NICHE_BOARD]; // the niche's shell inside the column
const NY: R2 = [NICHE_Y[0] - NICHE_BOARD, NICHE_Y[1] + NICHE_BOARD];
const NZ: R2 = [NICHE_Z[0] - NICHE_BOARD, NICHE_Z[1] + NICHE_BOARD];

const columns: Part[] = [
  box("plinth", [XI, XW], [0, PLINTH], [ZB, ZD - PLINTH_RECESS], "fronts", MX),
  box("carcass", [NX[1], XW], [PLINTH, YT], [ZB, ZC], "fronts", MX),
  box("carcass beside the alcove, below the niche", NX, [PLINTH, NY[0]], [ZB, ZC], "fronts", MX),
  box("carcass beside the alcove, above the niche", NX, [NY[1], YT], [ZB, ZC], "fronts", MX),
  box("carcass behind the niche", NX, NY, [ZB, NZ[0]], "fronts", MX),
  box("carcass in front of the niche", NX, NY, [NZ[1], ZC], "fronts", MX),
  box("fillers against the walls", [XF, XW], [PLINTH, YT], [ZC, ZD], "fronts", MX),
  box("tall doors", doorX, tallY, [ZC, ZD], "fronts", { cornerRadius: 0.3, ...MX }),
  box("upper doors", doorX, upperY, [ZC, ZD], "fronts", { cornerRadius: 0.3, ...MX }),
  ...mouldings("mouldings, tall doors, upper panel", frameX, tallFrameY, MX),
  ...mouldings("mouldings, tall doors, lower panel", frameX, lowerFrameY, MX),
  ...mouldings("mouldings, upper doors", frameX, upperFrameY, MX),
];

// --- the alcove's walnut lining
const springing = A - R; // where the cheeks turn into the corners
const eps = 0.01; // doubled profile points keep the band's and the faces' shading apart
const depth = ZD - ZA;
const corner: Part = {
  name: "top corners",
  shape: "lathe",
  profile: [
    [R, 0],
    [R + T, 0],
    [R + T, eps],
    [R + T, depth - eps],
    [R + T, depth],
    [R, depth],
    [R, depth - eps],
    [R, eps],
    [R, 0],
  ],
  arc: 90,
  // rotation x -90 turns the lathe's axis to the depth: the quarter runs from the top (+y) to the side (+x)
  ...tail({ x: XA - R, y: springing, z: ZD }, "lining", { rotation: { x: -90 }, mirror: ["x"], plan: "hidden" }),
};
const cheekX: R2 = [XA, XI];
const lining: Part[] = [
  grainUp("back panel, book-matched halves", "z", [-XI, 0], [0, J], [ZB, ZA], MX),
  grainUp("cheeks, below the niches", "x", cheekX, [0, NICHE_Y[0]], [ZA, ZD], MX),
  grainUp("cheeks, above the niches", "x", cheekX, [NICHE_Y[1], springing], [ZA, ZD], MX),
  grainUp("cheeks, behind the niches", "x", cheekX, NICHE_Y, [ZA, NICHE_Z[0]], MX),
  grainUp("cheeks, in front of the niches", "x", cheekX, NICHE_Y, [NICHE_Z[1], ZD], MX),
  corner,
  box("soffit", [-(XA - R), XA - R], [A, J], [ZA, ZD], "lining", { plan: "hidden" }),
  box("niches, bottom and top", [XI, NX[1] - NICHE_BOARD], [NY[0], NICHE_Y[0]], NICHE_Z, "lining", {
    repeat: { count: 2, step: step(0, len(NICHE_Y) + NICHE_BOARD) },
    ...MX,
  }),
  box("niches, sides", [XI, NX[1] - NICHE_BOARD], NICHE_Y, [NZ[0], NICHE_Z[0]], "lining", {
    repeat: { count: 2, step: step(0, 0, len(NICHE_Z) + NICHE_BOARD) },
    ...MX,
  }),
  box("niches, back", [NX[1] - NICHE_BOARD, NX[1]], NY, NZ, "lining", MX),
];

// --- the fixed panels in the corners between the band and the column and top doors (front plane)
const arcPoints = (radius: number, from: number, to: number): [number, number][] =>
  Array.from({ length: Math.round(Math.abs(to - from) / 7.5) + 1 }, (_, i) => {
    const a = ((from + Math.sign(to - from) * 7.5 * i) * Math.PI) / 180;
    return [r(XA - R + radius * Math.cos(a)), r(springing + radius * Math.sin(a))];
  });
const spandrel: Part = {
  name: "panels around the top corners",
  shape: "extrusion",
  // outline as seen from the front (rotation x -90: points are [x, y], extruded backwards); the arc follows the
  // band's 12 segments per quarter
  points: [[r(XI), r(springing)], [r(XI), r(J)], ...arcPoints(R + T, 90, 7.5)],
  height: DOOR,
  ...tail({ x: 0, y: 0, z: ZD }, "fronts", { rotation: { x: -90 }, mirror: ["x"] }),
};

// --- the top cabinets above the alcove
const topModule = (2 * XI) / TOP_DOORS;
const topDoorX: R2 = [-XI + g, -XI + topModule - g];
const topFrameX: R2 = [topDoorX[0] + M_INSET, topDoorX[1] - M_INSET];
const top: Part[] = [
  box("top cabinets", [-XI, XI], [J, YT], [ZB, ZC], "fronts", { plan: "dashed" }),
  box("top cabinets, back", [-XI, XI], [J, YT], [ZB, ZA], "fronts"),
  box("top cabinet doors", topDoorX, upperY, [ZC, ZD], "fronts", {
    cornerRadius: 0.3,
    repeat: { count: TOP_DOORS, step: step(topModule) },
  }),
  ...mouldings("mouldings, top cabinet doors", topFrameX, upperFrameY, { copies: { count: TOP_DOORS, step: topModule }, mirrorVerticals: true }),
  box("top panel above the columns", [XI, XW], [YT, H], [ZB, ZD], "fronts", MX),
  box("top panel above the alcove", [-XI, XI], [YT, H], [ZB, ZD], "fronts", { plan: "hidden" }),
];

// --- the sconces (on the right cheek, mirrored)
const shadeX = XA - PLATE - ARM - SHADE_R;
const sconces: Part[] = [
  { name: "sconces, backplates", shape: "sphere", radius: 10, scale: { x: PLATE / 10, y: 1, z: 0.3 }, ...tail({ x: XA, y: 110, z: SCONCE_Z }, "metal", { mirror: ["x"], plan: "hidden" }) },
  { name: "sconces, arms", shape: "cylinder", radius: 0.5, height: r(ARM + 0.6), ...tail({ x: XA - PLATE - ARM / 2, y: 112, z: SCONCE_Z }, "metal", { rotation: { z: 90 }, mirror: ["x"], plan: "hidden" }) },
  { name: "sconces, shades", shape: "cylinder", radius: SHADE_R, height: len(SHADE_Y), ...tail({ x: shadeX, y: mid(SHADE_Y), z: SCONCE_Z }, "shades", { mirror: ["x"], plan: "hidden" }) },
  { name: "sconces, domes", shape: "sphere", radius: SHADE_R, ...tail({ x: shadeX, y: SHADE_Y[1], z: SCONCE_Z }, "shades", { mirror: ["x"], plan: "hidden" }) },
];

const parts = [...columns, ...lining, spandrel, ...top, ...sconces];
const fmt = (n: number) => `${r(n)}`;
const notes = [
  "Built to the user's description and inspiration photo, not a specific product.",
  `A fitted wardrobe wall, wall to wall and floor to ceiling, for the short wall of Zimmer 13.0 on the bathroom side: side columns with a tall and an upper door each, three top cabinets above the bed, push-to-open doors with mouldings, and 3 cm fillers against the walls.`,
  `Between the columns, a bed alcove lined in walnut: ${fmt(C)} cm wide, ${fmt(A)} cm high and ${fmt(depth)} cm deep, with a book-matched back panel, rounded top corners, and a sconce and a niche in each side.`,
  `Bed 160 × 200 (170 cm wide) fits with ${fmt((C - 170) / 2)} cm to spare on each side, its headboard against the back panel; its own side clearance then reaches the cheeks.`,
  `The width, ${fmt(W)} cm, is the plan value of checklist M04, not yet measured. After measuring, rebuild the item with \`npx tsx tools/models/${ID}.ts <width>\`: the side columns take up the difference.`,
  `No clearance zone: zones always cover a whole side, and one in front would cover the bed. The column doors need about ${Math.round(len(doorX))} cm in front of them; with the bed in the alcove, its side clearance covers that.`,
].join(" ");

const item = {
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Wardrobe wall with bed alcove",
  category: "storage",
  tags: ["bedroom", "closet", "built-in", "fitted wardrobe", "alcove", "headboard", "walnut", "sconce"],
  dimensions: { width: r(W), depth: D, height: H },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    fronts: { label: "Fronts and carcass", default: "lacquer.white", allowed: ["lacquer.*", "paint.*", "wood.*"] },
    lining: { label: "Alcove lining", default: "wood.walnut-natural", allowed: ["wood.*"] },
    metal: { label: "Sconce arms", default: "metal.brass", allowed: ["metal.brass", "metal.black-matte", "metal.chrome", "metal.stainless"] },
    shades: { label: "Sconce shades", default: "glass.opal-lit", allowed: ["glass.opal-lit", "glass.opal"] },
  },
  notes,
};
CatalogueItem.parse(item); // throws on anything the schema rejects; the file keeps this key order

/** House style: two-space indent, one part per line. */
const inline = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (v && typeof v === "object") return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }`;
  return JSON.stringify(v);
};
const { geometry, materialSlots, notes: itemNotes, ...head } = item;
const text = [
  "{",
  [
    ...Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${inline(v)}`),
    [`  "geometry": {`, `    "type": "parametric",`, `    "parts": [`, geometry.parts.map((p) => `      ${inline(p)}`).join(",\n"), `    ]`, `  }`].join("\n"),
    [`  "materialSlots": {`, Object.entries(materialSlots).map(([k, v]) => `    ${JSON.stringify(k)}: ${inline(v)}`).join(",\n"), `  }`].join("\n"),
    `  "notes": ${JSON.stringify(itemNotes)}`,
  ].join(",\n"),
  "}",
  "",
].join("\n");
const out = resolve(import.meta.dirname, `../../catalogue/${ID}.json`);
writeFileSync(out, text);

console.log(`wrote ${out}: ${parts.length} parts`);
console.log(`overall ${fmt(W)} × ${D} × ${H} cm (W × D × H)`);
console.log(`alcove ${fmt(C)} wide, ${fmt(A)} high, ${fmt(depth)} deep; corners r ${R} inside, ${R + T} outside; band ${T}`);
console.log(`side columns ${fmt(XW - XI)} wide each (door ${fmt(len(doorX))} + filler ${FILLER}); tall doors ${fmt(len(tallY))} high, upper doors ${fmt(len(upperY))}`);
console.log(`top cabinets ${fmt(2 * XI)} wide, ${fmt(YT - J)} high: ${TOP_DOORS} doors of ${fmt(len(topDoorX))}; joint at ${fmt(J)} cm`);
