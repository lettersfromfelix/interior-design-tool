/**
 * npx tsx tools/models/wardrobe-wall-bed-bridge.ts [width] — writes catalogue/wardrobe-wall-bed-bridge.json.
 *
 * The second fitted wardrobe wall for the short wall of Zimmer 13.0 (the first is wardrobe-wall-bed-alcove), after the
 * user's second inspiration photo (it stays out of the repository): flat greige slab doors, a bridge of cabinets over the
 * bed, an open niche, and a headboard panel with a slim shelf and two reading spots. Like the first, it is a parametric
 * item made of primitives, so the app draws, recolours and collides it like any other item; this script only does the
 * arithmetic.
 *
 * `width` is the clear width of the wall in cm. The default, 292, is the plan value of checklist M04, which hasn't been
 * measured yet. The bed space keeps its size; the two side columns take up the difference. After measuring M04, run the
 * script with the measured width, then `npm run validate`.
 *
 * The photo shows only the left side, with a two-door column. Two of those don't fit beside a bed on 292 cm, so each side
 * gets one column with a single door. As seen from the front (x = 0 in the middle, z = 0 halfway through the 60 cm depth,
 * the back against the wall):
 * - The bed space: 180 cm between the columns' end panels, for bed-160x200 (170 cm) with 5 cm on each side.
 * - The side columns: 2 cm end panels beside the bed whose front edges show next to the doors, as in the photo; a tall door
 *   and a top door each, with the joint at 85 % of the height (as in the photo, not level with the bridge); a long bar
 *   handle on the bed side of each tall door; a 2 cm shadow gap at the floor; 3 cm fillers against the walls.
 * - The bridge: four push-to-open doors, the underside 190 cm above the floor (room to sit up in bed), 35 cm deep, so the
 *   columns' sides show beside it. The photo's depths come from its perspective: along the column's side face, the
 *   bridge's front lies at about 0.6 and the headboard's front at about 0.35 of the way from the wall to the column's front.
 * - The niche: open between the shelf and the bridge, with a back panel in the front colour.
 * - The headboard: a panel 20 cm deep from the wall up to 113 cm, in its own material; on top a 3 cm shelf in the front
 *   colour (the photo's shelf is lighter than the panel), 18 cm deep in front of the niche's back panel. Two reading
 *   spots on round plates, 17 cm in from the ends and 12 cm below the shelf's top, their heads tilted down and towards
 *   the middle. bed-160x200's own headboard is 95 cm high: the spots stay above it (their lowest point is printed below),
 *   so the shelf, the spots and the top of the panel show above it, and the bed stands against the panel.
 * Doors are 2 cm thick with 3 mm joints; the handles stand 3 cm out, within the 60 cm depth.
 *
 * In the 2D plan the bridge shows as a dashed outline over the bed, and the top panel above it and the spots not at all.
 * Parts left out of the plan are left out of the card thumbnail too (its camera sees only what both views show), so the
 * bridge's thin doors stay in the plan, and a back board inside the bridge closes it in the thumbnail, which sees it
 * from above.
 *
 * Colours, calibrated against the photo in the app's view from the photo's camera: the fronts default to lacquer.greige,
 * which renders the doors #B8B0A5 against the photo's lit doors at #BAB2A7 (paint.greige renders them warmer, #B9AE9E).
 * The headboard defaults to wood.oak-taupe, warmer and a shade darker than the fronts, with a fine horizontal grain: it
 * renders #978571 against the photo's #978472. The handles and spots default to metal.powder-clay, close to the photo's
 * handle.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CatalogueItem } from "../../src/core/schema/catalogue";
import type { Part } from "../../src/core/schema/common";

const ID = "wardrobe-wall-bed-bridge";
const arg = process.argv[2];
const W = arg === undefined ? 292 : Number(arg);

// overall
const D = 60; // depth, handles included
const H = 255; // floor to ceiling (ceilingHeight in data/apartment.json)
// the bed space and the side columns
const C = 180; // between the end panels
const END = 2; // end panels beside the bed
const FILLER = 3; // against each wall
const TOP = 3; // top panels up to the ceiling
const DOOR = 2; // door thickness
const GAP = 0.3; // joints between doors
const TOE = 2; // shadow gap under the column doors
const J = 217; // joint between the tall and the top doors: 85 % of the height, as in the photo
// handles: a bar on two posts, on the bed side of the tall doors
const PULL = 3; // how far the handles stand out from the doors
const HANDLE: R2 = [76, 124]; // 48 cm long, centred 100 cm above the floor
const HANDLE_INSET = 2.5; // from the door's edge to the bar's centre
const BAR_X = 1.6;
const BAR_Z = 1.2;
// the bridge over the bed
const BRIDGE_DEPTH = 35;
const BRIDGE_Y = 190; // underside
const BRIDGE_DOORS = 4;
// the headboard and its shelf
const HEAD_DEPTH = 20; // from the wall to the headboard's front
const SHELF: R2 = [113, 116];
const BACK = 2; // the niche's back panel
// reading spots
const SPOT_IN = 17; // from the headboard's ends to the spots' centres
const SPOT_DROP = 12; // from the shelf's top down to the spots' centres
const SPOT_TILT = 40; // the heads point this far below the horizontal, forwards
const SPOT_TURN = 20; // and turned this far towards the middle
const PLATE_R = 3.5;
const PLATE_T = 1.2;
const JOINT_R = 1.3;
const HEAD_R = 2;
const HEAD_L = 6.5;
const LENS_R = 1.6;
const LENS_T = 0.3;
/** bed-160x200's headboard: the spots stay above it. */
const BED_HEADBOARD = 95;

