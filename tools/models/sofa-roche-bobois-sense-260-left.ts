/**
 * npx tsx tools/models/sofa-roche-bobois-sense-260-left.ts — writes catalogue/sofa-roche-bobois-sense-260-left/model.glb
 * and item.json, built from its own geometry (no third-party assets) by roche-bobois-sense.ts: Roche Bobois's Sense,
 * the curved 4-seat sofa, 260 cm, with its deep end on the LEFT as you face it (on the right of someone sitting on it).
 * The same sofa as sofa-roche-bobois-sense-240-left, 20 cm longer.
 *
 * Sizes: Roche Bobois's technical sheet (technicals.roche-bobois.com/M125338841/TDSv_SENSE_2024.pdf), page 2, the
 * 4-seater "XSX" in the plan "ÉLÉMENT MESURE B", the wall along its back: 260 wide, 146 deep overall and 107 at the
 * shallow end, 75 high, seat height 38, black metal legs 6 cm high. (The plan "MESURE A", 255 × 153, is the same sofa
 * turned.)
 *
 * OUTLINE and RUNGS are traced from that plan, in the item's frame (x right as seen from the front, z towards the
 * front, the back against z = −73), the same way as the 240's: the footprint, and the back as pairs of points across
 * it, on its outer and inner edges, from its left end round to its right end. The drawing is to scale for the 260 and
 * the 107 but draws the deep end 143.5 deep; the trace stretches the deep end alone to 146. Against the 240's plan, the
 * extra length is mostly in the long straight stretch between the back's dip and the right end; the ends and the deep
 * lobe are the same. The legs and the seats' stretches are the 240's, moved with the plan.
 */
import type { P2 } from "./parametric";
import { buildSense, D, H, LEG, SEAT_H } from "./roche-bobois-sense";

const ID = "sofa-roche-bobois-sense-260-left";
const W = 260;

// ---- the trace (cm, item frame) ----
const OUTLINE: P2[] = [
  [-80.3, -72.9], [-91.6, -71.9], [-102.5, -68.5], [-112.3, -62.7], [-120.3, -54.7], [-126, -44.9], [-129.3, -34], [-130, -22.6],
  [-128.2, -11.4], [-124.4, -0.6], [-119.8, 9.8], [-114.2, 19.7], [-107.8, 29.2], [-100.3, 37.7], [-92.3, 45.8], [-83.7, 53.3],
  [-74.5, 60.1], [-64.7, 66], [-54.5, 70.9], [-43.4, 72.9], [-32.4, 70.1], [-23, 63.7], [-14.7, 55.9], [-6.6, 47.9], [2.6, 41.1],
  [12.6, 35.7], [23.3, 31.7], [34.3, 29.1], [45.7, 27.9], [57, 28.1], [68.3, 29.6], [79.3, 32.6], [90.5, 34.4], [101.8, 33.2],
  [112.2, 28.5], [120.5, 20.8], [125.9, 10.8], [129, -0.2], [130, -11.5], [128.9, -22.8], [125.7, -33.7], [120.6, -43.9],
  [113.7, -53], [105.3, -60.6], [95.5, -66.5], [84.9, -70.6], [73.7, -72.8], [62.4, -72.8], [51.2, -70.7], [40.2, -67.8],
  [29.1, -64.9], [18.1, -62], [7.1, -59.1], [-3.9, -56.3], [-15, -53.7], [-26.1, -55.9], [-36.8, -59.8], [-47.5, -63.7],
  [-58.2, -67.7], [-69, -71.2],
];
/** Across the back: [outer x, outer z, inner x, inner z]; the first and the last are its slanted end faces. */
const RUNGS: [number, number, number, number][] = [
  [-116.8, 15.3, -93.9, 27.2], [-121, 7.3, -86.5, 18.9], [-124.6, -1.1, -87.4, 5.7], [-127.7, -9.6, -92.5, -6.1],
  [-129.6, -18.5, -96.7, -16.3], [-130, -27.6, -98.4, -23.6], [-128.7, -36.6, -98.2, -29.1], [-125.9, -45.3, -97.1, -32.5],
  [-121.4, -53.2, -95.7, -35.2], [-115.5, -60.1, -93.9, -37.2], [-108.2, -65.6, -91.9, -38.7], [-100, -69.6, -88.8, -40.2],
  [-91.2, -72, -85.7, -41.1], [-82.1, -72.9, -82, -41.5], [-73.1, -72.2, -78, -41.1], [-64.3, -69.8, -73.2, -39.8],
  [-55.7, -66.8, -66.1, -37.2], [-47.2, -63.6, -58.3, -34.3], [-38.6, -60.5, -49.2, -31], [-30.1, -57.4, -39.7, -27.5],
  [-21.5, -54.4, -25.6, -23.3], [-12.4, -54.1, -10.4, -22.7], [-3.6, -56.3, 3.6, -25.9], [5.2, -58.7, 13, -28.3],
  [14, -61, 22.2, -30.7], [22.8, -63.3, 30.8, -32.9], [31.6, -65.6, 40, -35.4], [40.4, -67.9, 48.4, -37.6],
  [49.2, -70.3, 56.2, -39.6], [58.1, -72.3, 62.2, -41.2], [67.2, -73, 67.5, -41.6], [76.3, -72.4, 72, -41.4],
  [85.2, -70.6, 76.3, -40.5], [93.7, -67.5, 80.2, -39.1], [101.7, -63.1, 84.3, -36.9], [109, -57.6, 87.9, -34.3],
  [115.4, -51.1, 91.4, -30.8], [120.7, -43.7, 94.5, -26.4], [125, -35.7, 97.2, -20], [127.9, -27.1, 98.5, -11.6],
  [129.6, -18.1, 100.5, -1.4], [130, -9, 105.3, 7.6], [128.9, 0, 113.5, 11.4],
];

