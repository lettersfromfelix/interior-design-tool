/**
 * npx tsx tools/models/bed-boxspring-150x200-headboard.ts — writes catalogue/bed-boxspring-150x200-headboard.json.
 *
 * A boxspring bed for a 150 × 200 cm mattress with an upholstered headboard, exactly 150 cm wide overall: base,
 * mattress and headboard. The bed itself is built as bed-boxspring-160x200: six low feet, an upholstered box spring,
 * a pocket-spring mattress and a topper, 62 cm to the top (feet 7, box spring 28, mattress 21, topper 6).
 *
 * The headboard stands on the floor at the head end: 116 cm high, as XXXLutz BOXXX's (IKEA DUNVIK: 120 cm), and 10 cm
 * deep, a 4 cm back panel with six padded vertical channels of 25 cm in front of it, like the channel-tufted tub
 * chair. The item is 212 cm long: 200 + the headboard's 10 + 2 cm left free behind it, so wall snap puts the headboard
 * flush against the 2 cm back panel of the wardrobe walls' bed alcove (against a plain wall it stands 2 cm off, as over
 * a skirting board).
 *
 * In the alcove (177 cm wide) it leaves 13.5 cm on each side. The headboard stays below the sconces of
 * wardrobe-wall-bed-alcove-r5 and -low (135–150 cm); in the original version the sconces' shades (103–118 cm) hang
 * 10–20 cm in front of the headboard's outer channels, beside them without touching.
 */
import type { Part } from "../../src/core/schema/common";
import { box, r, tail, vec, writeItem } from "./parametric";

const ID = "bed-boxspring-150x200-headboard";
const W = 150;
const L = 200;
// tops of the feet, the box spring, the mattress and the topper (as bed-boxspring-160x200)
const FEET = 7;
const SPRING = 35;
const MATTRESS = 56;
const TOP = 62;
// the headboard
const HB = { height: 116, back: 4, depth: 6, count: 6 };
const FREE = 2; // left free behind the headboard, for the alcove's back panel
const D = FREE + HB.back + HB.depth + L; // the item's depth

const zBack = -D / 2 + FREE; // back of the headboard
const zFront = zBack + HB.back + HB.depth; // front of the headboard = head end of the bed
const zc = zFront + L / 2; // middle of the mattress
const FOOT = { r: 2.5, x: W / 2 - 10, z: L / 2 - 12 }; // six feet: the corners and the middle of each long side
const x: [number, number] = [-W / 2, W / 2];
const z: [number, number] = [zFront, zFront + L];
const module = W / HB.count;

const parts: Part[] = [
  {
    name: "feet",
    shape: "cylinder",
    radius: FOOT.r,
    height: FEET,
    ...tail(vec(FOOT.x, FEET / 2, zc - FOOT.z), "feet", { repeat: { count: 3, step: vec(0, 0, FOOT.z) }, mirror: ["x"] }),
  } as Part,
  box("box spring", x, [FEET, SPRING], z, "base", { cornerRadius: 1.5 }),
  box("mattress", x, [SPRING, MATTRESS], z, "bedding", { cornerRadius: 4 }),
  box("topper", x, [MATTRESS, TOP], z, "bedding", { cornerRadius: 3 }),
  box("headboard, back panel", x, [0, HB.height], [zBack, zBack + HB.back], "headboard", { cornerRadius: 1.5 }),
  box("headboard, channels", [-W / 2 + 0.2, -W / 2 + module - 0.2], [0.5, HB.height - 0.5], [zBack + HB.back, zFront], "headboard", {
    cornerRadius: HB.depth / 2 - 0.1,
    repeat: { count: HB.count, step: vec(module) },
  }),
];

const path = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Bed, boxspring 150 × 200, with headboard",
  category: "bed",
  tags: ["bedroom", "double bed", "boxspring", "headboard", "channel tufted", "alcove"],
  dimensions: { width: W, depth: D, height: HB.height },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    base: { label: "Box spring", default: "fabric.linen-grey", allowed: ["fabric.*", "leather.*"] },
    headboard: { label: "Headboard", default: "fabric.linen-grey", allowed: ["fabric.*", "leather.*"] },
    feet: { label: "Feet", default: "metal.black-matte", allowed: ["metal.*", "wood.*", "plastic.deep-black"] },
    bedding: { label: "Mattress and topper", default: "fabric.cotton-white", allowed: ["fabric.*"] },
  },
  surfaces: [{ name: "bed", height: TOP, width: W - 4, depth: L - 4, center: [0, r(zc)] }],
  clearance: { left: 60, right: 60, note: "Room to get in and make the bed" },
  notes: `Generic boxspring bed, not a specific product: for a 150 × 200 cm mattress, exactly ${W} cm wide overall, with an upholstered headboard. Built as bed-boxspring-160x200: six low feet, a box spring, a pocket-spring mattress and a topper, ${TOP} cm to the top (feet ${FEET}, box spring ${SPRING - FEET}, mattress ${MATTRESS - SPRING}, topper ${TOP - MATTRESS} cm). The headboard is ${HB.height} cm high (XXXLutz BOXXX: 116 cm, IKEA DUNVIK: 120 cm) and ${HB.back + HB.depth} cm deep, with ${HB.count} padded vertical channels; it has its own material slot. The item is ${D} cm long: ${L} + the headboard's ${HB.back + HB.depth} + ${FREE} cm left free behind it, so wall snap puts the headboard flush against the back panel of the wardrobe walls' bed alcove (against a plain wall it stands ${FREE} cm off). In the alcove (177 cm wide) it leaves ${(177 - W) / 2} cm on each side, and the headboard stays below the sconces of wardrobe-wall-bed-alcove-r5 and -low (135–150 cm); in the original version the sconce shades (103–118 cm) hang beside its outer channels, 10–20 cm in front of it. The mattress is a surface for the bedding (duvet-200x210, pillow-65x65, bedspread-quilted-240x260, made for 160 cm beds: on this one the duvet is 7.5 cm wider than the mattress on each side).`,
});
console.log(`wrote ${path}: ${parts.length} parts, ${W} × ${D} × ${HB.height}; headboard z ${r(zBack)}…${r(zFront)}, mattress centre z ${r(zc)}`);