type R2 = readonly [number, number];
type V3 = [number, number, number];
type Slot = "fronts" | "headboard" | "metal" | "lenses";

/** Rounded to 0.01 cm, without -0. */
const r = (v: number) => Math.round(v * 100) / 100 + 0;
const mid = ([a, b]: R2) => (a + b) / 2;
const len = ([a, b]: R2) => b - a;

const ZB = -D / 2; // back, against the wall
const ZD = D / 2 - PULL; // front of the doors and end panels; the handles stand out to D / 2
const ZC = ZD - DOOR; // front of the carcass
const ZBF = ZB + BRIDGE_DEPTH; // front of the bridge doors
const ZBC = ZBF - DOOR; // front of the bridge cabinets
const ZH = ZB + HEAD_DEPTH; // front of the headboard
const XA = C / 2; // the end panels' faces beside the bed
const XE = XA + END; // their outer faces: the columns' carcasses and doors start here
const XW = W / 2; // the walls
const XF = XW - FILLER; // fillers against the walls
const YT = H - TOP; // top of the doors and the carcasses
const g = GAP / 2;

const MIN_WIDTH = 2 * (XE + GAP + 35 + FILLER); // doors of at least 35 cm
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

// --- the side columns (built on the right, mirrored to the left)
const doorX: R2 = [XE + g, XF - g];
const tallY: R2 = [TOE, J - g];
const topY: R2 = [J + g, YT - g];
const handleX = doorX[0] + HANDLE_INSET;
const post = PULL - BAR_Z;
const columns: Part[] = [
  box("end panels beside the bed", [XA, XE], [0, H], [ZB, ZD], "fronts", MX),
  box("carcass", [XE, XW], [0, YT], [ZB, ZC], "fronts", MX),
  box("fillers against the walls", [XF, XW], [0, YT], [ZC, ZD], "fronts", MX),
  box("tall doors", doorX, tallY, [ZC, ZD], "fronts", { cornerRadius: 0.3, ...MX }),
  box("top doors", doorX, topY, [ZC, ZD], "fronts", { cornerRadius: 0.3, ...MX }),
  box("top panels above the columns", [XE, XW], [YT, H], [ZB, ZD], "fronts", MX),
  box("handles, bars", [handleX - BAR_X / 2, handleX + BAR_X / 2], HANDLE, [D / 2 - BAR_Z, D / 2], "metal", { cornerRadius: 0.55, ...MX }),
  {
    name: "handles, posts",
    shape: "cylinder",
    radius: 0.5,
    height: r(post),
    ...tail({ x: handleX, y: HANDLE[0] + 4, z: ZD + post / 2 }, "metal", { rotation: { x: 90 }, repeat: { count: 2, step: step(0, len(HANDLE) - 8) }, mirror: ["x"], plan: "hidden" }),
  },
];