// the legs, under the base's flat bottom
const LEGS: P2[] = [
  [-99, 2],
  [-93, -44],
  [-49, 48],
  [4, -36],
  [101, 2],
  [87, -45],
];

await buildSense({
  id: ID,
  width: W,
  outline: OUTLINE,
  rungs: RUNGS,
  legs: LEGS,
  // the middle seat first: a drop in 3D goes on an item's first surface of the height it points at (as on the Bubble Curve)
  seats: [["seat, middle", -35, 26, 0], ["seat, deep end", -111, -35, 10], ["seat, right end", 26, 120, 0]],
  strips: 9,
  name: "Sofa, Roche Bobois Sense 260, deep end left",
  tags: ["living room", "roche bobois", "sense", "curved sofa", "4-seater", "organic", "puffy", "olive", "buttoned"],
  productUrl: "https://www.roche-bobois.com/en/product/sense-4-seat-sofa/A126021602.html",
  notes: `Roche Bobois Sense (Studio Roche Bobois), the curved 4-seat sofa, 260 cm, with its deep end on the LEFT as you face it (x < 0; on the right of someone sitting on it). Sizes from Roche Bobois's technical sheet (technicals.roche-bobois.com/M125338841/TDSv_SENSE_2024.pdf, page 2, the 4-seater "XSX" in the plan "ÉLÉMENT MESURE B", the wall along its back): ${W} wide and ${D} deep overall, 107 deep at its shallow right-hand end (the product page's 107 cm), ${H} high, seat height ${SEAT_H}, black metal legs ${LEG.h} cm high. Plan for the full ${W} × ${D} cm footprint; the sheet's plan "MESURE A" (255 × 153) is the same sofa turned. The same sofa as the 240 (sofa-roche-bobois-sense-240-left), 20 cm longer, the extra length mostly in the long straight stretch of seat and back towards the right end. Roche Bobois's photos show the other hand, with the deep end on the right as you face it; the sheet has both, and the app can't mirror an item, so this item is the deep-end-left one only. model.glb is generated by \`npx tsx tools/models/${ID}.ts\` from its own geometry after the sheet's plan, traced (it draws the deep end 143.5 deep; the trace stretches the deep end alone to ${D}), the sheet's elevation and the photos, with the 240's shapes: one buttoned, pebble-shaped base on six black legs, and a thick buttoned roll wrapping round it as the back, leaning back, with rounded pads as its ends. The seat is three surfaces (the middle, the deep end and the right end), so cushions and throws can go on it. The fabrics are planning colours, not Roche Bobois's (the default olive is close to its photos); fabric.espresso, fabric.dark-chocolate, fabric.dark-walnut and fabric.dark-umber are dark browns to try, alongside the chocolates, also planning colours rather than Roche Bobois swatches. No clearance zone: the legroom in front of the shallow seats lies inside the item's box, beside the deep end.`,
});
