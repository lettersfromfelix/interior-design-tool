/**
 * npx tsx tools/models/wardrobe-wall-bed-alcove.ts [width] — writes the fitted wardrobe wall with a bed alcove in three
 * versions, and the headboard box made for their alcove:
 * - catalogue/wardrobe-wall-bed-alcove.json: the original, after the user's inspiration photo;
 * - catalogue/wardrobe-wall-bed-alcove-r5.json: the same with small top corners, a radius of 5 cm instead of 34;
 * - catalogue/wardrobe-wall-bed-alcove-low.json: the original's corners under taller top cabinets, so the alcove is
 *   lower;
 * - catalogue/headboard-box-alcove-177.json: a box exactly as wide as the alcove, standing against its back panel as a
 *   headboard with a ledge on top.
 * They are parametric items made of primitives, so the app draws, recolours and collides them like any other item; this
 * script only does the arithmetic.
 *
 * `width` is the clear width of the wall in cm. The default, 292, is the plan value of checklist M04, the short wall of
 * Zimmer 13.0 on the bathroom side, which hasn't been measured yet. The alcove keeps its size; the two side columns
 * take up the difference. After measuring M04, run the script with the measured width, then `npm run validate`.
 *
 * The original, after the user's inspiration photo (a bed alcove lined in walnut between panelled wardrobes; the photo
 * stays out of the repository) and the user's wish for cupboards on the left, on the right and above the bed, as seen
 * from the front (x = 0 in the middle, z = 0 halfway through the 60 cm depth, the back against the wall):
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
 * The two newer versions are made for the headboard box and a bed without a headboard (bed-boxspring-160x200) in front
 * of it: their sconces sit 10 cm above the box, and they have no niches (the box's top is the ledge). The low version's
 * alcove is as low as the sconces allow there: their backplates end 3 cm below where the corners start. In wood, the
 * grain runs up their doors, fillers and the mouldings' verticals, as on the box; the original's parts are as shipped,
 * with the grain across.
 *
 * The headboard box is 177 cm wide, 125 high and 22 deep. Its item is 24 cm deep: it includes the 2 cm of the alcove's
 * back panel, so wall snap puts the box flush against the panel. Its front matches the wardrobe: a plinth recessed on
 * the columns' plinth line, three panels with the doors' joints and mouldings (the module of the top cabinets above),
 * and a top. 125 cm is a boxspring headboard's height (XXXLutz BOXXX 116 cm, IKEA DUNVIK 120 cm) plus about 10 cm, as
 * the user asked.
 *
 * In the 2D plan the parts above the bed are left out, and the top cabinets show as a dashed outline, so the plan
 * shows the bed in the alcove. The thin fronts above it stay in: parts left out of the plan are left out of the card
 * thumbnail too (its camera sees only what both views show). For the same reason the top cabinets have a back board
 * that the thumbnail sees from above, where the plan leaves out their top.
 *
 * Colours, calibrated against the photo in the app's straight-on view: the fronts in lacquer.white render like the
 * photo's lit doors (#D9D6CE against #D4D5D8). The lining defaults to wood.walnut-natural, a lighter walnut with a
 * broad figure: the app has no light bouncing into the alcove, and wood.walnut renders the back panel #5D3713 there,
 * against the photo's #775038 (wood.walnut-natural: #754D2F). Every finish slot (fronts, lining, box) takes lacquer,
 * paint and wood, so the colorways below and any other combination work, including one colour for everything.
 */
import type { Part } from "../../src/core/schema/common";
import { writeItem } from "./parametric";

const arg = process.argv[2];
const W = arg === undefined ? 292 : Number(arg);

type R2 = readonly [number, number];
type Slot = "fronts" | "lining" | "metal" | "shades" | "box";

// overall
const D = 60; // depth
const H = 255; // floor to ceiling (ceilingHeight in data/apartment.json)
// the alcove, in every version
const C = 177; // clear width
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
// niche, in the cheek (x: into the column, from the cheek's face); the original only
const NICHE_Y: R2 = [58, 88];
const NICHE_Z: R2 = [-13, 7];
const NICHE_DEPTH = 12;
const NICHE_BOARD = 1;
// sconce, on the cheek
const SCONCE_Z = -3; // 25 cm in front of the back panel
const PLATE = 0.8; // how far the oval backplate stands out
const PLATE_R = 10; // the backplate is 20 cm high, its centre 7 cm above the bottom of the shade
const ARM = 4.6; // from the backplate to the shade
const SHADE_R = 5;
const SHADE_H = 10; // cylinder; the dome sits on top
// the headboard box: visible size; the item adds the back panel's depth behind it
const BOX = { height: 125, depth: 22, top: 2, panels: 3 };
const SCONCE_ABOVE_BOX = 10; // the newer versions: from the box's top to the bottom of the shades