// --- the bridge over the bed
const bridgeModule = C / BRIDGE_DOORS;
const bridgeDoorX: R2 = [-XA + g, -XA + bridgeModule - g];
const bridge: Part[] = [
  box("bridge cabinets", [-XA, XA], [BRIDGE_Y, YT], [ZB, ZBC], "fronts", { plan: "dashed" }),
  // inside the cabinets, so it shows only in the card thumbnail (see above)
  box("bridge cabinets, back board", [-XA + 0.1, XA - 0.1], [BRIDGE_Y + 0.1, YT - 0.1], [ZB + 0.1, ZB + BACK], "fronts"),
  box("bridge doors", bridgeDoorX, [BRIDGE_Y + g, YT - g], [ZBC, ZBF], "fronts", {
    cornerRadius: 0.3,
    repeat: { count: BRIDGE_DOORS, step: step(bridgeModule) },
  }),
  box("top panel above the bridge", [-XA, XA], [YT, H], [ZB, ZBF], "fronts", { plan: "hidden" }),
];

// --- the niche, the headboard and its shelf
const headboard: Part[] = [
  box("niche, back panel", [-XA, XA], [SHELF[1], BRIDGE_Y], [ZB, ZB + BACK], "fronts"),
  box("headboard", [-XA, XA], [0, SHELF[0]], [ZB, ZH], "headboard"),
  box("shelf", [-XA, XA], SHELF, [ZB, ZH], "fronts"),
];

// --- the reading spots (on the right, mirrored): rotation x tilts the heads' axis forwards from straight up, y turns it
// towards the middle (clockwise seen from above); rotations are applied x, then y
const tilt = (SPOT_TILT * Math.PI) / 180;
const turn = (SPOT_TURN * Math.PI) / 180;
const axis: V3 = [-Math.cos(tilt) * Math.sin(turn), -Math.sin(tilt), Math.cos(tilt) * Math.cos(turn)];
const spotX = XA - SPOT_IN;
const spotY = SHELF[1] - SPOT_DROP;
const joint: V3 = [spotX, spotY, ZH + PLATE_T + JOINT_R * 0.6];
const along = (d: number) => ({ x: joint[0] + axis[0] * d, y: joint[1] + axis[1] * d, z: joint[2] + axis[2] * d });
const headStart = 0.5; // the head's back end, beyond the ball joint's centre
const spotRotation = { x: 90 + SPOT_TILT, y: SPOT_TURN };
const spotPlan: Extra = { mirror: ["x"], plan: "hidden" };
const spots: Part[] = [
  { name: "reading spots, plates", shape: "cylinder", radius: PLATE_R, height: PLATE_T, ...tail({ x: spotX, y: spotY, z: ZH + PLATE_T / 2 }, "metal", { rotation: { x: 90 }, ...spotPlan }) },
  { name: "reading spots, joints", shape: "sphere", radius: JOINT_R, ...tail({ x: joint[0], y: joint[1], z: joint[2] }, "metal", spotPlan) },
  { name: "reading spots, heads", shape: "cylinder", radius: HEAD_R, height: HEAD_L, ...tail(along(headStart + HEAD_L / 2), "metal", { rotation: spotRotation, ...spotPlan }) },
  { name: "reading spots, lenses", shape: "cylinder", radius: LENS_R, height: LENS_T, ...tail(along(headStart + HEAD_L + LENS_T / 2), "lenses", { rotation: spotRotation, ...spotPlan }) },
];
// lowest point of the heads: the front rim, below the axis by the radius times the axis' horizontal share
const lowest = along(headStart + HEAD_L).y - HEAD_R * Math.hypot(axis[0], axis[2]);
if (lowest < BED_HEADBOARD + 2) throw new Error(`the reading spots reach down to ${r(lowest)} cm, too close to the bed's headboard (${BED_HEADBOARD} cm)`);

