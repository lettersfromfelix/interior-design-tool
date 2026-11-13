/**
 * npx tsx tools/models/desk-sit-stand-180.ts — writes catalogue/desk-sit-stand-180.json.
 *
 * An electric sit-stand desk for a 40" ultrawide monitor and a pair of speakers: a 180 × 80 cm top on a slim
 * dual-motor T-frame, with a cable tray under the back edge and a control panel under the front right. A generic
 * example with typical sizes, not a specific product: such frames move the top between about 62 and 127 cm; the item
 * shows it at a sitting height of 74 cm.
 *
 * Frame, as seen from the front (x = 0 in the middle, z = 0 halfway through the depth): two telescopic columns 130 cm
 * apart (the frame's usual width for a 180 cm top), each on a 70 cm foot, carrying side brackets under the top and a
 * crossbar between them; the columns stand in the middle of the depth, so there is legroom in front of the crossbar.
 */
import type { Part } from "../../src/core/schema/common";
import { box, writeItem } from "./parametric";

const ID = "desk-sit-stand-180";
const W = 180;
const D = 80;
const H = 74; // top of the desk at sitting height
const TOP = 2.5; // thickness of the top
const XC = 65; // the columns' centres
const FOOT: [number, number, number] = [7, 3, 70]; // x × y × z
const LOWER: [number, number] = [7, 5.5]; // lower column section, x × z
const UPPER: [number, number] = [6.2, 4.7]; // upper column section
const SPLIT = 38; // where the upper section comes out of the lower one
const BRACKET: [number, number, number] = [4, 3, 64]; // under the top, front to back
const BEAM: [number, number] = [3, 5]; // crossbar, y × z

const yt = H - TOP; // underside of the top
const yb = yt - BRACKET[1]; // underside of the brackets and the crossbar
const MX = { mirror: ["x" as const] };
const parts: Part[] = [
  box("top", [-W / 2, W / 2], [yt, H], [-D / 2, D / 2], "top", { cornerRadius: 0.5 }),
  box("feet", [XC - FOOT[0] / 2, XC + FOOT[0] / 2], [0.8, 0.8 + FOOT[1]], [-FOOT[2] / 2, FOOT[2] / 2], "frame", { cornerRadius: 1.4, ...MX }),
  {
    name: "glides",
    shape: "cylinder",
    radius: 1.6,
    height: 0.8,
    position: { x: XC, y: 0.4, z: -FOOT[2] / 2 + 3 },
    repeat: { count: 2, step: { x: 0, y: 0, z: FOOT[2] - 6 } },
    mirror: ["x"],
    plan: "hidden",
    material: "frame",
  },
  box("columns, lower sections", [XC - LOWER[0] / 2, XC + LOWER[0] / 2], [0.8 + FOOT[1], SPLIT], [-LOWER[1] / 2, LOWER[1] / 2], "frame", { cornerRadius: 0.6, ...MX }),
  box("columns, upper sections", [XC - UPPER[0] / 2, XC + UPPER[0] / 2], [SPLIT, yb], [-UPPER[1] / 2, UPPER[1] / 2], "frame", { cornerRadius: 0.5, ...MX }),
  box("motor housings", [XC - 4.5, XC + 4.5], [yb - 6, yb], [-4, 4], "frame", { cornerRadius: 0.8, ...MX }),
  box("side brackets", [XC - BRACKET[0] / 2, XC + BRACKET[0] / 2], [yb, yt], [-BRACKET[2] / 2, BRACKET[2] / 2], "frame", { cornerRadius: 0.4, ...MX }),
  box("crossbar", [-(XC - BRACKET[0] / 2), XC - BRACKET[0] / 2], [yb, yt], [-BEAM[1] / 2, BEAM[1] / 2], "frame", { cornerRadius: 0.4 }),
  // an open steel tray under the back edge for the cables
  box("cable tray, bottom", [-55, 55], [yb - 9, yb - 8.7], [-35.5, -24.5], "frame"),
  box("cable tray, sides", [-55, 55], [yb - 9, yb], [-35.5, -35.2], "frame", { repeat: { count: 2, step: { x: 0, y: 0, z: 10.7 } } }),
  box("control panel", [54, 66], [yt - 2.2, yt], [D / 2 - 6, D / 2 - 1.5], "frame", { cornerRadius: 0.6, plan: "hidden" }),
];

const path = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Desk, electric sit-stand 180 × 80",
  category: "table",
  tags: ["office", "desk", "height-adjustable", "standing desk", "workstation"],
  dimensions: { width: W, depth: D, height: H },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    top: { label: "Top", default: "wood.oak-natural", allowed: ["wood.*", "lacquer.*"] },
    frame: { label: "Frame", default: "metal.black-matte", allowed: ["metal.*", "lacquer.white", "lacquer.anthracite", "lacquer.black"] },
  },
  surfaces: [{ name: "top", height: H, width: W, depth: D }],
  notes: `Generic example with typical sizes, not a specific product. An electric sit-stand desk with a ${W} × ${D} cm top on a slim dual-motor T-frame (columns ${2 * XC} cm apart on ${FOOT[2]} cm feet), a cable tray under the back edge and a control panel under the front right. Such frames move the top between about 62 and 127 cm; the item shows it at a sitting height of ${H} cm. Room for a 40" ultrawide monitor with a speaker on each side.`,
});
console.log(`wrote ${path}: ${parts.length} parts`);
