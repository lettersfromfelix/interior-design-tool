/**
 * npx tsx tools/models/table-lamp-flowerpot-vp9.ts — writes catalogue/table-lamp-flowerpot-vp9.json.
 *
 * &Tradition Flowerpot VP9 (design Verner Panton, 1968), the portable, rechargeable Flowerpot: Ø 16 cm, H 29.5 cm,
 * 0.8 kg (&Tradition's VP9 spec sheet). It is not the VP3 (table-lamp-flowerpot-vp3, Ø 23 × 50 cm) scaled down: the
 * profile below is measured on the spec sheet's product photo, row by row, scaled to the 16 cm shade (the photo's
 * width and height scales agree within 1 %):
 * - the base: a dome of radius 4.84 cm on a 1.2 cm skirt, 6 cm high;
 * - the stem: Ø 0.96 cm;
 * - the bowl under the shade: a half sphere of radius 4 cm, its bottom 17.5 cm above the table;
 * - the shade: 16 cm across and a little flatter than a half sphere (7.7 cm high), its rim 20.6 cm above the table;
 * - a chrome ring and top ball, up to 29.5 cm.
 * Lathe profiles are [radius, height] pairs, as in the VP3.
 */
import type { Part } from "../../src/core/schema/common";
import { arcPoints, r, tail, vec, writeItem, type P2 } from "./parametric";

const ID = "table-lamp-flowerpot-vp9";
const H = 29.5;
const SHADE = { r: 8, ry: 7.7, rim: 20.6, spring: 20.9, t: 0.3 }; // the dome springs from 20.9, above a 0.3 cm lip
const BOWL = { r: 4, rim: 21.5, t: 0.3 };
const BASE = { r: 4.84, skirt: 1.2 };
const STEM = { r: 0.48, from: 5.6, to: 17.7 };
const TOP = { ring: 0.8, ringH: 0.25, ball: 0.42 };

const pts = (list: P2[]) => list.map(([x, y]) => [r(x), r(y)] as P2);
/** Points on a quarter ellipse around (0, cy), radii rx and ry, from angle a0 to a1 (degrees). */
const ellipse = (cy: number, rx: number, ry: number, a0: number, a1: number, step = 7.5): P2[] =>
  arcPoints(0, 0, 1, a0, a1, step).map(([c, s]) => [rx * c, cy + ry * s]);

const shadeTop = SHADE.spring + SHADE.ry;
const parts: Part[] = [
  {
    name: "base",
    shape: "lathe",
    profile: pts([[0, 0], [4.55, 0], [BASE.r, 0.3], ...arcPoints(0, BASE.skirt, BASE.r, 0, 90, 11.25)]),
    ...tail(vec(), "lacquer"),
  } as Part,
  { name: "stem", shape: "cylinder", radius: STEM.r, height: r(STEM.to - STEM.from), ...tail(vec(0, (STEM.from + STEM.to) / 2), "lacquer") } as Part,
  {
    name: "bowl",
    shape: "lathe",
    profile: pts([
      ...arcPoints(0, BOWL.rim, BOWL.r, -90, 0, 11.25),
      ...arcPoints(0, BOWL.rim, BOWL.r - BOWL.t, 0, -90, 11.25),
      [0, BOWL.rim - BOWL.r],
    ]),
    ...tail(vec(), "lacquer"),
  } as Part,
  {
    name: "shade",
    shape: "lathe",
    profile: pts([
      [SHADE.r, SHADE.rim],
      ...ellipse(SHADE.spring, SHADE.r, SHADE.ry, 0, 90),
      ...ellipse(SHADE.spring, SHADE.r - SHADE.t, SHADE.ry - SHADE.t, 90, 0),
      [SHADE.r - SHADE.t, SHADE.rim],
      [SHADE.r, SHADE.rim],
    ]),
    ...tail(vec(), "lacquer"),
  } as Part,
  { name: "ring", shape: "cylinder", radius: TOP.ring, height: TOP.ringH, ...tail(vec(0, shadeTop - 0.05 + TOP.ringH / 2), "top", { plan: "hidden" }) } as Part,
  { name: "top ball", shape: "sphere", radius: TOP.ball, ...tail(vec(0, H - TOP.ball), "top") } as Part,
  { name: "light", shape: "sphere", radius: 1.8, ...tail(vec(0, BOWL.rim + 0.1), "light", { plan: "hidden" }) } as Part,
];

const path = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Table lamp, Flowerpot VP9 (portable)",
  category: "lighting",
  tags: ["living room", "bedside", "portable", "rechargeable", "verner panton", "andtradition"],
  dimensions: { width: 2 * SHADE.r, depth: 2 * SHADE.r, height: H },
  placement: { type: "onTop" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    lacquer: { label: "Colour", default: "lacquer.burgundy", allowed: ["lacquer.*", "metal.brass", "metal.chrome"] },
    top: { label: "Top ball", default: "metal.chrome", allowed: ["metal.chrome", "metal.brass"] },
    light: { label: "Light", default: "glass.opal-lit", allowed: ["glass.opal-lit", "glass.opal"] },
  },
  productUrl: "https://www.andtradition.com/products/flowerpot-portable-lamp-vp9",
  notes:
    "&Tradition Flowerpot VP9 (design Verner Panton, 1968), the portable, rechargeable Flowerpot: Ø 16 cm, H 29.5 cm, 0.8 kg, lacquered polycarbonate and steel, a dimmable 3 W LED, about 10 hours on a charge (&Tradition's VP9 spec sheet). Modelled on the spec sheet's photo: a domed base, a thin stem, a bowl under a shade 16 cm across, and a chrome top ball. Burgundy by default (lacquer.burgundy), a colour &Tradition doesn't offer: its nearest are Dark Plum and Vermilion Red. Its colours: brass, chrome, cobalt blue, dark plum, grey beige, ivory, matt black, matt light grey, matt white, mustard, signal green, steel blue, stone blue, swim blue, tangy pink, vermilion red and zesty orange; pick the nearest lacquer or metal.brass / metal.chrome. Stands on tables, sideboards, shelves and ledges; the larger VP3 is table-lamp-flowerpot-vp3 (Ø 23 × 50 cm).",
});
console.log(`wrote ${path}: ${parts.length} parts, Ø ${2 * SHADE.r} × ${H}; shade top ${r(shadeTop)}`);
