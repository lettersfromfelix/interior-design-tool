/**
 * npx tsx tools/models/sofa-bed-vimle-2.ts — writes catalogue/sofa-bed-vimle-2-closed.json and
 * catalogue/sofa-bed-vimle-2-open.json: IKEA's VIMLE 2-seat sofa-bed, as a sofa and pulled out as a bed.
 *
 * IKEA's sizes: 190 cm wide, 98 deep and 83 high, backrest frame 68, seat 55 deep at 48; bed 140 × 200 with a 12 cm
 * foam mattress, sleeping surface at 53, 241 cm deep from the wall when pulled out. To open it, the seat cushions come
 * off, the bed frame is pulled forwards out of the seat box and unfolds on two U-shaped legs; the arms, the backrest
 * and the back cushions stay where they are, so the mattress runs from the back cushions to 241 cm.
 *
 * Both items have the same width and back line, so the open one snaps to the wall where the closed one stood. Built in
 * cm with d = distance from the wall (the back line) and y up.
 */
import type { Part } from "../../src/core/schema/common";
import { box, DEG, r, tail, vec, writeItem } from "./parametric";

const W = 190;
const D = 98;
const H = 83;
const OPEN_DEPTH = 241;
const ARM = { w: 15, h: 65 };
const BACK = { d: 14, h: 68 }; // the backrest frame
const BASE = { y: [6, 34] as [number, number], front: 97 };
const SEAT = { h: 48, cushion: 14 };
const CUSHION = { recline: 12, length: 36, thick: 22, bottom: 44.3, w: 79 }; // the back cushions, their tops at 83
const MATTRESS = { w: 140, l: 200, t: 12, top: 53 };
const FOOT = { r: 1.6, h: 2.5 };
const TUBE = 1.1; // the bed frame's legs

const ID = "sofa-bed-vimle-2";
const inner = W / 2 - ARM.w;

/** Everything that stays when the bed is pulled out: arms, backrest, seat box, back cushions and feet. */
function frame(z: (d: number) => number): Part[] {
  const t = CUSHION.recline * DEG;
  // the back cushions lean on the backrest's top front edge; from their bottom rear corner to their centre
  const dRear = BACK.d + (BACK.h - CUSHION.bottom) * Math.tan(t);
  const c = {
    d: dRear - (CUSHION.length / 2) * Math.sin(t) + (CUSHION.thick / 2) * Math.cos(t),
    y: CUSHION.bottom + (CUSHION.length / 2) * Math.cos(t) + (CUSHION.thick / 2) * Math.sin(t),
  };
  return [
    box("arms", [inner, W / 2], [FOOT.h, ARM.h], [z(0), z(D)], "upholstery", { cornerRadius: 3, mirror: ["x"] }),
    box("backrest", [-inner, inner], [FOOT.h, BACK.h], [z(0), z(BACK.d)], "upholstery", { cornerRadius: 2 }),
    box("seat box", [-inner, inner], BASE.y, [z(BACK.d), z(BASE.front)], "upholstery", { cornerRadius: 2 }),
    {
      name: "back cushions",
      shape: "box",
      size: vec(CUSHION.w, CUSHION.length, CUSHION.thick),
      cornerRadius: 6,
      ...tail(vec(inner / 2, c.y, z(c.d)), "upholstery", { rotation: { x: -CUSHION.recline }, mirror: ["x"] }),
    } as Part,
    {
      name: "feet",
      shape: "cylinder",
      radius: FOOT.r,
      height: FOOT.h,
      ...tail(vec(W / 2 - ARM.w / 2, FOOT.h / 2, z(6)), "feet", { repeat: { count: 2, step: { x: 0, y: 0, z: D - 12 } }, mirror: ["x"], plan: "hidden" }),
    } as Part,
  ];
}

function closed(): Part[] {
  const z = (d: number) => d - D / 2;
  return [
    ...frame(z),
    box("seat cushions", [0.4, inner], [BASE.y[1], SEAT.h], [z(BACK.d), z(BASE.front + 0.5)], "upholstery", { cornerRadius: 5, mirror: ["x"] }),
  ];
}