interface Version {
  id: string;
  name: string;
  A: number; // clear height, floor to soffit
  R: number; // inner radius of the top corners
  niches: boolean;
  shade: number; // bottom of the sconce shades
  grainUp: boolean; // in wood, the grain runs up the doors, the fillers and the mouldings' verticals
  about: string; // what sets it apart, for the notes
}
const ORIGINAL = "wardrobe-wall-bed-alcove";
const BOX_ID = "headboard-box-alcove-177";
const BED_ID = "bed-boxspring-160x200";
const NEW_SHADE = BOX.height + SCONCE_ABOVE_BOX;
const VERSIONS: Version[] = [
  // the original as shipped: its doors' grain runs across
  { id: ORIGINAL, name: "Wardrobe wall with bed alcove", A: 205, R: 34, niches: true, shade: 103, grainUp: false, about: "" },
  {
    id: `${ORIGINAL}-r5`,
    name: "Wardrobe wall with bed alcove, small corners",
    A: 205,
    R: 5,
    niches: false,
    shade: NEW_SHADE,
    grainUp: true,
    about: `A version of ${ORIGINAL} with small top corners in the alcove: a radius of 5 cm inside (8 cm outside) instead of 34, the walnut band following it.`,
  },
  {
    id: `${ORIGINAL}-low`,
    name: "Wardrobe wall with bed alcove, lower alcove",
    A: 189,
    R: 34,
    niches: false,
    shade: NEW_SHADE,
    grainUp: true,
    about: `A version of ${ORIGINAL} with taller top cabinets and a lower alcove: 189 cm high instead of 205, under top cabinets 60 cm high instead of 44. The joint between the tall and the upper doors of the side columns moves down to the same line, so the wall still reads as one piece; the corners are the original's (34 cm inside).`,
  },
];

/** Rounded to 0.01 cm, without -0. */
const r = (v: number) => Math.round(v * 100) / 100 + 0;
const mid = ([a, b]: R2) => (a + b) / 2;
const len = ([a, b]: R2) => b - a;
const fmt = (n: number) => `${r(n)}`;

const ZB = -D / 2; // back, against the wall
const ZD = ZB + D - M_PROUD; // front of the doors and of the walnut band (the mouldings stand out to D / 2)
const ZC = ZD - DOOR; // front of the carcass
const ZA = ZB + BACK; // back of the alcove: the back panel's front face
const XA = C / 2; // the cheek's face in the alcove
const XI = XA + T; // inner edge of the side columns = outer edge of the band
const XW = W / 2; // the walls
const XF = XW - FILLER; // fillers against the walls
const YT = H - TOP; // top of the doors and the carcass
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
function grainUp(name: string, faces: "x" | "z", x: R2, y: R2, z: R2, e: Extra = {}, material: Slot = "lining"): Part {
  const size = faces === "z" ? step(len(y), len(x), len(z)) : step(len(x), len(z), len(y));
  return {
    name,
    shape: "box",
    size,
    ...(e.cornerRadius ? { cornerRadius: e.cornerRadius } : {}),
    ...tail({ x: mid(x), y: mid(y), z: mid(z) }, material, { ...e, rotation: faces === "z" ? { z: 90 } : { x: -90 } }),
  };
}

