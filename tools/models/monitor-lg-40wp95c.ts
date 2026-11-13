/**
 * npx tsx tools/models/monitor-lg-40wp95c.ts — writes catalogue/monitor-lg-40wp95c.json.
 *
 * The LG 40WP95C-W, a 40" UltraWide 5K2K monitor curved at 2500R, in white with a silver stand, after LG's
 * specifications: 94.72 × 41.92 × 11.48 cm without the stand, 94.72 cm wide, 50.47–61.47 cm high and 28.3 cm deep with
 * it; screen area 92.93 × 39.20 cm. The item shows the stand at its lowest position.
 *
 * The panel's layers (screen, black bezel, white back, the stepped bulge of the housing) are extrusions of curved
 * footprints, each an annular sector around the curve's axis 250 cm in front of the screen; so the panel is curved in
 * 3D and in the plan. Behind it a hinge plate holds the panel on a flat column, which stands at the back of a crescent
 * base whose tips reach forwards. The base's curve is solved so that the whole item is 28.3 cm deep.
 */
import type { Part } from "../../src/core/schema/common";
import { partsBounds } from "../../src/core/catalogue/bounds";
import { box, DEG, fitToBox, r, writeItem, type P2 } from "./parametric";

const ID = "monitor-lg-40wp95c";
const R = 250; // the screen's radius (2500R)
const PANEL = { w: 94.72, h: 41.92, bezel: 0.5, back: 0.7 }; // overall; the black front layer and the white back layer
const SCREEN = { w: 92.93, h: 39.2, bottom: 1.72 }; // the screen area and its bottom edge above the panel's
const LOW = 50.47 - PANEL.h; // the panel's bottom edge above the desk with the stand at its lowest
const DEPTH = 28.3; // with the stand
// the housing's bulge behind the panel, in steps: half-width, from–to above the panel's bottom edge, depth
const BULGE: [number, number, number, number][] = [
  [34, 3, 39, 1.2],
  [30.5, 4.5, 37.5, 2.4],
  [27, 6, 36, 3.6],
  [23.5, 7.5, 34.5, 4.8],
  [20, 9, 33, 5.8],
];
const COLUMN = { w: 4.4, d: 3, top: LOW + 27 };
const HINGE = { w: 10, d: 1.5, y: [LOW + 14, LOW + 26] as const };
const BASE = { t: 1.4, halfWidth: 29, mid: 5.6, tip: 4 }; // thickness; outer half-width; band widths

const Rb = R + PANEL.bezel + PANEL.back; // the panel's back
const half = Math.asin(PANEL.w / 2 / Rb); // the panel's half-angle, so that its back corners span the overall width
// z of the column's centre is 0 (moved later); the hinge plate sits in front of it and the deepest bulge in front of that
const zAxis = COLUMN.d / 2 + HINGE.d + Rb + BULGE[BULGE.length - 1][3];

/** The footprint between radii r0 and r1 over ±a (radians) around the axis, as [x, z] points. */
function sector(r0: number, r1: number, a: number, n = 40): P2[] {
  const at = (rad: number, t: number): P2 => [r(rad * Math.sin(t)), r(zAxis - rad * Math.cos(t))];
  const angles = Array.from({ length: n + 1 }, (_, i) => -a + (2 * a * i) / n);
  return [...angles.map((t) => at(r0, t)), ...angles.reverse().map((t) => at(r1, t))];
}
const extrusion = (name: string, points: P2[], y0: number, height: number, material: string, plan?: "hidden"): Part =>
  ({ name, shape: "extrusion", points, height: r(height), position: { x: 0, y: r(y0), z: 0 }, ...(plan && { plan }), material }) as Part;

/** The crescent base: a band along a circular arc from its middle under the column to its tips, with round tips. */
function base(sagitta: number): Part {
  const X = BASE.halfWidth - BASE.tip / 2; // the band's centre line at the tips
  const rho = (X * X + sagitta * sagitta) / (2 * sagitta);
  const bMax = Math.asin(X / rho);
  const n = 24;
  const width = (b: number) => BASE.mid + (BASE.tip - BASE.mid) * Math.abs(b / bMax);
  const at = (b: number, d: number): P2 => [r((rho + d) * Math.sin(b)), r(rho - (rho + d) * Math.cos(b))];
  const bs = Array.from({ length: n + 1 }, (_, i) => -bMax + (2 * bMax * i) / n);
  const outer = bs.map((b) => at(b, width(b) / 2));
  const inner = bs.slice().reverse().map((b) => at(b, -width(b) / 2));
  // round tips: half circles around the tips' centres, from the outer edge to the inner edge
  const tip = (b: number): P2[] => {
    const c = at(b, 0);
    const radial = [Math.sin(b), -Math.cos(b)];
    const tangent = b > 0 ? [Math.cos(b), Math.sin(b)] : [-Math.cos(-b), Math.sin(-b)];
    return Array.from({ length: 7 }, (_, i) => {
      const t = (Math.PI * (i + 1)) / 8;
      const [c1, s1] = [Math.cos(t), Math.sin(t)];
      return [r(c[0] + (BASE.tip / 2) * (c1 * radial[0] + s1 * tangent[0])), r(c[1] + (BASE.tip / 2) * (c1 * radial[1] + s1 * tangent[1]))] as P2;
    });
  };
  return extrusion("base", [...outer, ...tip(bMax), ...inner, ...tip(-bMax).reverse()], 0, BASE.t, "stand");
}

