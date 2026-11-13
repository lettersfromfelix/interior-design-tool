/**
 * npx tsx tools/models/sofa-bed-aslak-140.ts — writes catalogue/sofa-bed-aslak-140-closed.json and
 * catalogue/sofa-bed-aslak-140-open.json: Innovation Living's Aslak 140 click-clack sofa bed, as a sofa and as a bed.
 *
 * Innovation Living's sizes: sofa 200 cm wide, 90 high and 100 deep, seat 60 deep at 48; bed 140 × 200 at 48 with a
 * 19 cm mattress; matt black steel frame, lacquered oak legs. The mattress has two parts of 70 cm: as a sofa, the front
 * one is the seat and the back one leans back at 29°, which gives exactly the published 100 cm depth, 90 cm height and
 * 60 cm seat depth; as a bed, the seat slides forwards and the back lies flat behind it, 140 cm deep from the wall.
 *
 * Both items have the same width and back line, so the open one snaps to the wall where the closed one stood. Built in
 * cm with d = distance from the wall (the back line) and y up.
 */
import type { Part } from "../../src/core/schema/common";
import { box, DEG, r, tail, vec, writeItem } from "./parametric";

const W = 200;
const SOFA = { depth: 100, height: 90, seatH: 48 };
const BED_DEPTH = 140;
const MAT = 19; // the mattress's thickness
const PART = 70; // each of its two parts
const FRAME = { y0: 24, y1: SOFA.seatH - MAT, inset: 3 }; // the steel frame under the mattress
const RECLINE = 29; // the back, from vertical, as a sofa
const LEG = { splay: 18, radius: 1.3, radiusTop: 1.8, x: 88 };
const CUSHION = 5; // corner radius of the mattress parts

const ID = "sofa-bed-aslak-140";
const SLOTS = {
  upholstery: { label: "Upholstery", default: "fabric.linen-grey", allowed: ["fabric.*"] },
  frame: { label: "Frame", default: "metal.black-matte", allowed: ["metal.black-matte"] },
  legs: { label: "Legs", default: "wood.oak-natural", allowed: ["wood.*", "metal.black-matte"] },
};

/** A splayed oak leg from the frame (d, FRAME.y0) to the floor, its foot `out` cm further from the frame's middle. */
function leg(name: string, dTop: number, out: number, z: (d: number) => number): Part {
  const length = FRAME.y0 / Math.cos(LEG.splay * DEG);
  const dFoot = dTop + out * FRAME.y0 * Math.tan(LEG.splay * DEG);
  return {
    name,
    shape: "cylinder",
    radius: LEG.radius,
    radiusTop: LEG.radiusTop,
    height: r(length),
    ...tail(vec(LEG.x, FRAME.y0 / 2 + LEG.radius * Math.sin(LEG.splay * DEG), z((dTop + dFoot) / 2)), "legs", { rotation: { x: -out * LEG.splay }, mirror: ["x"] }),
  } as Part;
}

// ---- closed: a sofa ----
const T_BACK = RECLINE * DEG;
/** The back's centre (d, y): leaning back, its rounded rear reaches the back line (d = 0) and its rounded top the published height. */
const BACK_C = (() => {
  const half = { l: PART / 2 - CUSHION, t: MAT / 2 - CUSHION }; // the box inside the rounding
  return {
    d: half.l * Math.sin(T_BACK) + half.t * Math.cos(T_BACK) + CUSHION,
    y: SOFA.height - (half.l * Math.cos(T_BACK) + half.t * Math.sin(T_BACK) + CUSHION),
  };
})();

function closed(): Part[] {
  const z = (d: number) => d - SOFA.depth / 2;
  const seat: [number, number] = [SOFA.depth - PART, SOFA.depth];
  return [
    box("seat", [-W / 2, W / 2], [FRAME.y1, SOFA.seatH], [z(seat[0]), z(seat[1])], "upholstery", { cornerRadius: CUSHION }),
    {
      name: "back",
      shape: "box",
      size: vec(W, PART, MAT),
      cornerRadius: CUSHION,
      ...tail(vec(0, BACK_C.y, z(BACK_C.d)), "upholstery", { rotation: { x: -RECLINE } }),
    } as Part,
    box("frame", [-W / 2 + FRAME.inset, W / 2 - FRAME.inset], [FRAME.y0, FRAME.y1], [z(seat[0]), z(seat[1] - 2)], "frame"),
    box("mechanism plates", [W / 2 - FRAME.inset - 0.6, W / 2 - FRAME.inset], [FRAME.y0 - 2, FRAME.y1 + 4], [z(seat[0] - 2), z(seat[0] + 22)], "frame", { mirror: ["x"] }),
    leg("legs, back", seat[0] + 12, -1, z),
    leg("legs, front", seat[1] - 18, 1, z),
  ];
}