interface MouldingOptions {
  mirror?: Extra["mirror"];
  copies?: { count: number; step: number };
  mirrorVerticals?: boolean;
  front?: number; // the face they stand on (default: the wardrobe's doors)
  material?: Slot;
  grainUp?: boolean; // the verticals' grain runs along them
}
/** Mouldings: the four bars of a frame [x0, x1] × [y0, y1] on the door fronts; `copies` repeats the frame along x. */
function mouldings(name: string, fx: R2, fy: R2, e: MouldingOptions = {}): Part[] {
  const bar = { cornerRadius: M_PROUD / 2 - 0.05, plan: "hidden" as const, mirror: e.mirror };
  const front = e.front ?? ZD;
  const material = e.material ?? "fronts";
  const z: R2 = [front, front + M_PROUD];
  const across = e.copies && { count: e.copies.count, step: step(e.copies.step) };
  const verticalsExtra: Extra = {
    ...bar,
    // both bars of a frame, or the left bars of the copies, mirrored onto their right bars
    repeat: across ?? { count: 2, step: step(len(fx) - M_WIDTH) },
    ...(e.mirrorVerticals && { mirror: ["x"] }),
  };
  const verticalX: R2 = [fx[0], fx[0] + M_WIDTH];
  const verticals = e.grainUp
    ? grainUp(`${name}, verticals`, "z", verticalX, fy, z, verticalsExtra, material)
    : box(`${name}, verticals`, verticalX, fy, z, material, verticalsExtra);
  const rows = [fy[0], fy[1] - M_WIDTH].map((y0, i) =>
    box(`${name}, ${i === 0 ? "bottom" : "top"} bars`, fx, [y0, y0 + M_WIDTH], z, material, { ...bar, ...(across && { repeat: across }) }),
  );
  return [verticals, ...rows];
}

/** The parts of one version of the wardrobe wall, and the numbers its notes and the report need. */
function wardrobe(v: Version) {
  const { A, R } = v;
  const J = A + T; // joint between tall and upper doors = top of the band = bottom of the top cabinets

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

  const carcass: Part[] = v.niches
    ? [
        box("carcass", [NX[1], XW], [PLINTH, YT], [ZB, ZC], "fronts", MX),
        box("carcass beside the alcove, below the niche", NX, [PLINTH, NY[0]], [ZB, ZC], "fronts", MX),
        box("carcass beside the alcove, above the niche", NX, [NY[1], YT], [ZB, ZC], "fronts", MX),
        box("carcass behind the niche", NX, NY, [ZB, NZ[0]], "fronts", MX),
        box("carcass in front of the niche", NX, NY, [NZ[1], ZC], "fronts", MX),
      ]
    : [box("carcass", [XI, XW], [PLINTH, YT], [ZB, ZC], "fronts", MX)];
  /** An upright front part: its grain runs up in the versions that ask for it. */
  const upright = (name: string, x: R2, y: R2, z: R2, e: Extra = {}) =>
    v.grainUp ? grainUp(name, "z", x, y, z, e, "fronts") : box(name, x, y, z, "fronts", e);
  const frames = { ...MX, grainUp: v.grainUp };
  const columns: Part[] = [
    box("plinth", [XI, XW], [0, PLINTH], [ZB, ZD - PLINTH_RECESS], "fronts", MX),
    ...carcass,
    upright("fillers against the walls", [XF, XW], [PLINTH, YT], [ZC, ZD], MX),
    upright("tall doors", doorX, tallY, [ZC, ZD], { cornerRadius: 0.3, ...MX }),
    upright("upper doors", doorX, upperY, [ZC, ZD], { cornerRadius: 0.3, ...MX }),
    ...mouldings("mouldings, tall doors, upper panel", frameX, tallFrameY, frames),
    ...mouldings("mouldings, tall doors, lower panel", frameX, lowerFrameY, frames),
    ...mouldings("mouldings, upper doors", frameX, upperFrameY, frames),
  ];

  // --- the alcove's lining
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
  const cheeks: Part[] = v.niches
    ? [
        grainUp("cheeks, below the niches", "x", cheekX, [0, NICHE_Y[0]], [ZA, ZD], MX),
        grainUp("cheeks, above the niches", "x", cheekX, [NICHE_Y[1], springing], [ZA, ZD], MX),
        grainUp("cheeks, behind the niches", "x", cheekX, NICHE_Y, [ZA, NICHE_Z[0]], MX),
        grainUp("cheeks, in front of the niches", "x", cheekX, NICHE_Y, [NICHE_Z[1], ZD], MX),
      ]
    : [grainUp("cheeks", "x", cheekX, [0, springing], [ZA, ZD], MX)];
  const niches: Part[] = v.niches
    ? [
        box("niches, bottom and top", [XI, NX[1] - NICHE_BOARD], [NY[0], NICHE_Y[0]], NICHE_Z, "lining", {
          repeat: { count: 2, step: step(0, len(NICHE_Y) + NICHE_BOARD) },
          ...MX,
        }),
        box("niches, sides", [XI, NX[1] - NICHE_BOARD], NICHE_Y, [NZ[0], NICHE_Z[0]], "lining", {
          repeat: { count: 2, step: step(0, 0, len(NICHE_Z) + NICHE_BOARD) },
          ...MX,
        }),
        box("niches, back", [NX[1] - NICHE_BOARD, NX[1]], NY, NZ, "lining", MX),
      ]
    : [];
  const lining: Part[] = [
    grainUp("back panel, book-matched halves", "z", [-XI, 0], [0, J], [ZB, ZA], MX),
    ...cheeks,
    corner,
    box("soffit", [-(XA - R), XA - R], [A, J], [ZA, ZD], "lining", { plan: "hidden" }),
    ...niches,
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
    upright("top cabinet doors", topDoorX, upperY, [ZC, ZD], {
      cornerRadius: 0.3,
      repeat: { count: TOP_DOORS, step: step(topModule) },
    }),
    ...mouldings("mouldings, top cabinet doors", topFrameX, upperFrameY, {
      copies: { count: TOP_DOORS, step: topModule },
      mirrorVerticals: true,
      grainUp: v.grainUp,
    }),
    box("top panel above the columns", [XI, XW], [YT, H], [ZB, ZD], "fronts", MX),
    box("top panel above the alcove", [-XI, XI], [YT, H], [ZB, ZD], "fronts", { plan: "hidden" }),
  ];

  // --- the sconces (on the right cheek, mirrored)
  const shadeX = XA - PLATE - ARM - SHADE_R;
  const plateY = v.shade + 7;
  if (plateY + PLATE_R > springing - 2) throw new Error(`${v.id}: the sconces' backplates reach ${plateY + PLATE_R} cm, above the cheeks' straight part (${springing} cm)`);
  const sconces: Part[] = [
    { name: "sconces, backplates", shape: "sphere", radius: PLATE_R, scale: { x: PLATE / PLATE_R, y: 1, z: 0.3 }, ...tail({ x: XA, y: plateY, z: SCONCE_Z }, "metal", { mirror: ["x"], plan: "hidden" }) },
    { name: "sconces, arms", shape: "cylinder", radius: 0.5, height: r(ARM + 0.6), ...tail({ x: XA - PLATE - ARM / 2, y: v.shade + 9, z: SCONCE_Z }, "metal", { rotation: { z: 90 }, mirror: ["x"], plan: "hidden" }) },
    { name: "sconces, shades", shape: "cylinder", radius: SHADE_R, height: SHADE_H, ...tail({ x: shadeX, y: v.shade + SHADE_H / 2, z: SCONCE_Z }, "shades", { mirror: ["x"], plan: "hidden" }) },
    { name: "sconces, domes", shape: "sphere", radius: SHADE_R, ...tail({ x: shadeX, y: v.shade + SHADE_H, z: SCONCE_Z }, "shades", { mirror: ["x"], plan: "hidden" }) },
  ];

  const parts = [...columns, ...lining, spandrel, ...top, ...sconces];
  return { parts, J, depth, springing, doorX, tallY, upperY, topDoorX, plateTop: plateY + PLATE_R };
}

