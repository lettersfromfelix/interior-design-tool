/**
 * npx tsx tools/models/throw-folded.ts — writes catalogue/throw-folded.json.
 *
 * A wool throw of 130 × 170 cm with fringed ends, folded in thirds both ways to 43.3 × 56.7 cm: nine layers of
 * about 0.5 cm, 4.5 cm high. Seen from the front (+z) the stack shows its layers on the right side and the rounded
 * fold on the left; one fringed end comes out of the front of the stack and lies on the surface.
 *
 * Made to lie on sofa and armchair seats, beds, the bedspread and the headboard box's ledge (placement onTop): like the
 * cushions, it keeps the angle it is dropped at and moves with what it lies on.
 */
import type { Part } from "../../src/core/schema/common";
import { box, r, tail, vec, writeItem } from "./parametric";

const ID = "throw-folded";
const W = r(130 / 3); // 43.33
const L = r(170 / 3); // 56.67
const LAYER = 1.5; // three slabs of three layers each
const H = 3 * LAYER;
// tassels from 2.2 cm up the front face down to the surface, in two interleaved rows (the second a little shorter)
const FRINGE = { length: 5, short: 4.3, r: 0.35, step: 2.6, from: 2.2 };
const D = r(L + FRINGE.length + 0.3); // the folded stack and the fringe lying on the surface in front of it

const zBack = -D / 2;
const zFront = zBack + L; // front face of the stack
const x0 = -W / 2;
const bend = H / 2; // the radius of the fold on the left

// the slabs: hand-folded, so they are a little off each other and the upper ones a little smaller
const slab = (i: number, dx: number, dz: number, shrink: number): Part =>
  box(
    `layers ${3 * i + 1}–${3 * i + 3}`,
    [x0 + bend + dx, W / 2 - shrink + dx],
    [i * LAYER, (i + 1) * LAYER],
    [zBack + shrink / 2 + dz, zFront - shrink / 2 + dz],
    "throw",
    { cornerRadius: 0.7 },
  );
const count = Math.floor((W - 3) / FRINGE.step) + 1;
const first = x0 + (W - FRINGE.step * (count - 1)) / 2;
// one row of tassels: every other tassel, splayed a little sideways (yaw) so the fringe doesn't look combed
const tassels = (name: string, length: number, yaw: number, x: number, n: number): Part => {
  const tilt = (Math.atan2(FRINGE.from - FRINGE.r, length) * 180) / Math.PI; // from the front face down to the surface
  return {
    name,
    shape: "cylinder",
    radius: FRINGE.r,
    height: r(Math.hypot(FRINGE.from - FRINGE.r, length)),
    // a tassel leans forwards from the stack's front face down to the surface: turned from upright about x, its top
    // end backwards (a positive x turn would lean it towards the front)
    ...tail(vec(x, (FRINGE.from + FRINGE.r) / 2, zFront + length / 2), "throw", {
      rotation: { x: r(tilt - 90), y: yaw },
      repeat: { count: n, step: vec(2 * FRINGE.step) },
    }),
  } as Part;
};
const parts: Part[] = [
  slab(0, 0, 0, 0),
  slab(1, 0.4, -0.3, 0.6),
  slab(2, -0.2, 0.3, 1.2),
  {
    name: "fold",
    shape: "cylinder",
    radius: bend,
    height: r(L - 0.4),
    ...tail(vec(x0 + bend, bend, (zBack + zFront) / 2), "throw", { rotation: { x: 90 } }),
  } as Part,
  tassels("fringe", FRINGE.length, 5, first, Math.ceil(count / 2)),
  tassels("fringe, shorter tassels", FRINGE.short, -5, first + FRINGE.step, Math.floor(count / 2)),
];

const path = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Throw, folded",
  category: "decor",
  tags: ["living room", "bedroom", "throw", "blanket", "wool", "sofa", "bed"],
  dimensions: { width: W, depth: D, height: H },
  placement: { type: "onTop" },
  geometry: { type: "parametric", parts },
  materialSlots: { throw: { label: "Throw", default: "fabric.boucle-cream", allowed: ["fabric.*", "rug.*"] } },
  notes: `Generic wool throw, not a specific product: 130 × 170 cm with fringed ends, folded in thirds both ways to ${W} × ${L} cm and ${H} cm high; the fringe lies in front of it, so the item is ${D} cm deep. Drop it on anything that offers a surface, such as a sofa or armchair seat, a bed, the bedspread (bedspread-quilted-240x260) or the ledge of the headboard box: it keeps the angle it is dropped at, like the cushions, and moves with what it lies on. Cream bouclé by default; any fabric, or one of the rug colorways (rug.*) to match the rug.`,
});
console.log(`wrote ${path}: ${parts.length} parts, ${W} × ${D} × ${H}; ${count} tassels`);
