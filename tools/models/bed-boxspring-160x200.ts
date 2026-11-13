/**
 * npx tsx tools/models/bed-boxspring-160x200.ts — writes catalogue/bed-boxspring-160x200.json.
 *
 * A boxspring bed without a headboard, for a 160 × 200 cm mattress and exactly that size, so that it stands against the
 * headboard box in the wardrobe's bed alcove (headboard-box-alcove-177) or against a wall: an upholstered box spring on
 * low feet, a pocket-spring mattress and a topper.
 *
 * Heights: boxspring beds are usually 50–70 cm high to the top of the topper (XXXLutz BOXXX 160 × 200: 73 cm on a
 * 43 cm box, as a "comfort height"). This one is in the middle: feet 7 cm, box spring 28 cm, mattress 21 cm, topper
 * 6 cm, 62 cm in all.
 */
import type { Part } from "../../src/core/schema/common";
import { box, tail, vec, writeItem } from "./parametric";

const ID = "bed-boxspring-160x200";
const W = 160;
const L = 200;
// tops of the feet, the box spring, the mattress and the topper
const FEET = 7;
const SPRING = 35;
const MATTRESS = 56;
const TOP = 62;
const FOOT = { r: 2.5, x: W / 2 - 10, z: L / 2 - 12 }; // six feet: the corners and the middle of each long side

const x: [number, number] = [-W / 2, W / 2];
const z: [number, number] = [-L / 2, L / 2];
const parts: Part[] = [
  {
    name: "feet",
    shape: "cylinder",
    radius: FOOT.r,
    height: FEET,
    ...tail(vec(FOOT.x, FEET / 2, -FOOT.z), "feet", { repeat: { count: 3, step: vec(0, 0, FOOT.z) }, mirror: ["x"] }),
  } as Part,
  box("box spring", x, [FEET, SPRING], z, "base", { cornerRadius: 1.5 }),
  box("mattress", x, [SPRING, MATTRESS], z, "bedding", { cornerRadius: 4 }),
  box("topper", x, [MATTRESS, TOP], z, "bedding", { cornerRadius: 3 }),
];

const path = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Bed, boxspring 160 × 200, without headboard",
  category: "bed",
  tags: ["bedroom", "double bed", "boxspring", "no headboard", "alcove"],
  dimensions: { width: W, depth: L, height: TOP },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    base: { label: "Box spring", default: "fabric.linen-grey", allowed: ["fabric.*", "leather.*"] },
    feet: { label: "Feet", default: "metal.black-matte", allowed: ["metal.*", "wood.*", "plastic.deep-black"] },
    bedding: { label: "Mattress and topper", default: "fabric.cotton-white", allowed: ["fabric.*"] },
  },
  surfaces: [{ name: "bed", height: TOP, width: W - 4, depth: L - 4 }],
  clearance: { left: 60, right: 60, note: "Room to get in and make the bed" },
  notes: `Generic boxspring bed, not a specific product, without a headboard: exactly ${W} × ${L} cm, so it can stand against the headboard box in the wardrobe's bed alcove (headboard-box-alcove-177), against the alcove's back panel or against a wall. An upholstered box spring on six low feet, a pocket-spring mattress and a topper: feet ${FEET} cm, box spring ${SPRING - FEET} cm, mattress ${MATTRESS - SPRING} cm, topper ${TOP - MATTRESS} cm, ${TOP} cm in all, in the middle of the usual 50–70 cm (XXXLutz BOXXX 160 × 200: 73 cm as a "comfort height"). The mattress is a surface for cushions and pillows. In the alcove (177 cm wide), it has ${(177 - W) / 2} cm to spare on each side, and its side clearance reaches the cheeks.`,
});
console.log(`wrote ${path}: ${parts.length} parts, ${W} × ${L} × ${TOP}`);