function open(): Part[] {
  const z = (d: number) => d - OPEN_DEPTH / 2;
  const head = OPEN_DEPTH - MATTRESS.l;
  const y0 = MATTRESS.top - MATTRESS.t; // the frame's top, under the mattress
  const rail = (MATTRESS.w + 3) / 2;
  const uLeg = (name: string, d: number): Part[] => [
    { name: `${name}, uprights`, shape: "cylinder", radius: TUBE, height: r(y0 - 3 - TUBE), ...tail(vec(rail - 6, (y0 - 3 + TUBE) / 2, z(d)), "frame", { mirror: ["x"] }) } as Part,
    { name: `${name}, floor bar`, shape: "cylinder", radius: TUBE, height: r(2 * (rail - 6)), ...tail(vec(0, TUBE, z(d)), "frame", { rotation: { z: 90 }, plan: "hidden" }) } as Part,
  ];
  return [
    ...frame(z),
    box("mattress", [-MATTRESS.w / 2, MATTRESS.w / 2], [y0, MATTRESS.top], [z(head), z(OPEN_DEPTH)], "mattress", { cornerRadius: 3 }),
    // the bed frame round the mattress's underside, from the seat box to the foot
    box("bed frame, side rails", [rail - 1.5, rail], [y0 - 3, y0], [z(head), z(OPEN_DEPTH - 0.5)], "frame", { mirror: ["x"] }),
    box("bed frame, foot rail", [-rail, rail], [y0 - 3, y0], [z(OPEN_DEPTH - 2), z(OPEN_DEPTH - 0.5)], "frame"),
    box("bed frame, hinge rail", [-rail, rail], [y0 - 3, y0], [z(BASE.front + 40), z(BASE.front + 42)], "frame"),
    ...uLeg("legs, middle", BASE.front + 41),
    ...uLeg("legs, foot", OPEN_DEPTH - 12),
  ];
}

const extra = OPEN_DEPTH - D;
const SLOTS_CLOSED = {
  upholstery: { label: "Upholstery", default: "fabric.wool-beige", allowed: ["fabric.*"] },
  feet: { label: "Feet", default: "plastic.deep-black", allowed: ["plastic.deep-black"] },
};
const URL = "https://www.ikea.com/ch/en/p/vimle-2-seat-sofa-bed-gunnared-beige-s89545229/";
const pathClosed = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: `${ID}-closed`,
  name: "Sofa bed, IKEA VIMLE 2 seats (closed)",
  category: "seating",
  tags: ["sofa bed", "guest bed", "convertible", "pull-out", "office", "guest room", "ikea", "closed"],
  dimensions: { width: W, depth: D, height: H },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts: closed() },
  materialSlots: SLOTS_CLOSED,
  surfaces: [{ name: "seat", height: SEAT.h, width: 2 * inner - 4, depth: 54, center: [0, 20] }],
  clearance: { front: 45, note: "Legroom in front of the seat; a coffee table can stand 45 cm away" },
  productUrl: URL,
  notes: `IKEA VIMLE 2-seat sofa-bed, closed as a sofa: ${W} cm wide, ${D} deep and ${H} high (backrest frame ${BACK.h}), seat 55 cm deep at ${SEAT.h} cm. Its open counterpart is ${ID}-open: a 140 × 200 cm bed at ${MATTRESS.top} cm, ${OPEN_DEPTH} cm deep from the wall, so it needs ${extra} cm more room in front when open. Both have the same width and back line, so the open one snaps to the same wall position. To open it, the seat cushions come off and the bed frame is pulled out of the seat box.`,
});
const pathOpen = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: `${ID}-open`,
  name: "Sofa bed, IKEA VIMLE 2 seats (open)",
  category: "bed",
  tags: ["sofa bed", "guest bed", "convertible", "pull-out", "guest room", "ikea", "open", "double bed"],
  dimensions: { width: W, depth: OPEN_DEPTH, height: H },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts: open() },
  materialSlots: {
    ...SLOTS_CLOSED,
    mattress: { label: "Mattress", default: "fabric.cotton-white", allowed: ["fabric.*"] },
    frame: { label: "Bed frame", default: "metal.black-matte", allowed: ["metal.black-matte"] },
  },
  surfaces: [{ name: "bed", height: MATTRESS.top, width: MATTRESS.w - 4, depth: MATTRESS.l - 4, center: [0, r(OPEN_DEPTH / 2 - MATTRESS.l / 2)] }],
  clearance: { front: 30, left: 35, right: 35, note: "Room to get in and make the bed: about 60 cm beside the mattress" },
  productUrl: URL,
  notes: `IKEA VIMLE 2-seat sofa-bed, pulled out as a bed: a ${MATTRESS.w} × ${MATTRESS.l} cm foam mattress (${MATTRESS.t} cm) at ${MATTRESS.top} cm on a black steel frame with two U-shaped legs, ${OPEN_DEPTH} cm deep from the wall; the seat cushions are off (not shown), the arms, the backrest and the back cushions stay. Its closed counterpart is ${ID}-closed, a sofa ${D} cm deep: open, it reaches ${extra} cm further into the room. Both have the same width and back line, so this one snaps to the same wall position.`,
});
console.log(`wrote ${pathClosed} and ${pathOpen}`);
