/**
 * npx tsx tools/models/sofa-roche-bobois-sense-240-left.ts — writes catalogue/sofa-roche-bobois-sense-240-left/model.glb
 * and item.json, built from its own geometry (no third-party assets) by roche-bobois-sense.ts: Roche Bobois's Sense,
 * the large curved 3-seat sofa, 240 cm, with its deep end on the LEFT as you face it (on the right of someone sitting
 * on it).
 *
 * Sizes: Roche Bobois's technical sheet (technicals.roche-bobois.com/M125338841/TDSv_SENSE_2024.pdf), page 3, the
 * 3-seater "3SX" in the plan "ÉLÉMENT MESURE B", the wall along its back: 240 wide, 146 deep overall and 107 at the
 * shallow end, 75 high, seat height 38, black metal legs 6 cm high. (The plan "MESURE A" is the same sofa turned.)
 *
 * OUTLINE and RUNGS are traced from that plan, in the item's frame (x right as seen from the front, z towards the
 * front, the back against z = −73): the footprint, and the back as pairs of points across it, on its outer and inner
 * edges, from its left end round to its right end. The drawing is to scale for the 240 and the 107 but draws the deep
 * end 141.8 deep; the trace stretches the deep end alone to 146.
 */
import type { P2 } from "./parametric";
import { buildSense, D, H, LEG, SEAT_H } from "./roche-bobois-sense";

const ID = "sofa-roche-bobois-sense-240-left";
const W = 240;

// ---- the trace (cm, item frame) ----
const OUTLINE: P2[] = [
  [-76, -72.9], [-87.3, -70.8], [-97.7, -66.1], [-106.8, -59.1], [-113.7, -50], [-118.2, -39.4], [-120, -28.1], [-119.3, -16.6],
  [-116.3, -5.6], [-111.7, 5], [-106.4, 15.1], [-100, 24.7], [-92.8, 33.6], [-84.8, 41.8], [-76.4, 49.7], [-67.5, 57], [-58, 63.5],
  [-47.9, 68.9], [-37.1, 72.7], [-25.7, 72.1], [-15.5, 67], [-7.1, 59.1], [0.4, 50.4], [8.7, 42.5], [18.4, 36.4], [28.9, 31.9],
  [40.1, 29.2], [51.5, 29.2], [62.9, 30.7], [74.1, 33.2], [85.6, 33.8], [96.7, 31.2], [106.4, 25], [113.7, 16.2], [117.9, 5.6],
  [119.9, -5.7], [119.8, -17.2], [117.6, -28.5], [113.3, -39.1], [107.2, -48.8], [99.3, -57.2], [90.1, -64], [79.7, -68.9],
  [68.7, -71.9], [57.2, -72.8], [45.8, -71.6], [34.7, -68.5], [23.7, -65.2], [12.7, -61.9], [1.7, -58.6], [-9.5, -56.5],
  [-20.6, -59.1], [-31.6, -62.7], [-42.5, -66.3], [-53.4, -69.9], [-64.5, -72.6],
];
/** Across the back: [outer x, outer z, inner x, inner z]; the first and the last are its slanted end faces. */
const RUNGS: [number, number, number, number][] = [
  [-104.3, 18.2, -82, 27.6], [-109.1, 10.4, -75.3, 20], [-113, 2.1, -76.5, 4.7], [-116.5, -6.3, -83.4, -9.5],
  [-119.1, -15.1, -87.4, -19.3], [-120, -24.2, -88.3, -25.1], [-119.5, -33.3, -88.1, -28.7], [-117.4, -42.2, -87.4, -31.7],
  [-113.5, -50.5, -86.2, -34.2], [-108, -57.9, -84.6, -36.4], [-101.2, -63.9, -82.6, -38.2], [-93.3, -68.5, -80, -39.7],
  [-84.7, -71.6, -76.5, -40.8], [-75.6, -73, -73, -41.3], [-66.5, -73, -69.3, -41.1], [-57.5, -71.1, -64.5, -40.1],
  [-48.7, -68.4, -58.1, -38.1], [-40.1, -65.5, -50, -35.3], [-31.4, -62.6, -41.2, -32.4], [-22.6, -59.8, -31.7, -29.3],
  [-13.9, -57, -18.9, -25.6], [-4.8, -56.7, -0.8, -25.1], [4, -59.2, 12.4, -28.6], [12.7, -61.9, 22, -31.5],
  [21.5, -64.5, 30.7, -34.1], [30.3, -67.2, 39.2, -36.7], [39.1, -69.8, 46.8, -39], [48, -72, 52.6, -40.6],
  [57.1, -73, 57.4, -41], [66.2, -72.3, 62.4, -40.8], [75.2, -70.5, 66.7, -39.9], [83.8, -67.3, 70.8, -38.3],
  [91.8, -62.9, 74.7, -36.2], [99.1, -57.4, 78.2, -33.6], [105.5, -50.9, 81.3, -30.4], [110.9, -43.5, 83.9, -26.8],
  [115.1, -35.4, 86.3, -21.9], [118.1, -26.7, 88.7, -10.3], [119.9, -17.7, 94.3, 4.7], [120, -8.6, 102.6, 10.4],
  [119, 0.5, 105.1, 10.1],
];