const COLORWAYS =
  "Colorways (fronts / lining / box): white & walnut, the default (lacquer.white / wood.walnut-natural / lacquer.white); all white (lacquer.white everywhere); all walnut (wood.walnut-natural everywhere); chocolate & walnut (lacquer.chocolate / wood.walnut-natural / lacquer.chocolate); light blue & oak (lacquer.light-blue / wood.oak-natural / lacquer.light-blue); off-white & smoked oak (lacquer.off-white / wood.oak-smoked / wood.oak-smoked). Every finish slot takes lacquer, paint and wood, so any other combination works too, including one colour for everything.";

const SLOTS = {
  fronts: { label: "Fronts and carcass", default: "lacquer.white", allowed: ["lacquer.*", "paint.*", "wood.*"] },
  lining: { label: "Alcove lining", default: "wood.walnut-natural", allowed: ["lacquer.*", "paint.*", "wood.*"] },
  metal: { label: "Sconce arms", default: "metal.brass", allowed: ["metal.brass", "metal.black-matte", "metal.chrome", "metal.stainless"] },
  shades: { label: "Sconce shades", default: "glass.opal-lit", allowed: ["glass.opal-lit", "glass.opal"] },
};

for (const v of VERSIONS) {
  const w = wardrobe(v);
  const original = v.id === ORIGINAL;
  const others = VERSIONS.filter((o) => o.id !== v.id).map((o) => o.id);
  const notes = [
    original ? "Built to the user's description and inspiration photo, not a specific product." : "Built to the user's description, not a specific product.",
    ...(original ? [] : [v.about]),
    `A fitted wardrobe wall, wall to wall and floor to ceiling, for the short wall of Zimmer 13.0 on the bathroom side: side columns with a tall and an upper door each, three top cabinets above the bed, push-to-open doors with mouldings, and 3 cm fillers against the walls.`,
    original
      ? `Between the columns, a bed alcove lined in walnut: ${fmt(C)} cm wide, ${fmt(v.A)} cm high and ${fmt(w.depth)} cm deep, with a book-matched back panel, rounded top corners, and a sconce and a niche in each side.`
      : `Between the columns, a bed alcove lined in walnut: ${fmt(C)} cm wide, ${fmt(v.A)} cm high and ${fmt(w.depth)} cm deep, with a book-matched back panel, rounded top corners and a sconce in each side.`,
    original
      ? `Bed 160 × 200 (170 cm wide) fits with ${fmt((C - 170) / 2)} cm to spare on each side, its headboard against the back panel; its own side clearance then reaches the cheeks.`
      : `Made for ${BOX_ID} (${fmt(C)} × ${BOX.depth} × ${BOX.height} cm) against the back panel and ${BED_ID} pushed against it: the sconces sit ${SCONCE_ABOVE_BOX} cm above the box, at ${fmt(v.shade)}–${fmt(v.shade + SHADE_H + SHADE_R)} cm and 25 cm in front of the back panel, and there are no niches, as the box's top is the ledge. Bed 160 × 200 with its own headboard (170 cm wide) fits too, with ${fmt((C - 170) / 2)} cm to spare on each side; a bed's side clearance reaches the cheeks.`,
    `The width, ${fmt(W)} cm, is the plan value of checklist M04, not yet measured. After measuring, rebuild the items with \`npx tsx tools/models/${ORIGINAL}.ts <width>\` (it writes all three versions): the side columns take up the difference.`,
    `No clearance zone: zones always cover a whole side, and one in front would cover the bed. The column doors need about ${Math.round(len(w.doorX))} cm in front of them; with the bed in the alcove, its side clearance covers that.`,
    original
      ? `Other versions: ${others[0]} (corners with a 5 cm radius) and ${others[1]} (a lower alcove under taller top cabinets), both made for ${BOX_ID}. That box fits this alcove's width too, but at ${BOX.height} cm it covers the niches and runs into the sconces (their shades hang at ${fmt(v.shade)}–${fmt(v.shade + SHADE_H + SHADE_R)} cm, 20–30 cm in front of the back panel).`
      : `Other versions: ${others.join(" and ")}.`,
    COLORWAYS,
  ].join(" ");
  const path = writeItem({
    $schema: "../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: v.id,
    name: v.name,
    category: "storage",
    tags: ["bedroom", "closet", "built-in", "fitted wardrobe", "alcove", "headboard", "walnut", "sconce"],
    dimensions: { width: r(W), depth: D, height: H },
    placement: { type: "floor" },
    geometry: { type: "parametric", parts: w.parts },
    materialSlots: SLOTS,
    notes,
  });
  console.log(`wrote ${path}: ${w.parts.length} parts`);
  console.log(`  alcove ${fmt(C)} wide, ${fmt(v.A)} high, ${fmt(w.depth)} deep; corners r ${v.R} inside, ${v.R + T} outside; straight cheeks to ${fmt(w.springing)}`);
  console.log(`  side columns ${fmt(XW - XI)} wide each (door ${fmt(len(w.doorX))} + filler ${FILLER}); tall doors ${fmt(len(w.tallY))} high, upper doors ${fmt(len(w.upperY))}; joint at ${fmt(w.J)}`);
  console.log(`  top cabinets ${fmt(2 * XI)} wide, ${fmt(YT - w.J)} high: ${TOP_DOORS} doors of ${fmt(len(w.topDoorX))}`);
  console.log(`  sconces: shades ${fmt(v.shade)}–${fmt(v.shade + SHADE_H)} (dome to ${fmt(v.shade + SHADE_H + SHADE_R)}), backplates to ${fmt(w.plateTop)}; niches: ${v.niches ? "yes" : "no"}`);
}