const parts = [...columns, ...bridge, ...headboard, ...spots];
const fmt = (n: number) => `${r(n)}`;
const notes = [
  "Built to the user's description and inspiration photo, not a specific product.",
  `The second fitted wardrobe wall for the short wall of Zimmer 13.0 on the bathroom side (the first is wardrobe-wall-bed-alcove), wall to wall and floor to ceiling, with flat greige doors: a column on each side with a tall and a top door and a long bar handle on the bed side, a bridge of four push-to-open cabinets over the bed (underside ${fmt(BRIDGE_Y)} cm, ${fmt(BRIDGE_DEPTH)} cm deep), and 3 cm fillers against the walls.`,
  `Between the columns, ${fmt(C)} cm for the bed: an open niche under the bridge, and a headboard panel ${fmt(HEAD_DEPTH)} cm deep with a shelf on top at ${fmt(SHELF[1])} cm and two reading spots.`,
  `Bed 160 × 200 (170 cm wide) stands with ${fmt((C - 170) / 2)} cm to spare on each side, its headboard against the panel; its own ${BED_HEADBOARD} cm headboard leaves the shelf and the spots in view, and its side clearance reaches the columns.`,
  `The width, ${fmt(W)} cm, is the plan value of checklist M04, not yet measured. After measuring, rebuild the item with \`npx tsx tools/models/${ID}.ts <width>\`: the side columns take up the difference.`,
  `No clearance zone: zones always cover a whole side, and one in front would cover the bed. The column doors need about ${Math.round(len(doorX))} cm in front of them; with the bed in place, its side clearance covers that.`,
].join(" ");

const item = {
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Wardrobe wall with bed bridge",
  category: "storage",
  tags: ["bedroom", "closet", "built-in", "fitted wardrobe", "bridge", "overbed", "headboard", "shelf", "reading light", "greige"],
  dimensions: { width: r(W), depth: D, height: H },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    fronts: { label: "Fronts, carcass and shelf", default: "lacquer.greige", allowed: ["lacquer.*", "paint.*", "wood.*"] },
    headboard: { label: "Headboard panel", default: "wood.oak-taupe", allowed: ["wood.*", "lacquer.*", "paint.*", "fabric.*", "leather.*"] },
    metal: { label: "Handles and reading spots", default: "metal.powder-clay", allowed: ["metal.powder-clay", "metal.brushed-steel", "metal.stainless", "metal.chrome", "metal.brass", "metal.black-matte"] },
    lenses: { label: "Reading spots, light", default: "glass.opal-lit", allowed: ["glass.opal-lit", "glass.opal"] },
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
console.log(`side columns ${fmt(XW - XA)} wide each (end panel ${END}, door ${fmt(len(doorX))}, filler ${FILLER}); tall doors ${fmt(len(tallY))} high (from ${TOE} cm), top doors ${fmt(len(topY))}; joint at ${J} cm`);
console.log(`handles ${fmt(len(HANDLE))} cm, centred ${fmt(mid(HANDLE))} cm above the floor, ${HANDLE_INSET} cm from the doors' bed-side edges`);
console.log(`bridge ${fmt(C)} wide, ${fmt(BRIDGE_DEPTH)} deep, ${fmt(BRIDGE_Y)}–${fmt(YT)} cm: ${BRIDGE_DOORS} doors of ${fmt(len(bridgeDoorX))}`);
console.log(`niche ${fmt(C)} wide, ${fmt(SHELF[1])}–${fmt(BRIDGE_Y)} cm (${fmt(BRIDGE_Y - SHELF[1])} high), ${fmt(BRIDGE_DEPTH - BACK)} deep under the bridge`);
console.log(`headboard ${fmt(HEAD_DEPTH)} deep, 0–${fmt(SHELF[0])} cm; shelf ${fmt(SHELF[0])}–${fmt(SHELF[1])} cm, ${fmt(HEAD_DEPTH - BACK)} deep in front of the back panel`);
console.log(`reading spots at x ±${fmt(spotX)}, ${fmt(spotY)} cm; lowest point ${fmt(lowest)} cm (bed headboard ${BED_HEADBOARD})`);
