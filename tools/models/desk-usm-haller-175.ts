/**
 * npx tsx tools/models/desk-usm-haller-175.ts — writes catalogue/desk-usm-haller-175.json.
 *
 * The USM Haller table (design Fritz Haller) as a desk, 175 × 75 cm at 74 cm, to go with the USM Haller sideboard:
 * a 1.9 cm top on a chrome frame of USM tubes (Ø 1.9 cm) joined by balls at the corners, with a chrome leg under each
 * ball standing on an adjustable glide (Ø 3.6 cm, 2 cm of travel). The frame runs round all four sides just under the
 * top, set in so that the legs stand inside the top's corners.
 */
import type { Part } from "../../src/core/schema/common";
import { box, r, tail, vec, writeItem, type Extra } from "./parametric";

const ID = "desk-usm-haller-175";
const W = 175;
const D = 75;
const H = 74;
const TOP = 1.9; // the top's thickness
const TUBE = 0.95; // the USM tube's radius
const BALL = 1.3; // the connecting ball's radius
const LEG = 1.25; // the leg's radius
const IN = 2.5; // from the top's edge to the frame's centre line
const GLIDE = { radius: 1.8, height: 1.2 };
const INSERT = 4; // the threaded insert between the glide and the leg, up to this height

const yt = H - TOP; // underside of the top
const yf = yt - TUBE; // the frame's centre line, its tubes touching the top
const [xc, zc] = [W / 2 - IN, D / 2 - IN]; // the corners' centres
const MXZ = { mirror: ["x" as const, "z" as const] };
const cyl = (name: string, radius: number, height: number, at: { x: number; y: number; z: number }, material: string, e: Extra = {}): Part =>
  ({ name, shape: "cylinder", radius: r(radius), height: r(height), ...tail(at, material, e) }) as Part;

// nothing is hidden in the plan (the top covers the frame from above, and catalogue cards show only what the plan shows)
const parts: Part[] = [
  box("top", [-W / 2, W / 2], [yt, H], [-D / 2, D / 2], "top", { cornerRadius: 0.3 }),
  cyl("frame tubes, front and back", TUBE, 2 * xc - 2 * BALL, vec(0, yf, zc), "frame", { rotation: { z: 90 }, mirror: ["z"] }),
  cyl("frame tubes, sides", TUBE, 2 * zc - 2 * BALL, vec(xc, yf, 0), "frame", { rotation: { x: 90 }, mirror: ["x"] }),
  { name: "balls", shape: "sphere", radius: BALL, ...tail(vec(xc, yf, zc), "frame", MXZ) } as Part,
  cyl("legs", LEG, yf - INSERT, vec(xc, (yf + INSERT) / 2, zc), "frame", MXZ),
  cyl("inserts", TUBE, INSERT - GLIDE.height, vec(xc, (INSERT + GLIDE.height) / 2, zc), "frame", MXZ),
  cyl("glides", GLIDE.radius, GLIDE.height, vec(xc, GLIDE.height / 2, zc), "glides", MXZ),
];

const path = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Desk, USM Haller table 175 × 75",
  category: "table",
  tags: ["office", "desk", "usm", "modular", "chrome", "workstation"],
  dimensions: { width: W, depth: D, height: H },
  placement: { type: "floor" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    top: { label: "Top", default: "lacquer.pearl-grey", allowed: ["lacquer.*", "wood.oak-natural"] },
    frame: { label: "Frame and legs", default: "metal.chrome", allowed: ["metal.chrome"] },
    glides: { label: "Glides", default: "plastic.deep-black", allowed: ["plastic.deep-black"] },
  },
  surfaces: [{ name: "top", height: H, width: W, depth: D }],
  productUrl: "https://www.usm.com/en/products/usm-haller/",
  notes: `USM Haller table (design Fritz Haller), ${W} × ${D} cm at ${H} cm, as a desk to go with the USM Haller sideboard. A ${TOP} cm top on a chrome frame of USM tubes (Ø 1.9 cm) with a ball at each corner, and a chrome leg under each ball on an adjustable glide (Ø 3.6 cm, 2 cm of travel). USM makes the top in laminate, linoleum, Fenix and oak veneer: pearl grey stands in for the laminate, the other lacquers for its colour range. Room for a 40" ultrawide monitor with a speaker on each side.`,
});
console.log(`wrote ${path}: ${parts.length} parts; frame under the top at ${r(yf - TUBE)}–${r(yt)} cm`);