// ---- open: a bed ----
function open(): Part[] {
  const z = (d: number) => d - BED_DEPTH / 2;
  return [
    box("mattress, head part", [-W / 2, W / 2], [FRAME.y1, SOFA.seatH], [z(0), z(PART)], "upholstery", { cornerRadius: CUSHION }),
    box("mattress, foot part", [-W / 2, W / 2], [FRAME.y1, SOFA.seatH], [z(PART), z(BED_DEPTH)], "upholstery", { cornerRadius: CUSHION }),
    box("frame", [-W / 2 + FRAME.inset, W / 2 - FRAME.inset], [FRAME.y0, FRAME.y1], [z(2), z(BED_DEPTH - 2)], "frame"),
    box("mechanism plates", [W / 2 - FRAME.inset - 0.6, W / 2 - FRAME.inset], [FRAME.y0 - 2, FRAME.y1 + 2], [z(PART - 12), z(PART + 12)], "frame", { mirror: ["x"] }),
    leg("legs, head end", 22, -1, z),
    leg("legs, foot end", BED_DEPTH - 22, 1, z),
  ];
}

const extra = BED_DEPTH - SOFA.depth;
const pathClosed = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: `${ID}-closed`,
  name: "Sofa bed, Innovation Aslak 140 (closed)",
  category: "seating",
  tags: ["sofa bed", "guest bed", "convertible", "click-clack", "office", "guest room", "innovation living", "closed"],
  dimensions: { width: W, depth: SOFA.depth, height: SOFA.height },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts: closed() },
  materialSlots: SLOTS,
  surfaces: [{ name: "seat", height: SOFA.seatH, width: W - 4, depth: 56, center: [0, 20] }],
  clearance: { front: 45, note: "Legroom in front of the seat; a coffee table can stand 45 cm away" },
  productUrl: "https://www.innovationliving.com/products/by-type/sofa-beds/product-details/aslak-140-sofa-bed-nordic-cover-spring-565",
  notes: `Innovation Living Aslak 140 (design Per Weiss, Oliver & Lukas WeissKrogh), a click-clack sofa bed, closed as a sofa: ${W} cm wide, ${SOFA.depth} deep and 90 high, seat 60 cm deep at ${SOFA.seatH} cm. Its open counterpart is ${ID}-open: a 140 × 200 cm bed at 48 cm, ${BED_DEPTH} cm deep from the wall, so it needs ${extra} cm more room in front when open. Both have the same width and back line, so the open one snaps to the same wall position. The 19 cm spring mattress in two parts makes the seat and the back; matt black steel frame, lacquered oak legs. The back also has a second, more reclined position (84 cm high, 112 deep).`,
});
const pathOpen = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: `${ID}-open`,
  name: "Sofa bed, Innovation Aslak 140 (open)",
  category: "bed",
  tags: ["sofa bed", "guest bed", "convertible", "click-clack", "guest room", "innovation living", "open", "double bed"],
  dimensions: { width: W, depth: BED_DEPTH, height: SOFA.seatH },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts: open() },
  materialSlots: SLOTS,
  surfaces: [{ name: "bed", height: SOFA.seatH, width: W - 4, depth: BED_DEPTH - 4 }],
  clearance: { front: 60, note: "Room to get in and make the bed" },
  productUrl: "https://www.innovationliving.com/products/by-type/sofa-beds/product-details/aslak-140-sofa-bed-nordic-cover-spring-565",
  notes: `Innovation Living Aslak 140, a click-clack sofa bed, open as a bed: 140 × 200 cm at ${SOFA.seatH} cm (19 cm spring mattress), ${BED_DEPTH} cm deep from the wall. Its closed counterpart is ${ID}-closed, a sofa ${SOFA.depth} cm deep: open, it reaches ${extra} cm further into the room. Both have the same width and back line, so this one snaps to the same wall position. The head end can be raised in four steps (not shown).`,
});
// the seat's visible depth: from the front to where the back's front face meets the top of the seat
const face = { d: BACK_C.d + (MAT / 2) * Math.cos(T_BACK), y: BACK_C.y + (MAT / 2) * Math.sin(T_BACK) };
const seatDepth = SOFA.depth - (face.d + ((face.y - SOFA.seatH) / Math.cos(T_BACK)) * Math.sin(T_BACK));
console.log(`wrote ${pathClosed} and ${pathOpen}; visible seat depth ${r(seatDepth)} cm (published 60)`);
