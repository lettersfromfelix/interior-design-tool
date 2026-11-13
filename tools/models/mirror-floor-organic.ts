/**
 * npx tsx tools/models/mirror-floor-organic.ts — writes catalogue/mirror-floor-organic.json.
 *
 * A full-length mirror that is "only straight at the bottom and otherwise organically flowing" (the user's words), in
 * the style of the irregular wavy floor mirrors; an own design, not a specific product. About 75 × 178 cm: the outline
 * is a smooth closed spline through the control points below (centripetal Catmull–Rom, so it can't loop or overshoot),
 * flattened at the bottom. The glass sits on a backing board that shows as a thin edge all around (its own material,
 * oak by default; glass.mirror makes it look frameless).
 *
 * It leans against a wall, 6° back from upright, resting on its straight bottom edge: snapped to a wall, its highest
 * point touches the wall. The parts are built standing upright (x across, y up the glass, the glass's front at z = 0)
 * and then tilted back around the board's bottom back edge.
 */
import type { Part } from "../../src/core/schema/common";
import { closedSpline, DEG, fitToBox, offsetOutline, r1, tail, tiltBack, writeItem, type P2 } from "./parametric";

const ID = "mirror-floor-organic";
const TILT = 6; // degrees back from upright
const GLASS = 0.4; // thickness
const BOARD = 1.6; // thickness of the backing board
const EDGE = 0.8; // how far the board shows around the glass

/** Control points of the outline (cm, x across, y up), counter-clockwise from the bottom. */
const CONTROL: P2[] = [
  [-4, 0], [14, 0], [25, 1.5],
  // right: a low bulge, a long waist, a high bulge
  [33, 16], [36, 34], [32, 58], [27.5, 78], [30, 102], [36.5, 124], [37, 142],
  // the top: higher on the right, falling to a lower lobe on the left
  [31, 160], [19, 172], [4, 178], [-11, 176], [-23, 170.5], [-32, 161],
  // left: a high bulge, a waist and a low bulge, offset in height against the right side
  [-37, 147], [-36.5, 130], [-31.5, 110], [-29, 92], [-32.5, 70], [-37.5, 48], [-37, 28],
  [-32, 10], [-26, 1.5], [-14, 0],
];

// sample the spline and lay the bottom flat on y = 0
const board: P2[] = closedSpline(CONTROL, 6).map(([x, y]) => [r1(x), y < 0.5 ? 0 : r1(y)] as P2);
const glass: P2[] = offsetOutline(board, -EDGE).map(([x, y]) => [r1(x), r1(y)] as P2);

const sheet = (name: string, points: P2[], z0: number, thickness: number, material: string): Part => ({
  name,
  shape: "extrusion",
  points,
  height: thickness,
  // outline as seen from the front, extruded backwards from z0
  ...tail({ x: 0, y: 0, z: z0 }, material, { rotation: { x: -90 } }),
}) as Part;

const upright = [sheet("glass", glass, 0, GLASS, "glass"), sheet("backing board", board, -GLASS, BOARD, "edge")];
const { parts, dimensions } = fitToBox(tiltBack(upright, TILT, { y: 0, z: -(GLASS + BOARD) }), true);

const height = Math.max(...board.map(([, y]) => y));
const width = Math.max(...board.map(([x]) => x)) - Math.min(...board.map(([x]) => x));
const bottom = board.filter(([, y]) => y === 0).map(([x]) => x);
const path = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Floor mirror, organic",
  category: "decor",
  tags: ["mirror", "full-length", "leaning mirror", "wavy", "irregular", "bedroom", "hallway"],
  dimensions,
  placement: { type: "floor" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    glass: { label: "Mirror", default: "glass.mirror", allowed: ["glass.mirror", "glass.smoke"] },
    edge: { label: "Edge and back", default: "wood.oak-natural", allowed: ["wood.*", "lacquer.*", "metal.*", "glass.mirror"] },
  },
  clearance: { front: 70, note: "Room to stand in front of the mirror" },
  notes: `Built to the user's description, not a specific product. A full-length mirror with a straight bottom edge (${r1(Math.max(...bottom) - Math.min(...bottom))} cm) and an otherwise soft, asymmetric, flowing outline, ${r1(width)} × ${r1(height)} cm along the glass, on a backing board that shows as a ${EDGE} cm edge all around (glass.mirror makes it look frameless). It leans against a wall, ${TILT}° back from upright: snap it to a wall and its highest point touches the wall, its bottom edge ${r1(height * Math.sin(TILT * DEG))} cm out from it. The glass is a plain mirror finish: the app doesn't render reflections.`,
});

console.log(`wrote ${path}: ${parts.length} parts; outline ${board.length} points`);
console.log(`glass outline ${r1(width)} × ${r1(height)} cm, straight bottom ${r1(Math.min(...bottom))}…${r1(Math.max(...bottom))}`);
console.log(`dimensions ${dimensions.width} × ${dimensions.depth} × ${dimensions.height} cm (W × D × H)`);