function build(sagitta: number): Part[] {
  const screenHalf = Math.asin(SCREEN.w / 2 / R);
  const bulges = BULGE.map(([w, y0, y1, d], i) =>
    extrusion(`housing, bulge ${i + 1}`, sector(Rb - 0.01, Rb + d, Math.asin(w / Rb), 24), LOW + y0, y1 - y0, "housing"),
  );
  return [
    extrusion("screen", sector(R - 0.06, R, screenHalf), LOW + SCREEN.bottom, SCREEN.h, "screen"),
    extrusion("bezel", sector(R, R + PANEL.bezel, half), LOW, PANEL.h, "bezel"),
    extrusion("back", sector(R + PANEL.bezel, Rb, half), LOW, PANEL.h, "housing"),
    ...bulges,
    box("hinge plate", [-HINGE.w / 2, HINGE.w / 2], HINGE.y, [COLUMN.d / 2 - 0.01, COLUMN.d / 2 + HINGE.d + 0.01], "stand", { cornerRadius: 0.5 }),
    box("column", [-COLUMN.w / 2, COLUMN.w / 2], [BASE.t - 0.01, COLUMN.top], [-COLUMN.d / 2, COLUMN.d / 2], "stand", { cornerRadius: 0.8 }),
    base(sagitta),
  ];
}

// solve the base's sagitta for the overall depth (up to a half circle, where the tips stop moving forwards)
let [lo, hi] = [5, BASE.halfWidth - BASE.tip / 2];
for (let i = 0; i < 40; i++) {
  const s = (lo + hi) / 2;
  const b = partsBounds(build(s))!;
  if (b.max.z - b.min.z > DEPTH) hi = s;
  else lo = s;
}
const sagitta = r(lo);
const fitted = fitToBox(build(sagitta));
const parts = fitted.parts;
// LG's sizes to the nearest mm (fitToBox rounds up)
const near = (v: number) => Math.round(v * 10) / 10;
const dimensions = { width: near(PANEL.w), depth: near(fitted.dimensions.depth), height: near(LOW + PANEL.h) };
if (Math.abs(fitted.dimensions.depth - DEPTH) > 0.15) throw new Error(`depth ${fitted.dimensions.depth}, expected ${DEPTH}`);

const path = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: 'Monitor, LG 40" UltraWide 40WP95C-W',
  category: "media",
  tags: ["office", "monitor", "ultrawide", "curved", "computer", "lg"],
  dimensions,
  placement: { type: "onTop" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    screen: { label: "Screen", default: "glass.black", allowed: ["glass.black"] },
    bezel: { label: "Bezel", default: "plastic.deep-black", allowed: ["plastic.deep-black"] },
    housing: { label: "Back", default: "lacquer.white", allowed: ["lacquer.white", "lacquer.black", "plastic.deep-black", "plastic.graphite"] },
    stand: { label: "Stand", default: "metal.brushed-steel", allowed: ["metal.brushed-steel", "metal.stainless", "metal.black-matte", "lacquer.white"] },
  },
  productUrl: "https://www.lg.com/us/monitors/lg-40wp95c-w-ultrawide-monitor",
  notes: `LG 40WP95C-W: a 40-inch UltraWide 5K2K (5120 × 2160) Nano IPS monitor, curved at 2500R, with a white back and a silver stand. LG's sizes: 94.72 × 41.92 × 11.48 cm without the stand; 94.72 cm wide, 50.47–61.47 cm high and 28.3 cm deep with it; screen area 92.93 × 39.20 cm. Shown with the stand at its lowest position (the panel's bottom edge ${r(LOW)} cm above the desk); the stand raises it by 11 cm, tilts it −5° to +20° and swivels it ±15°. The crescent base's tips reach ${r(sagitta)} cm forwards from the column.`,
});
console.log(`wrote ${path}: ${parts.length} parts, ${dimensions.width} × ${dimensions.depth} × ${dimensions.height}; base sagitta ${sagitta}, panel arc ${r((2 * half) / DEG)}°`);