// the legs, under the base's flat bottom
const LEGS: P2[] = [
  [-88, 2],
  [-82, -44],
  [-36, 48],
  [8, -36],
  [92, 2],
  [78, -45],
];

await buildSense({
  id: ID,
  width: W,
  outline: OUTLINE,
  rungs: RUNGS,
  legs: LEGS,
  // the middle seat first: a drop in 3D goes on an item's first surface of the height it points at (as on the Bubble Curve)
  seats: [["seat, middle", -24, 26, 0], ["seat, deep end", -100, -24, 10], ["seat, right end", 26, 110, 0]],
  strips: 8,
  name: "Sofa, Roche Bobois Sense 240, deep end left",
  tags: ["living room", "roche bobois", "sense", "curved sofa", "3-seater", "organic", "puffy", "olive", "buttoned"],
  productUrl: "https://www.roche-bobois.com/en/sense-large-3-seat-sofa-curved---left-edge/5030.html",
  notes: `Roche Bobois Sense (Studio Roche Bobois), the large curved 3-seat sofa, 240 cm, with its deep end on the LEFT as you face it (x < 0; on the right of someone sitting on it). Sizes from Roche Bobois's technical sheet (technicals.roche-bobois.com/M125338841/TDSv_SENSE_2024.pdf, page 3, the 3-seater "3SX" in the plan "ÉLÉMENT MESURE B", the wall along its back): ${W} wide and ${D} deep overall, 107 deep at its shallow right-hand end (the product page's 107 cm), ${H} high, seat height ${SEAT_H}, black metal legs ${LEG.h} cm high. Plan for the full ${W} × ${D} cm footprint; the sheet's plan "MESURE A" is the same sofa turned. Roche Bobois's photos on the product page show the other hand, with the deep end on the right as you face it; the sheet has both, and the app can't mirror an item, so this item is the deep-end-left one only. model.glb is generated by \`npx tsx tools/models/${ID}.ts\` from its own geometry after the sheet's plan, traced (it draws the deep end 141.8 deep; the trace stretches the deep end alone to ${D}), the sheet's elevation and the photos: one buttoned, pebble-shaped base on six black legs, and a thick buttoned roll wrapping round it as the back, leaning back, with rounded pads as its ends. The seat is three surfaces (the middle, the deep end and the right end), so cushions and throws can go on it. The fabrics are planning colours, not Roche Bobois's (the default olive is close to its photos); fabric.espresso, fabric.dark-chocolate, fabric.dark-walnut and fabric.dark-umber are dark browns to try, alongside the chocolates, also planning colours rather than Roche Bobois swatches. No clearance zone: the legroom in front of the shallow seats lies inside the item's box, beside the deep end.`,
});
