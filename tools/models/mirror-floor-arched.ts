/**
 * npx tsx tools/models/mirror-floor-arched.ts — writes catalogue/mirror-floor-arched.json.
 *
 * A full-length floor mirror with straight sides and bottom and a semicircular top, after the user's wish for one
 * "rather straight and rounded on the top"; not a specific product. 65 × 175 cm along the glass, in a slim frame
 * (2 cm wide, 2.5 cm deep) with the glass set 3 mm behind its front, a backing board flush with its back, and a slim
 * hinged leg behind it, so it stands on its own anywhere in a room, leaning back 5° like an easel. Snapped to a wall,
 * the leg's foot touches the wall.
 *
 * The parts are built standing upright (x across, y up the glass, the frame's front at z = 0) and then tilted back
 * around the frame's bottom back edge, the edge it stands on; the leg is placed afterwards, from the hinge on the
 * backing board down to the floor.
 */
import type { Part } from "../../src/core/schema/common";
import { arcPoints, box, DEG, fitToBox, r, r1, tail, tiltBack, writeItem, type P2 } from "./parametric";

const ID = "mirror-floor-arched";
const W = 65; // width
const H = 175; // height along the glass
const F = 2; // frame face width
const D = 2.5; // frame depth
const TILT = 5; // degrees back from upright
const GLASS = 0.4; // thickness
const GLASS_SET = 0.3; // how far the glass sits behind the frame's front
const UNDER = 0.3; // how far the glass and the board reach under the frame
const HINGE = 100; // height of the leg's hinge, along the back
const HINGE_T = 1; // the hinge block's thickness
const FOOT = 32; // the leg's foot, behind the frame's bottom front edge
const LEG: [number, number] = [2.5, 0.8]; // flat bar, width × thickness

const R = W / 2; // radius of the top
const S = H - R; // straight part of the sides
const eps = 0.01; // doubled profile points keep the faces' shading apart

/** The outline at inset d from the frame's outer edge, as seen from the front ([x, y], bottom at y = d). */
const outline = (d: number): P2[] => [[-(R - d), d], [R - d, d], ...arcPoints(0, S, R - d, 0, 180)].map(([x, y]) => [r1(x), r1(y)] as P2);

/** A flat piece cut to `outline(d)`, from z0 back to z0 − thickness. */
const sheet = (name: string, d: number, z0: number, thickness: number, material: string): Part => ({
  name,
  shape: "extrusion",
  points: outline(d),
  height: thickness,
  ...tail({ x: 0, y: 0, z: z0 }, material, { rotation: { x: -90 } }),
}) as Part;

const upright: Part[] = [
  box("frame, sides", [R - F, R], [0, S], [-D, 0], "frame", { mirror: ["x"] }),
  box("frame, bottom", [-(R - F), R - F], [0, F], [-D, 0], "frame"),
  {
    name: "frame, top",
    shape: "lathe",
    profile: [[R - F, 0], [R, 0], [R, eps], [R, D - eps], [R, D], [R - F, D], [R - F, D - eps], [R - F, eps], [R - F, 0]],
    arc: 180,
    // rotation x -90 turns the lathe's axis to the depth: the half ring runs from the right (+x) over the top
    ...tail({ x: 0, y: S, z: 0 }, "frame", { rotation: { x: -90 } }),
  } as Part,
  sheet("glass", F - UNDER, -GLASS_SET, GLASS, "glass"),
  sheet("backing board", F - UNDER, -(GLASS_SET + GLASS), D - GLASS_SET - GLASS, "frame"),
  box("hinge", [-3, 3], [HINGE - 2.5, HINGE + 2.5], [-D - HINGE_T, -D], "frame", { plan: "hidden" }),
];
const tilted = tiltBack(upright, TILT, { y: 0, z: -D });

// the leg: from the hinge's back face (turned with the frame around its bottom back edge) down to the floor
const t = TILT * DEG;
const hinge = { y: HINGE * Math.cos(t) - HINGE_T * Math.sin(t), z: -D - HINGE * Math.sin(t) - HINGE_T * Math.cos(t) };
const foot = { y: 0, z: -FOOT };
const along = Math.hypot(hinge.y - foot.y, hinge.z - foot.z);
const lean = Math.atan2(hinge.z - foot.z, hinge.y - foot.y); // the leg's top leans forwards (towards +z)
const [legW, legT] = LEG;
// the bar's centre line, half its thickness behind the line from the foot to the hinge
const back = { y: Math.sin(lean) * (legT / 2), z: -Math.cos(lean) * (legT / 2) };
const stand: Part[] = [
  {
    name: "leg",
    shape: "box",
    size: { x: legW, y: r(along), z: legT },
    cornerRadius: 0.35,
    ...tail({ x: 0, y: (hinge.y + foot.y) / 2 + back.y, z: (hinge.z + foot.z) / 2 + back.z }, "frame", { rotation: { x: lean / DEG } }),
  } as Part,
  { name: "foot", shape: "box", size: { x: 3.5, y: 0.8, z: 3 }, cornerRadius: 0.35, ...tail({ x: 0, y: 0.4, z: foot.z + back.z }, "frame", { plan: "hidden" }) } as Part,
];

const { parts, dimensions } = fitToBox([...tilted, ...stand]);
const path = writeItem({
  $schema: "../schemas/catalogue-item.schema.json",
  schemaVersion: 1,
  id: ID,
  name: "Floor mirror, arched",
  category: "decor",
  tags: ["mirror", "full-length", "standing mirror", "bedroom", "hallway", "arch"],
  dimensions,
  placement: { type: "floor" },
  geometry: { type: "parametric", parts },
  materialSlots: {
    frame: { label: "Frame and leg", default: "metal.black-matte", allowed: ["metal.*", "wood.*"] },
    glass: { label: "Mirror", default: "glass.mirror", allowed: ["glass.mirror", "glass.smoke"] },
  },
  clearance: { front: 70, note: "Room to stand in front of the mirror" },
  notes: `Built to the user's description, not a specific product. A full-length mirror, ${W} × ${H} cm along the glass with straight sides and bottom and a semicircular top, in a slim frame (${F} cm wide, ${D} cm deep). A hinged leg behind it holds it leaning back ${TILT}°, so it stands on its own anywhere in a room; snapped to a wall, the leg's foot touches the wall and the top of the frame is ${r1(dimensions.depth - D - H * Math.sin(t))} cm from it. The glass is a plain mirror finish: the app doesn't render reflections.`,
});

console.log(`wrote ${path}: ${parts.length} parts`);
console.log(`dimensions ${dimensions.width} × ${dimensions.depth} × ${dimensions.height} cm (W × D × H); leg ${r(along)} cm, ${r(lean / DEG)}° from vertical`);