// --- the headboard box (item frame: x = 0 in the middle, z = 0 halfway through the item's depth, the back panel's
// 2 cm at the back are left free)
{
  const BD = BOX.depth + BACK; // the item's depth
  const z0 = -BD / 2 + BACK; // the box's back, against the back panel
  const zFace = BD / 2 - M_PROUD; // the panels' front face; the mouldings stand out to BD / 2
  const zC = zFace - DOOR; // front of the carcass
  const x: R2 = [-C / 2, C / 2];
  const yTop = BOX.height - BOX.top; // underside of the top
  const module = C / BOX.panels;
  const panelX: R2 = [-C / 2 + g, -C / 2 + module - g];
  const panelY: R2 = [PLINTH + g, yTop - g];
  const frameX: R2 = [panelX[0] + M_INSET, panelX[1] - M_INSET];
  const frameY: R2 = [panelY[0] + M_INSET, panelY[1] - M_INSET];
  const across = { count: BOX.panels, step: step(module) };
  const parts: Part[] = [
    box("plinth", x, [0, PLINTH], [z0, zFace - PLINTH_RECESS], "box"),
    box("carcass", x, [PLINTH, yTop], [z0, zC], "box"),
    grainUp("front panels", "z", panelX, panelY, [zC, zFace], { cornerRadius: 0.3, repeat: across }, "box"),
    ...mouldings("mouldings", frameX, frameY, {
      copies: { count: BOX.panels, step: module },
      mirrorVerticals: true,
      front: zFace,
      material: "box",
      grainUp: true,
    }),
    box("top", x, [yTop, BOX.height], [z0, zFace], "box", { cornerRadius: 0.4 }),
  ];
  const notes = [
    "Built to the user's description, not a specific product.",
    `A box exactly as wide as the bed alcove of the fitted wardrobe walls (${fmt(C)} cm), standing against the alcove's back panel as a headboard: ${fmt(C)} cm wide, ${BOX.height} high and ${BOX.depth} deep, with a ledge on top for a phone, books or a small lamp.`,
    `The item is ${BD} cm deep: it includes the ${BACK} cm of the alcove's back panel, so wall snap puts the box flush against the panel. Then slide it sideways between the cheeks: it has no play, and with the Distances aid on, the gaps to both cheeks disappear when it's centred.`,
    `Its front matches the wardrobe: a plinth recessed on the side columns' plinth line, three panels with the doors' joints and mouldings (the module of the top cabinets above) and a top.`,
    `${BOX.height} cm is a boxspring headboard's height (XXXLutz BOXXX 116 cm, IKEA DUNVIK 120 cm) plus about 10 cm; ${BED_ID} pushed against it leaves ${BOX.height - 62} cm of it above the mattress.`,
    `Made for ${ORIGINAL}-r5 and ${ORIGINAL}-low, whose sconces sit ${SCONCE_ABOVE_BOX} cm above it. It fits the original ${ORIGINAL}'s alcove too, but there it covers the niches and runs into the sconces.`,
    `Two looks: in the fronts' colour it reads as part of the wardrobe (the default, lacquer.white), in the lining's walnut as part of the alcove.`,
    COLORWAYS,
  ].join(" ");
  const path = writeItem({
    $schema: "../schemas/catalogue-item.schema.json",
    schemaVersion: 1,
    id: BOX_ID,
    name: "Headboard box for the bed alcove, 177",
    category: "bed",
    tags: ["bedroom", "headboard", "built-in", "alcove", "ledge", "panelled", "fitted wardrobe"],
    dimensions: { width: C, depth: BD, height: BOX.height },
    placement: { type: "floor" },
    geometry: { type: "parametric", parts },
    materialSlots: {
      box: { label: "Box", default: "lacquer.white", allowed: ["lacquer.*", "paint.*", "wood.*"] },
    },
    surfaces: [{ name: "top", height: BOX.height, width: C - 2, depth: r(zFace - z0 - 2), center: [0, r((z0 + zFace) / 2)] }],
    notes,
  });
  console.log(`wrote ${path}: ${parts.length} parts; box ${fmt(C)} × ${BOX.depth} × ${BOX.height} (item ${BD} deep); panels ${fmt(len(panelX))} × ${fmt(len(panelY))}`);
}
